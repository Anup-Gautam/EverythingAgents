import "./env";
import cors from "cors";
import express from "express";
import {
  getCartesiaTtsModel,
  hasCartesia,
} from "./cartesia";
import {
  getDeepgramSttModel,
  getDeepgramTtsModel,
  hasDeepgram,
} from "./deepgram";
import { getPort, requiredEnv } from "./env";
import { initFirebase } from "./firebase";
import { getGeminiModelName } from "./gemini";
import { getGroqSttModel, hasGroq } from "./groq";
import { explainRouter } from "./routes/explain";
import { captionRouter } from "./routes/caption";
import { sessionRouter } from "./routes/session";
import { speakRouter } from "./routes/speak";
import { transcribeRouter } from "./routes/transcribe";

const app = express();

app.use(cors());
app.use(express.json({ limit: "40mb" }));

function resolveSttProvider(): string {
  if (hasGroq()) return "groq";
  if (hasDeepgram()) return "deepgram";
  return "gemini";
}

function resolveTtsProvider(): string {
  if (hasCartesia()) return "cartesia";
  if (hasDeepgram()) return "deepgram";
  return "system";
}

app.get("/health", (_req, res) => {
  const stt = resolveSttProvider();
  const tts = resolveTtsProvider();
  res.json({
    ok: true,
    service: "coco-api",
    projectId: process.env.FIREBASE_PROJECT_ID ?? null,
    hasBucket: Boolean(process.env.GCS_BUCKET?.trim()),
    hasGemini: Boolean(process.env.GEMINI_API_KEY?.trim()),
    hasGroq: hasGroq(),
    hasCartesia: hasCartesia(),
    hasDeepgram: hasDeepgram(),
    geminiModel: process.env.GEMINI_API_KEY?.trim()
      ? getGeminiModelName()
      : null,
    voice: {
      stt,
      tts,
      sttModel:
        stt === "groq"
          ? getGroqSttModel()
          : stt === "deepgram"
            ? getDeepgramSttModel()
            : getGeminiModelName(),
      ttsModel:
        tts === "cartesia"
          ? getCartesiaTtsModel()
          : tts === "deepgram"
            ? getDeepgramTtsModel()
            : null,
    },
    notes: {
      synthesize: true,
      synthesizeFramework: "genkit",
      caption: true,
      eventTypes: ["screenshot", "note_silent", "qa", "recording"],
      cloudSync: [
        "firestore_session",
        "firestore_notes_qa",
        "gcs_screenshots",
        "gcs_recordings",
        "firestore_study_note",
        "gcs_study_note",
      ],
      output: "html",
    },
  });
});

app.use("/session", sessionRouter);
app.use("/explain", explainRouter);
app.use("/caption", captionRouter);
app.use("/transcribe", transcribeRouter);
app.use("/speak", speakRouter);

app.use((_req, res) => {
  res.status(404).json({ error: "Not found." });
});

function main(): void {
  requiredEnv("FIREBASE_PROJECT_ID");
  requiredEnv("GOOGLE_APPLICATION_CREDENTIALS");
  requiredEnv("GCS_BUCKET");
  requiredEnv("GEMINI_API_KEY");
  initFirebase();

  const port = getPort();
  app.listen(port, "127.0.0.1", () => {
    console.info(`[coco-api] listening on http://127.0.0.1:${port}`);
    console.info(`[coco-api] Gemini model: ${getGeminiModelName()}`);
    console.info(
      `[coco-api] Voice STT=${resolveSttProvider()} TTS=${resolveTtsProvider()}`,
    );
    if (hasGroq()) {
      console.info(`[coco-api] Groq STT model=${getGroqSttModel()}`);
    }
    if (hasCartesia()) {
      console.info(`[coco-api] Cartesia TTS model=${getCartesiaTtsModel()}`);
    }
    if (hasDeepgram()) {
      console.info(
        `[coco-api] Deepgram fallback STT=${getDeepgramSttModel()} TTS=${getDeepgramTtsModel()}`,
      );
    }
    console.info("[coco-api] GET  /health");
    console.info("[coco-api] POST /session/start");
    console.info("[coco-api] POST /session/event");
    console.info("[coco-api] POST /session/end");
    console.info("[coco-api] POST /session/synthesize (Genkit + Gemini)");
    console.info("[coco-api] POST /explain");
    console.info("[coco-api] POST /caption");
    console.info("[coco-api] POST /transcribe");
    console.info("[coco-api] POST /speak");
  });
}

main();
