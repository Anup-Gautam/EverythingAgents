import { z } from "genkit";
import {
  ai,
  genkitGeminiModelRef,
  genkitReportedModelName,
} from "../genkitApp";

const SynthesisEventSchema = z.object({
  type: z.string(),
  timestamp: z.number(),
  text: z.string().optional(),
  fileName: z.string().optional(),
  question: z.string().optional(),
  answer: z.string().optional(),
  label: z.string().optional(),
});

const SynthesizeInputSchema = z.object({
  sourceLabel: z.string().optional(),
  startedAt: z.number().optional(),
  events: z.array(SynthesisEventSchema).min(1),
});

export type SynthesizeFlowEvent = z.infer<typeof SynthesisEventSchema>;

function buildSynthesizePrompt(input: {
  sourceLabel?: string;
  startedAt?: number;
  events: SynthesizeFlowEvent[];
}): string {
  const timeline = input.events
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

  return [
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
}

/**
 * Genkit flow: session timeline → Markdown study note (Gemini).
 * Callable from Express `/session/synthesize`.
 */
export const synthesizeNotesFlow = ai.defineFlow(
  {
    name: "synthesizeNotes",
    inputSchema: SynthesizeInputSchema,
    outputSchema: z.object({
      markdown: z.string(),
      model: z.string(),
      framework: z.literal("genkit"),
    }),
  },
  async (input) => {
    const prompt = buildSynthesizePrompt(input);
    const { text } = await ai.generate({
      model: genkitGeminiModelRef(),
      prompt,
      config: {
        temperature: 0.35,
        maxOutputTokens: 4096,
      },
    });

    const markdown = String(text ?? "").trim();
    if (!markdown) {
      throw new Error("Genkit synthesize returned empty markdown.");
    }

    return {
      markdown,
      model: genkitReportedModelName(),
      framework: "genkit" as const,
    };
  },
);

export async function runSynthesizeNotesFlow(input: {
  sourceLabel?: string;
  startedAt?: number;
  events: SynthesizeFlowEvent[];
}): Promise<{ markdown: string; model: string; framework: "genkit" }> {
  if (!input.events?.length) {
    throw new Error("No session events to synthesize.");
  }
  return synthesizeNotesFlow(input);
}
