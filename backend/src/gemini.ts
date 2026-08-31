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
  const { runSynthesizeNotesFlow } = await import("./flows/synthesizeNotes");
  const result = await runSynthesizeNotesFlow(input);
  return result.markdown;
}
