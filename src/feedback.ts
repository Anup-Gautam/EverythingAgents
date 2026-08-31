/** Voice feedback: beeps for capture; cloud TTS (Cartesia/Deepgram) for speak. */

let audioCtx: AudioContext | null = null;
let currentSpeech: HTMLAudioElement | null = null;

function getAudioContext(): AudioContext {
  if (!audioCtx) {
    audioCtx = new AudioContext();
  }
  return audioCtx;
}

async function resumeAudio(): Promise<AudioContext> {
  const ctx = getAudioContext();
  if (ctx.state === "suspended") {
    await ctx.resume();
  }
  return ctx;
}

export async function playSuccessChime(): Promise<void> {
  try {
    const ctx = await resumeAudio();
    const now = ctx.currentTime;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.12, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
    gain.connect(ctx.destination);

    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.exponentialRampToValueAtTime(1320, now + 0.12);
    osc.connect(gain);
    osc.start(now);
    osc.stop(now + 0.24);
  } catch {
    // Ignore audio failures — caption still shows.
  }
}

export async function playErrorChime(): Promise<void> {
  try {
    const ctx = await resumeAudio();
    const now = ctx.currentTime;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.1, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
    gain.connect(ctx.destination);

    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(240, now);
    osc.frequency.exponentialRampToValueAtTime(160, now + 0.2);
    osc.connect(gain);
    osc.start(now);
    osc.stop(now + 0.3);
  } catch {
    // ignore
  }
}

function speakWithSystemVoice(text: string): void {
  if (typeof window.speechSynthesis === "undefined") return;
  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.05;
    utterance.pitch = 1;
    utterance.volume = 1;
    const voices = window.speechSynthesis.getVoices();
    const preferred =
      voices.find((v) => /samantha|karen|moira|female/i.test(v.name)) ||
      voices.find((v) => v.lang.toLowerCase().startsWith("en")) ||
      null;
    if (preferred) utterance.voice = preferred;
    window.speechSynthesis.speak(utterance);
  } catch {
    // ignore
  }
}

export async function speakText(text: string): Promise<void> {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return;

  stopSpeaking();

  try {
    if (!window.coco?.speakText) {
      console.warn("[coco] speakText IPC missing — using system voice");
      speakWithSystemVoice(clean);
      return;
    }
    const result = await window.coco.speakText(clean);
    if (result?.ok) {
      console.info("[coco] speaking", {
        provider: result.provider,
        model: result.model,
      });
      const audio = new Audio(
        `data:${result.mimeType};base64,${result.audioBase64}`,
      );
      currentSpeech = audio;
      await audio.play();
      return;
    }
    console.warn("[coco] cloud speak failed — using system voice", result);
  } catch (err) {
    console.warn("[coco] speak error — using system voice", err);
  }

  speakWithSystemVoice(clean);
}

export function stopSpeaking(): void {
  try {
    if (currentSpeech) {
      currentSpeech.pause();
      currentSpeech.src = "";
      currentSpeech = null;
    }
    window.speechSynthesis?.cancel();
  } catch {
    // ignore
  }
}
