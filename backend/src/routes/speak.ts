import { Router } from "express";
import { requireAuth } from "../auth";
import {
  cartesiaSpeak,
  getCartesiaTtsModel,
  hasCartesia,
} from "../cartesia";
import {
  deepgramSpeak,
  getDeepgramTtsModel,
  hasDeepgram,
} from "../deepgram";

type SpeakBody = {
  text?: string;
};

export const speakRouter = Router();

/**
 * TTS: Cartesia → Deepgram. Client falls back to system voice if both fail.
 * POST /speak
 * Authorization: Bearer <Firebase ID token>
 * Body: { text: string }
 */
speakRouter.post("/", requireAuth, async (req, res) => {
  try {
    const body = (req.body ?? {}) as SpeakBody;
    const text = String(body.text ?? "").trim();
    if (!text) {
      res.status(400).json({ error: "text is required." });
      return;
    }

    if (hasCartesia()) {
      try {
        const spoken = await cartesiaSpeak({ text });
        res.json({
          audioBase64: spoken.audioBase64,
          mimeType: spoken.mimeType,
          provider: "cartesia",
          model: spoken.model || getCartesiaTtsModel(),
        });
        return;
      } catch (err) {
        console.warn(
          "[coco-api] Cartesia TTS failed, trying Deepgram",
          err instanceof Error ? err.message : err,
        );
      }
    }

    if (hasDeepgram()) {
      const spoken = await deepgramSpeak({ text });
      res.json({
        audioBase64: spoken.audioBase64,
        mimeType: spoken.mimeType,
        provider: "deepgram",
        model: spoken.model || getDeepgramTtsModel(),
      });
      return;
    }

    res.status(503).json({
      error:
        "No TTS provider configured. Set CARTESIA_API_KEY (preferred) or DEEPGRAM_API_KEY.",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[coco-api] /speak failed", message);
    res.status(500).json({ error: "Speak failed.", detail: message });
  }
});
