import { randomUUID } from "node:crypto";
import { Router } from "express";
import multer from "multer";
import admin from "firebase-admin";
import { requireAuth } from "../auth";
import { getBucket, getFirestore } from "../firebase";
import {
  getGeminiModelName,
  synthesizeSessionNotes,
  type SynthesisEvent,
} from "../gemini";

type StartSessionBody = {
  sourceLabel?: string;
  sourceType?: "screen" | "window" | string;
  localSessionId?: string;
};

type EventJsonBody = {
  sessionId?: string;
  type?: string;
  fileName?: string;
  /** raw base64 or data-URL for PNG (curl-friendly) */
  imageBase64?: string;
  text?: string;
  question?: string;
  answer?: string;
  timestamp?: number;
};

type EndSessionBody = {
  sessionId?: string;
};

type SynthesizeBody = {
  sessionId?: string;
  sourceLabel?: string;
  startedAt?: number;
  events?: SynthesisEvent[];
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
});

export const sessionRouter = Router();

function sessionRef(uid: string, sessionId: string) {
  return getFirestore()
    .collection("users")
    .doc(uid)
    .collection("sessions")
    .doc(sessionId);
}

/**
 * Create a cloud session for the signed-in user.
 * POST /session/start
 */
sessionRouter.post("/start", requireAuth, async (req, res) => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Unauthorized." });
      return;
    }

    const body = (req.body ?? {}) as StartSessionBody;
    const sessionId = randomUUID();
    const startedAt = Date.now();

    const doc = {
      sessionId,
      userId: user.uid,
      email: user.email,
      sourceLabel: body.sourceLabel?.trim() || null,
      sourceType: body.sourceType?.trim() || null,
      localSessionId: body.localSessionId?.trim() || null,
      status: "active" as const,
      startedAt,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    await sessionRef(user.uid, sessionId).set(doc);

    res.status(201).json({
      sessionId,
      userId: user.uid,
      status: "active",
      startedAt,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[coco-api] /session/start failed", message);
    res.status(500).json({ error: "Failed to start session.", detail: message });
  }
});

function decodeImageBase64(raw: string): Buffer {
  const trimmed = raw.trim();
  const comma = trimmed.indexOf(",");
  const b64 =
    trimmed.startsWith("data:") && comma >= 0
      ? trimmed.slice(comma + 1)
      : trimmed;
  return Buffer.from(b64, "base64");
}

/**
 * Session events: screenshot (GCS) | note_silent | qa
 * POST /session/event
 */
