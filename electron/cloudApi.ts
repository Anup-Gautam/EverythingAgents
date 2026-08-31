const DEFAULT_API_BASE = "http://127.0.0.1:8080";

export function getApiBaseUrl(): string | null {
  const raw = (
    process.env.VITE_API_BASE_URL ||
    process.env.COCO_API_BASE_URL ||
    ""
  ).trim();
  if (!raw) return null;
  return raw.replace(/\/+$/, "");
}

export function resolveApiBaseUrl(): string {
  return getApiBaseUrl() ?? DEFAULT_API_BASE;
}

type StartOk = { ok: true; sessionId: string };
type StartErr = { ok: false; error: string };
type EventOk = { ok: true; eventId: string; storagePath: string };
type EventErr = { ok: false; error: string };
type ExplainOk = { ok: true; answer: string; model: string };
type ExplainErr = { ok: false; error: string };
type TranscribeOk = { ok: true; transcript: string; model: string };
type TranscribeErr = { ok: false; error: string };
type SpeakOk = {
  ok: true;
  audioBase64: string;
  mimeType: string;
  model: string;
  provider?: string;
};
type SpeakErr = { ok: false; error: string };
type EventTextOk = { ok: true; eventId: string };
type EndOk = { ok: true; status: string };
type SynthOk = { ok: true; markdown: string; model: string };
type SynthErr = { ok: false; error: string };

