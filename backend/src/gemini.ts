import { GoogleGenerativeAI } from "@google/generative-ai";
import { requiredEnv } from "./env";

let client: GoogleGenerativeAI | null = null;

function getClient(): GoogleGenerativeAI {
  if (!client) {
    client = new GoogleGenerativeAI(requiredEnv("GEMINI_API_KEY"));
  }
  return client;
}

export function getGeminiModelName(): string {
  return process.env.GEMINI_MODEL?.trim() || "gemini-3.6-flash";
}

export function getGeminiFallbackModels(): string[] {
  const primary = getGeminiModelName();
  const configured = (process.env.GEMINI_FALLBACK_MODELS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const defaults = ["gemini-3.6-flash", "gemini-3.7-flash"];
  const ordered = [primary, ...configured, ...defaults];
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const name of ordered) {
    if (seen.has(name)) continue;
    seen.add(name);
    unique.push(name);
  }
  return unique;
}

function isRetryableGeminiError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /503|429|high demand|unavailable|try again|overloaded|RESOURCE_EXHAUSTED|no longer available|404 Not Found/i.test(
    message,
  );
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function generateTextWithRetries(
  prompt: string | Array<string | { text: string } | { inlineData: { mimeType: string; data: string } }>,
  generationConfig: {
    temperature: number;
    maxOutputTokens: number;
  },
): Promise<{ text: string; model: string }> {
  const models = getGeminiFallbackModels();
  let lastError: unknown;

  for (const modelName of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const model = getClient().getGenerativeModel({
          model: modelName,
          generationConfig: {
            temperature: generationConfig.temperature,
            maxOutputTokens: generationConfig.maxOutputTokens,
          },
        });
        const result = await model.generateContent(prompt as never);
        const text = result.response.text()?.trim() ?? "";
        if (!text) {
          throw new Error("Gemini returned an empty response.");
        }
        if (modelName !== getGeminiModelName() || attempt > 0) {
          console.info(
            `[coco-api] Gemini ok model=${modelName} attempt=${attempt + 1}`,
          );
        }
        return { text, model: modelName };
      } catch (err) {
        lastError = err;
        const message = err instanceof Error ? err.message : String(err);
        const retryable = isRetryableGeminiError(err);
        const switchModel =
          /404 Not Found|no longer available|exceeded your current quota|GenerateRequestsPerDayPerProjectPerModel|400 Bad Request|invalid argument/i.test(
            message,
          );
        console.warn(
          `[coco-api] Gemini failed model=${modelName} attempt=${attempt + 1}`,
          message,
        );
        if (switchModel) break; // don't burn retries on dead/quota-exhausted models
        if (retryable && attempt === 0) {
          await sleep(700);
          continue;
        }
        if (retryable) break; // try next model
        throw err; // non-retryable (bad request, etc.)
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(String(lastError || "Gemini request failed."));
}

export async function explainText(input: {
  text: string;
  question?: string;
}): Promise<string> {
  const text = input.text.trim();
  if (!text) {
    throw new Error("No text provided to explain.");
  }

  // Keep Explain cheap: short input + short output.
  const clipped = text.length > 4000 ? `${text.slice(0, 4000)}…` : text;
  const question =
    input.question?.trim() ||
    "What does this mean? Explain clearly and briefly.";

  const prompt = [
    "You are Coco, a concise desktop session assistant.",
    "Explain the highlighted text for someone mid-task.",
    "Reply in 2-4 short sentences. No markdown, no bullet lists, no preamble.",
    "",
    `Question: ${question}`,
    "",
    "Highlighted text:",
    clipped,
  ].join("\n");

  const { text: answer } = await generateTextWithRetries(prompt, {
    temperature: 0.3,
    maxOutputTokens: 1024,
  });
  return answer;
}

export async function transcribeAudio(input: {
  audioBase64: string;
  mimeType: string;
}): Promise<string> {
  const audioBase64 = input.audioBase64.trim();
  if (!audioBase64) {
    throw new Error("No audio provided to transcribe.");
  }

  // Keep Voice day cheap: reject huge clips early.
  const approxBytes = Math.floor((audioBase64.length * 3) / 4);
  if (approxBytes > 3 * 1024 * 1024) {
    throw new Error("Audio clip too large. Keep commands under a few seconds.");
  }

  const mimeType = input.mimeType.trim() || "audio/webm";
  const generationConfig = {
    temperature: 0,
    maxOutputTokens: 256,
  };

  const model = getClient().getGenerativeModel({
    model: getGeminiModelName(),
    generationConfig,
  });

  const result = await model.generateContent([
    {
      inlineData: {
        mimeType,
        data: audioBase64,
      },
    },
    {
      text: [
        "Transcribe the spoken words in this audio.",
        "Return only the plain transcript text.",
        "No quotes, labels, punctuation-only answers, or commentary.",
        "If there is no clear speech, return exactly: (empty)",
      ].join(" "),
    },
  ]);

  const raw = result.response.text()?.trim() ?? "";
  if (!raw || raw === "(empty)") {
    throw new Error("Heard nothing clear — try again or type the command.");
  }
  return raw.replace(/^["'\s]+|["'\s]+$/g, "");
}

export type SynthesisEvent = {
  type: string;
  timestamp: number;
  text?: string;
  fileName?: string;
  question?: string;
  answer?: string;
  label?: string;
};

export async function captionImage(input: {
  imageBase64: string;
  mimeType?: string;
  hint?: string;
}): Promise<string> {
  const imageBase64 = input.imageBase64.trim();
  if (!imageBase64) {
    throw new Error("No image provided to caption.");
  }

  const approxBytes = Math.floor((imageBase64.length * 3) / 4);
  if (approxBytes > 6 * 1024 * 1024) {
    throw new Error("Image too large to caption.");
  }

  const mimeType = input.mimeType?.trim() || "image/png";
  const generationConfig = {
    temperature: 0.2,
    maxOutputTokens: 80,
  };

  const model = getClient().getGenerativeModel({
    model: getGeminiModelName(),
    generationConfig,
  });

  const result = await model.generateContent([
    {
      inlineData: {
        mimeType,
        data: imageBase64,
      },
    },
    {
      text: [
        "Write a short label (max 12 words) for what this screenshot shows.",
        "Be specific (UI, diagram, doc, code, slide, etc.).",
        "No quotes, no trailing period, no preamble.",
        input.hint ? `Context hint: ${input.hint}` : "",
      ]
        .filter(Boolean)
        .join(" "),
    },
  ]);

  const label = result.response.text()?.trim().replace(/^["']|["'.]$/g, "");
  if (!label) {
    throw new Error("Gemini returned an empty caption.");
  }
  return label.slice(0, 120);
}

export async function captionRecordingFromContext(input: {
  fileName?: string;
  sourceLabel?: string;
  recentContext?: string;
}): Promise<string> {
  const generationConfig = {
    temperature: 0.3,
    maxOutputTokens: 80,
  };

  const model = getClient().getGenerativeModel({
    model: getGeminiModelName(),
    generationConfig,
  });

  const prompt = [
    "Write a short label (max 12 words) for a screen recording from a study/work session.",
    "Infer from the session context what the recording was likely about.",
    "No quotes, no trailing period, no preamble.",
    `Source: ${input.sourceLabel || "unknown"}`,
    `File: ${input.fileName || "recording.webm"}`,
    "Recent session context:",
    (input.recentContext || "(none)").slice(0, 3000),
  ].join("\n");

  const result = await model.generateContent(prompt);
  const label = result.response.text()?.trim().replace(/^["']|["'.]$/g, "");
  if (!label) {
    throw new Error("Gemini returned an empty recording label.");
  }
  return label.slice(0, 120);
}

export async function synthesizeSessionNotes(input: {
  sourceLabel?: string;
  startedAt?: number;
  events: SynthesisEvent[];
}): Promise<string> {
  const events = input.events ?? [];
  if (events.length === 0) {
    throw new Error("No session events to synthesize.");
  }

  const timeline = events
    .slice()
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((e, i) => {
      const when = new Date(e.timestamp).toISOString();
      const parts = [`${i + 1}. [${e.type}] @ ${when}`];
      if (e.label) parts.push(`label: ${e.label}`);
      if (e.fileName) parts.push(`file: ${e.fileName}`);
      if (e.question) parts.push(`Q: ${e.question}`);
      if (e.answer) parts.push(`A: ${e.answer}`);
      if (e.text) parts.push(`text: ${e.text.slice(0, 2000)}`);
      return parts.join("\n");
    })
    .join("\n\n");

  const clipped =
    timeline.length > 24_000 ? `${timeline.slice(0, 24_000)}\n…` : timeline;

  const prompt = [
    "You are Coco, a desktop study companion that turns a capture session into a readable study note.",
    "Write one Markdown study sheet the learner can re-read to understand what they covered — NOT a raw event log.",
    "The learner must leave with a concrete Big idea and quiz questions grounded in THEIR session content.",
    "",
    "Required structure (use these headings exactly):",
    "# <short topic title inferred from the session>",
    "",
    "Tags: <2–5 short topic tags separated by | >",
    "",
    "## Overview",
    "2–4 sentences explaining what this session was about and why it mattered,",
    "using the saved quotes, Q&A answers, and capture labels.",
    "",
    "> **Big idea:** <ONE concrete takeaway drawn from the session content — a claim, method, finding, or definition the learner actually captured.",
    "Never write vague advice like 'review your notes' or 'revisit your captures'.>",
    "",
    "## Key terms",
    "- **Term** — short plain-language definition (only terms that appear in the session)",
    "(If there are no clear terms, write: _(No key terms captured.)_)",
    "",
    "## What you covered",
    "Numbered list of the main ideas / steps / arguments from the session, in learning order.",
    "Each item: **Label** — 1 sentence of explanation grounded in the timeline.",
    "",
    "## Quotes & context",
    "For each note_silent capture:",
    "  * A verbatim blockquote of the user's exact text (never rewrite the quote).",
    "  * Then **Context:** 1–3 sentences using nearby notes, Q&A, and capture labels to explain why it mattered.",
    "If none: _(No quotes captured.)_",
    "",
    "## Self-check",
    "2–4 short Q&A pairs that test what was actually in this session.",
    "Rules for Self-check:",
    "  * Prefer real qa/explain events from the timeline (use those Q/A).",
    "  * If none, write review questions whose answers are clearly supported by the quotes/labels/overview.",
    "  * Answers must state the content (facts/claims from the session), not tell the user to 'skim above'.",
    "  * Bad: 'What did you capture?' / 'Skim your quotes…'",
    "  * Good: 'What study design did the authors use?' / 'A case-control study of …'",
    "Format each as:",
    "**Q:** ...",
    "**A:** ...",
    "",
    "## Captures to review",
    "Bullet list of screenshot/recording labels only (human titles). Do NOT invent filenames. Skip if none.",
    "",
    "Hard rules:",
    "- Do not invent facts, papers, numbers, or UI details that are not supported by the timeline.",
    "- Do not dump timestamps, file paths, or event IDs.",
    "- Prefer teaching clarity over chronological dump.",
    "- Output Markdown only — no preamble.",
    "",
    `Source: ${input.sourceLabel?.trim() || "unknown"}`,
    `Started: ${
      input.startedAt ? new Date(input.startedAt).toISOString() : "unknown"
    }`,
    "",
    "Timeline events:",
    clipped,
  ].join("\n");

  const { text: markdown } = await generateTextWithRetries(prompt, {
    temperature: 0.35,
    maxOutputTokens: 4096,
  });
  return markdown;
}
