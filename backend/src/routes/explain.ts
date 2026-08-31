import { Router } from "express";
import { requireAuth } from "../auth";
import { explainText, getGeminiModelName } from "../gemini";

type ExplainBody = {
  text?: string;
  question?: string;
};

export const explainRouter = Router();

/**
 * Explain highlighted / clipboard text with Gemini.
 * POST /explain
 * Authorization: Bearer <Firebase ID token>
 * Body: { text: string, question?: string }
 */
explainRouter.post("/", requireAuth, async (req, res) => {
  try {
    const body = (req.body ?? {}) as ExplainBody;
    const text = String(body.text ?? "").trim();
    if (!text) {
      res.status(400).json({
        error: "Copy or select some text first, then ask Coco to explain.",
      });
      return;
    }

    const answer = await explainText({
      text,
      question: body.question ? String(body.question) : undefined,
    });

    res.json({
      answer,
      model: getGeminiModelName(),
      charCount: text.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[coco-api] /explain failed", message);
    res.status(500).json({ error: "Explain failed.", detail: message });
  }
});
