/** Groq Whisper STT — preferred low-latency speech-to-text. */

export function hasGroq(): boolean {
  return Boolean(process.env.GROQ_API_KEY?.trim());
}

export function getGroqSttModel(): string {
  return process.env.GROQ_STT_MODEL?.trim() || "whisper-large-v3-turbo";
}

function groqKey(): string {
  const key = process.env.GROQ_API_KEY?.trim();
  if (!key) {
    throw new Error("Missing GROQ_API_KEY.");
  }
  return key;
}

function extensionForMime(mimeType: string): string {
  const mime = mimeType.toLowerCase();
  if (mime.includes("wav")) return "wav";
  if (mime.includes("mp4") || mime.includes("m4a")) return "m4a";
  if (mime.includes("mpeg") || mime.includes("mp3")) return "mp3";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("flac")) return "flac";
  return "webm";
}

export async function groqTranscribe(input: {
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
  const bytes = Buffer.from(audioBase64, "base64");
  const filename = `command.${extensionForMime(mimeType)}`;
  const model = getGroqSttModel();

  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(bytes)], { type: mimeType }),
    filename,
  );
  form.append("model", model);
  form.append("language", "en");
  form.append("response_format", "json");
  form.append("temperature", "0");

  const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${groqKey()}`,
    },
    body: form,
  });

  const rawText = await res.text();
  if (!res.ok) {
    throw new Error(`Groq STT failed (${res.status}): ${rawText.slice(0, 240)}`);
  }

  const data = JSON.parse(rawText) as { text?: string };
  const transcript = data.text?.trim() ?? "";
  if (!transcript) {
    throw new Error("Heard nothing clear — try again or type the command.");
  }
  return transcript;
}
