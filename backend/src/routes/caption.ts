import { Router } from "express";
import { requireAuth } from "../auth";
import {
  captionImage,
  captionRecordingFromContext,
  getGeminiModelName,
} from "../gemini";

type CaptionBody = {
  kind?: "screenshot" | "recording";
  imageBase64?: string;
  mimeType?: string;
  fileName?: string;
  sourceLabel?: string;
  recentContext?: string;
  hint?: string;
};

export const captionRouter = Router();

/**
 * Label a screenshot (vision) or recording (session-context).
 * POST /caption
 * Authorization: Bearer <Firebase ID token>
 */
captionRouter.post("/", requireAuth, async (req, res) => {
  try {
    const body = (req.body ?? {}) as CaptionBody;
    const kind = body.kind === "recording" ? "recording" : "screenshot";

    if (kind === "screenshot") {
      const imageBase64 = String(body.imageBase64 ?? "").trim();
      if (!imageBase64) {
        res.status(400).json({ error: "imageBase64 is required for screenshots." });
        return;
      }
      const label = await captionImage({
        imageBase64,
        mimeType: body.mimeType,
        hint: body.hint || body.sourceLabel,
      });
      res.json({ label, kind, model: getGeminiModelName() });
      return;
    }

    const label = await captionRecordingFromContext({
      fileName: body.fileName,
      sourceLabel: body.sourceLabel,
      recentContext: body.recentContext,
    });
    res.json({ label, kind, model: getGeminiModelName() });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[coco-api] /caption failed", message);
    res.status(500).json({ error: "Caption failed.", detail: message });
  }
});
