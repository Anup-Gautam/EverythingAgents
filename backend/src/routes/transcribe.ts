import { Router } from "express";
import { requireAuth } from "../auth";
import {
  deepgramTranscribe,
  getDeepgramSttModel,
  hasDeepgram,
} from "../deepgram";
import { getGeminiModelName, transcribeAudio } from "../gemini";
import { getGroqSttModel, groqTranscribe, hasGroq } from "../groq";

type TranscribeBody = {
  audioBase64?: string;
  mimeType?: string;
};

export const transcribeRouter = Router();

/**
 * Speech-to-text: Groq Whisper → Deepgram → Gemini.
 * POST /transcribe
 * Authorization: Bearer <Firebase ID token>
 */
transcribeRouter.post("/", requireAuth, async (req, res) => {
  try {
    const body = (req.body ?? {}) as TranscribeBody;
    const audioBase64 = String(body.audioBase64 ?? "").trim();
    if (!audioBase64) {
      res.status(400).json({ error: "audioBase64 is required." });
      return;
    }

    const mimeType =
      String(body.mimeType ?? "audio/webm").trim() || "audio/webm";

    if (hasGroq()) {
      try {
        const transcript = await groqTranscribe({ audioBase64, mimeType });
        res.json({
          transcript,
          provider: "groq",
          model: getGroqSttModel(),
        });
        return;
      } catch (err) {
        console.warn(
          "[coco-api] Groq STT failed, trying next provider",
          err instanceof Error ? err.message : err,
        );
      }
    }

    if (hasDeepgram()) {
      try {
        const transcript = await deepgramTranscribe({ audioBase64, mimeType });
        res.json({
          transcript,
          provider: "deepgram",
          model: getDeepgramSttModel(),
        });
        return;
      } catch (err) {
        console.warn(
          "[coco-api] Deepgram STT failed, trying Gemini",
          err instanceof Error ? err.message : err,
        );
      }
    }

    const transcript = await transcribeAudio({ audioBase64, mimeType });
    res.json({
      transcript,
      provider: "gemini",
      model: getGeminiModelName(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[coco-api] /transcribe failed", message);
    res.status(500).json({ error: "Transcribe failed.", detail: message });
  }
});
