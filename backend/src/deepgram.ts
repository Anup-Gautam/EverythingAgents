import { requiredEnv } from "./env";

function deepgramKey(): string {
  return requiredEnv("DEEPGRAM_API_KEY");
}

export function getDeepgramSttModel(): string {
  return process.env.DEEPGRAM_STT_MODEL?.trim() || "nova-3";
}

export function getDeepgramTtsModel(): string {
  return process.env.DEEPGRAM_TTS_MODEL?.trim() || "flux-alexis-en";
}

export function hasDeepgram(): boolean {
  return Boolean(process.env.DEEPGRAM_API_KEY?.trim());
}

function isFluxTtsModel(model: string): boolean {
  return model.toLowerCase().startsWith("flux-");
}

export async function deepgramTranscribe(input: {
  audioBase64: string;
  mimeType: string;
}): Promise<string> {
  const audioBase64 = input.audioBase64.trim();
  if (!audioBase64) {
    throw new Error("No audio provided to transcribe.");
  }

  const approxBytes = Math.floor((audioBase64.length * 3) / 4);
  if (approxBytes > 3 * 1024 * 1024) {
    throw new Error("Audio clip too large. Keep commands under a few seconds.");
  }

  const mimeType = input.mimeType.trim() || "audio/webm";
  const model = getDeepgramSttModel();
  const url = new URL("https://api.deepgram.com/v1/listen");
  url.searchParams.set("model", model);
  url.searchParams.set("smart_format", "true");
  url.searchParams.set("punctuate", "false");

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Token ${deepgramKey()}`,
      "Content-Type": mimeType,
    },
    body: Buffer.from(audioBase64, "base64"),
  });

  const rawText = await res.text();
  if (!res.ok) {
    throw new Error(`Deepgram STT failed (${res.status}): ${rawText.slice(0, 200)}`);
  }

  const data = JSON.parse(rawText) as {
    results?: {
      channels?: Array<{
        alternatives?: Array<{ transcript?: string }>;
      }>;
    };
  };

  const transcript =
    data.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() ?? "";
  if (!transcript) {
    throw new Error("Heard nothing clear — try again or type the command.");
  }
  return transcript;
}

export async function deepgramSpeak(input: {
  text: string;
}): Promise<{ audioBase64: string; mimeType: string; model: string }> {
  const text = input.text.replace(/\s+/g, " ").trim();
  if (!text) {
    throw new Error("No text provided to speak.");
  }

  // Keep replies short for cost + latency.
  const clipped = text.length > 1200 ? `${text.slice(0, 1200)}…` : text;
  const model = getDeepgramTtsModel();
  // Flux voices require /v2/speak; Aura stays on /v1/speak.
  const path = isFluxTtsModel(model) ? "/v2/speak" : "/v1/speak";
  const url = new URL(`https://api.deepgram.com${path}`);
  url.searchParams.set("model", model);
  if (isFluxTtsModel(model)) {
    url.searchParams.set("encoding", "mp3");
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Token ${deepgramKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text: clipped }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Deepgram TTS failed (${res.status}): ${errText.slice(0, 200)}`);
  }

  const bytes = Buffer.from(await res.arrayBuffer());
  const mimeType = res.headers.get("content-type") || "audio/mpeg";
  return {
    audioBase64: bytes.toString("base64"),
    mimeType,
    model,
  };
}
