import { genkit } from "genkit";
import { googleAI } from "@genkit-ai/google-genai";
import { requiredEnv } from "./env";

function geminiModelName(): string {
  return process.env.GEMINI_MODEL?.trim() || "gemini-3.6-flash";
}

/**
 * Google Genkit + Gemini Developer API (GEMINI_API_KEY).
 * Used for session note synthesize (hackathon agent-framework requirement).
 */
export const ai = genkit({
  plugins: [
    googleAI({
      apiKey: requiredEnv("GEMINI_API_KEY"),
    }),
  ],
  model: googleAI.model(geminiModelName()),
});

export function genkitGeminiModelRef() {
  return googleAI.model(geminiModelName());
}

export function genkitReportedModelName(): string {
  return geminiModelName();
}
