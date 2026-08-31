/** Cartesia Sonic TTS — preferred low-latency speech-out. */

export function hasCartesia(): boolean {
  return Boolean(process.env.CARTESIA_API_KEY?.trim());
}

export function getCartesiaTtsModel(): string {
  return process.env.CARTESIA_TTS_MODEL?.trim() || "sonic-turbo";
}

export function getCartesiaVoiceId(): string {
  // Default: Cartesia playground English voice from their docs.
  return (
    process.env.CARTESIA_VOICE_ID?.trim() ||
    "a0e99841-438c-4a64-b679-ae501e7d6091"
  );
}

function cartesiaKey(): string {
  const key = process.env.CARTESIA_API_KEY?.trim();
  if (!key) {
    throw new Error("Missing CARTESIA_API_KEY.");
  }
  return key;
}

export async function cartesiaSpeak(input: {
  text: string;
}): Promise<{ audioBase64: string; mimeType: string; model: string }> {
  const text = input.text.replace(/\s+/g, " ").trim();
  if (!text) {
    throw new Error("No text provided to speak.");
  }

  const clipped = text.length > 1200 ? `${text.slice(0, 1200)}…` : text;
  const model = getCartesiaTtsModel();
  const voiceId = getCartesiaVoiceId();
  const version =
    process.env.CARTESIA_VERSION?.trim() || "2025-04-16";

  const res = await fetch("https://api.cartesia.ai/tts/bytes", {
    method: "POST",
    headers: {
      "X-API-Key": cartesiaKey(),
      "Cartesia-Version": version,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model_id: model,
      transcript: clipped,
      language: "en",
      voice: {
        mode: "id",
        id: voiceId,
      },
      output_format: {
        container: "wav",
        encoding: "pcm_s16le",
        sample_rate: 24000,
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(
      `Cartesia TTS failed (${res.status}): ${errText.slice(0, 240)}`,
    );
  }

  const bytes = Buffer.from(await res.arrayBuffer());
  const mimeType = res.headers.get("content-type") || "audio/wav";
  return {
    audioBase64: bytes.toString("base64"),
    mimeType,
    model,
  };
}