sessionRouter.post(
  "/event",
  requireAuth,
  upload.single("file"),
  async (req, res) => {
    try {
      const user = req.user;
      if (!user) {
        res.status(401).json({ error: "Unauthorized." });
        return;
      }

      const body = (req.body ?? {}) as EventJsonBody;
      const sessionId = String(body.sessionId ?? "").trim();
      const type = String(body.type ?? "").trim() || "screenshot";

      if (!sessionId) {
        res.status(400).json({ error: "sessionId is required." });
        return;
      }

      if (type !== "screenshot" && type !== "note_silent" && type !== "qa") {
        res.status(400).json({
          error: "Supported types: screenshot, note_silent, qa.",
        });
        return;
      }

      const sessionSnap = await sessionRef(user.uid, sessionId).get();
      if (!sessionSnap.exists) {
        res.status(404).json({ error: "Session not found for this user." });
        return;
      }

      const eventId = randomUUID();
      const timestamp =
        typeof body.timestamp === "number" && Number.isFinite(body.timestamp)
          ? body.timestamp
          : Date.now();

      if (type === "note_silent" || type === "qa") {
        const text = String(body.text ?? "").trim();
        if (type === "note_silent" && !text) {
          res.status(400).json({ error: "text is required for note_silent." });
          return;
        }
        if (type === "qa") {
          const answer = String(body.answer ?? "").trim();
          if (!answer) {
            res.status(400).json({ error: "answer is required for qa." });
            return;
          }
        }

        const eventDoc = {
          eventId,
          sessionId,
          userId: user.uid,
          type,
          text: text || null,
          question: String(body.question ?? "").trim() || null,
          answer: String(body.answer ?? "").trim() || null,
          timestamp,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        };

        await sessionRef(user.uid, sessionId)
          .collection("events")
          .doc(eventId)
          .set(eventDoc);

        res.status(201).json({
          eventId,
          sessionId,
          type,
          timestamp,
        });
        return;
      }

      // screenshot
      let bytes: Buffer | null = null;
      let contentType = "image/png";
      let fileName =
        String(body.fileName ?? "").trim() || `screenshot-${Date.now()}.png`;

      if (req.file?.buffer?.length) {
        bytes = req.file.buffer;
        contentType = req.file.mimetype || contentType;
        if (req.file.originalname) {
          fileName = req.file.originalname;
        }
      } else if (body.imageBase64) {
        bytes = decodeImageBase64(body.imageBase64);
      }

      if (!bytes || bytes.length === 0) {
        res.status(400).json({
          error: "Missing screenshot file (multipart file or imageBase64).",
        });
        return;
      }

      const storagePath = `users/${user.uid}/sessions/${sessionId}/screenshots/${eventId}.png`;

      const gcsFile = getBucket().file(storagePath);
      await gcsFile.save(bytes, {
        resumable: false,
        contentType,
        metadata: {
          metadata: {
            userId: user.uid,
            sessionId,
            eventId,
            type,
            originalFileName: fileName,
          },
        },
      });

      const eventDoc = {
        eventId,
        sessionId,
        userId: user.uid,
        type: "screenshot" as const,
        fileName,
        contentType,
        byteSize: bytes.length,
        storagePath,
        timestamp,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      await sessionRef(user.uid, sessionId)
        .collection("events")
        .doc(eventId)
        .set(eventDoc);

      res.status(201).json({
        eventId,
        sessionId,
        type: "screenshot",
        storagePath,
        fileName,
        byteSize: bytes.length,
        timestamp,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[coco-api] /session/event failed", message);
      res.status(500).json({ error: "Failed to save event.", detail: message });
    }
  },
);

/**
 * Mark cloud session complete.
 * POST /session/end
 */
sessionRouter.post("/end", requireAuth, async (req, res) => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Unauthorized." });
      return;
    }

    const body = (req.body ?? {}) as EndSessionBody;
    const sessionId = String(body.sessionId ?? "").trim();
    if (!sessionId) {
      res.status(400).json({ error: "sessionId is required." });
      return;
    }

    const ref = sessionRef(user.uid, sessionId);
    const snap = await ref.get();
    if (!snap.exists) {
      res.status(404).json({ error: "Session not found for this user." });
      return;
    }

    const endedAt = Date.now();
    await ref.set(
      {
        status: "complete",
        endedAt,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    res.json({ sessionId, status: "complete", endedAt });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[coco-api] /session/end failed", message);
    res.status(500).json({ error: "Failed to end session.", detail: message });
  }
});

/**
 * Build markdown notes from the client timeline (Gemini).
 * POST /session/synthesize
 */
sessionRouter.post("/synthesize", requireAuth, async (req, res) => {
  try {
    const body = (req.body ?? {}) as SynthesizeBody;
    const events = Array.isArray(body.events) ? body.events : [];
    if (events.length === 0) {
      res.status(400).json({ error: "events array is required." });
      return;
    }

    const markdown = await synthesizeSessionNotes({
      sourceLabel: body.sourceLabel,
      startedAt: body.startedAt,
      events: events.map((e) => ({
        type: String(e.type ?? "unknown"),
        timestamp: Number(e.timestamp) || Date.now(),
        text: e.text ? String(e.text) : undefined,
        fileName: e.fileName ? String(e.fileName) : undefined,
        question: e.question ? String(e.question) : undefined,
        answer: e.answer ? String(e.answer) : undefined,
        label: e.label ? String(e.label) : undefined,
      })),
    });

    const sessionId = String(body.sessionId ?? "").trim();
    const user = req.user;
    if (sessionId && user) {
      try {
        await sessionRef(user.uid, sessionId).set(
          {
            status: "complete",
            finalNoteReady: true,
            synthesizedAt: Date.now(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      } catch (err) {
        console.warn("[coco-api] synthesize: could not update session status", err);
      }
    }

    res.json({
      markdown,
      model: getGeminiModelName(),
      eventCount: events.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[coco-api] /session/synthesize failed", message);
    res.status(500).json({ error: "Synthesize failed.", detail: message });
  }
});