export async function apiStartSession(input: {
  idToken: string;
  sourceLabel: string;
  sourceType: string;
  localSessionId: string;
}): Promise<StartOk | StartErr> {
  const base = resolveApiBaseUrl();
  try {
    const res = await fetch(`${base}/session/start`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.idToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sourceLabel: input.sourceLabel,
        sourceType: input.sourceType,
        localSessionId: input.localSessionId,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      sessionId?: string;
      error?: string;
      detail?: string;
    };
    if (!res.ok || !data.sessionId) {
      return {
        ok: false,
        error: data.error || data.detail || `HTTP ${res.status}`,
      };
    }
    return { ok: true, sessionId: data.sessionId };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function apiUploadScreenshot(input: {
  idToken: string;
  cloudSessionId: string;
  fileName: string;
  imageBase64: string;
}): Promise<EventOk | EventErr> {
  const base = resolveApiBaseUrl();
  try {
    const res = await fetch(`${base}/session/event`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.idToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionId: input.cloudSessionId,
        type: "screenshot",
        fileName: input.fileName,
        imageBase64: input.imageBase64,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      eventId?: string;
      storagePath?: string;
      error?: string;
      detail?: string;
    };
    if (!res.ok || !data.eventId || !data.storagePath) {
      return {
        ok: false,
        error: data.error || data.detail || `HTTP ${res.status}`,
      };
    }
    return {
      ok: true,
      eventId: data.eventId,
      storagePath: data.storagePath,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function apiExplain(input: {
  idToken: string;
  text: string;
  question?: string;
}): Promise<ExplainOk | ExplainErr> {
  const base = resolveApiBaseUrl();
  try {
    const res = await fetch(`${base}/explain`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.idToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: input.text,
        question: input.question,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      answer?: string;
      model?: string;
      error?: string;
      detail?: string;
    };
    if (!res.ok || !data.answer) {
      return {
        ok: false,
        error: data.error || data.detail || `HTTP ${res.status}`,
      };
    }
    return {
      ok: true,
      answer: data.answer,
      model: data.model || "gemini",
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function apiTranscribe(input: {
  idToken: string;
  audioBase64: string;
  mimeType: string;
}): Promise<TranscribeOk | TranscribeErr> {
  const base = resolveApiBaseUrl();
  try {
    const res = await fetch(`${base}/transcribe`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.idToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        audioBase64: input.audioBase64,
        mimeType: input.mimeType,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      transcript?: string;
      model?: string;
      error?: string;
      detail?: string;
    };
    if (!res.ok || !data.transcript) {
      return {
        ok: false,
        error: data.error || data.detail || `HTTP ${res.status}`,
      };
    }
    return {
      ok: true,
      transcript: data.transcript,
      model: data.model || "gemini",
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function apiSpeak(input: {
  idToken: string;
  text: string;
}): Promise<SpeakOk | SpeakErr> {
  const base = resolveApiBaseUrl();
  try {
    const res = await fetch(`${base}/speak`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.idToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: input.text }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      audioBase64?: string;
      mimeType?: string;
      model?: string;
      provider?: string;
      error?: string;
      detail?: string;
    };
    if (!res.ok || !data.audioBase64) {
      return {
        ok: false,
        error: data.error || data.detail || `HTTP ${res.status}`,
      };
    }
    return {
      ok: true,
      audioBase64: data.audioBase64,
      mimeType: data.mimeType || "audio/wav",
      model: data.model || "tts",
      provider: data.provider,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function apiUploadTextEvent(input: {
  idToken: string;
  cloudSessionId: string;
  type: "note_silent" | "qa";
  text?: string;
  question?: string;
  answer?: string;
  timestamp?: number;
}): Promise<EventTextOk | EventErr> {
  const base = resolveApiBaseUrl();
  try {
    const res = await fetch(`${base}/session/event`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.idToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionId: input.cloudSessionId,
        type: input.type,
        text: input.text,
        question: input.question,
        answer: input.answer,
        timestamp: input.timestamp,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      eventId?: string;
      error?: string;
      detail?: string;
    };
    if (!res.ok || !data.eventId) {
      return {
        ok: false,
        error: data.error || data.detail || `HTTP ${res.status}`,
      };
    }
    return { ok: true, eventId: data.eventId };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function apiEndSession(input: {
  idToken: string;
  cloudSessionId: string;
}): Promise<EndOk | EventErr> {
  const base = resolveApiBaseUrl();
  try {
    const res = await fetch(`${base}/session/end`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.idToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sessionId: input.cloudSessionId }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      status?: string;
      error?: string;
      detail?: string;
    };
    if (!res.ok) {
      return {
        ok: false,
        error: data.error || data.detail || `HTTP ${res.status}`,
      };
    }
    return { ok: true, status: data.status || "complete" };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function apiSynthesize(input: {
  idToken: string;
  cloudSessionId?: string | null;
  sourceLabel?: string;
  startedAt?: number;
  events: Array<{
    type: string;
    timestamp: number;
    text?: string;
    fileName?: string;
    question?: string;
    answer?: string;
    label?: string;
  }>;
}): Promise<SynthOk | SynthErr> {
  const base = resolveApiBaseUrl();
  try {
    const res = await fetch(`${base}/session/synthesize`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.idToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionId: input.cloudSessionId || undefined,
        sourceLabel: input.sourceLabel,
        startedAt: input.startedAt,
        events: input.events,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      markdown?: string;
      model?: string;
      error?: string;
      detail?: string;
    };
    if (!res.ok || !data.markdown) {
      return {
        ok: false,
        error: data.error || data.detail || `HTTP ${res.status}`,
      };
    }
    return {
      ok: true,
      markdown: data.markdown,
      model: data.model || "gemini",
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function apiCaption(input: {
  idToken: string;
  kind: "screenshot" | "recording";
  imageBase64?: string;
  mimeType?: string;
  fileName?: string;
  sourceLabel?: string;
  recentContext?: string;
  hint?: string;
}): Promise<{ ok: true; label: string } | { ok: false; error: string }> {
  const base = resolveApiBaseUrl();
  try {
    const res = await fetch(`${base}/caption`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.idToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        kind: input.kind,
        imageBase64: input.imageBase64,
        mimeType: input.mimeType,
        fileName: input.fileName,
        sourceLabel: input.sourceLabel,
        recentContext: input.recentContext,
        hint: input.hint,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      label?: string;
      error?: string;
      detail?: string;
    };
    if (!res.ok || !data.label) {
      return {
        ok: false,
        error: data.error || data.detail || `HTTP ${res.status}`,
      };
    }
    return { ok: true, label: data.label };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
