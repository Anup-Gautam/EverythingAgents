/** Optional local speech recognition via Chromium (no Gemini / no API key). */

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type SpeechRecognitionEventLike = {
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
};

function getRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  const w = window as Window & {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function isSpeechRecognitionAvailable(): boolean {
  return getRecognitionCtor() !== null;
}

export function listenOnce(options?: {
  lang?: string;
  timeoutMs?: number;
}): Promise<string> {
  const Ctor = getRecognitionCtor();
  if (!Ctor) {
    return Promise.reject(new Error("Speech recognition unavailable"));
  }

  const timeoutMs = options?.timeoutMs ?? 8000;

  return new Promise((resolve, reject) => {
    const recognition = new Ctor();
    recognition.lang = options?.lang ?? "en-US";
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.maxAlternatives = 1;

    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        recognition.stop();
      } catch {
        // ignore
      }
      reject(new Error("Listening timed out — try typing instead"));
    }, timeoutMs);

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      fn();
    };

    recognition.onresult = (event) => {
      const result = event.results[event.results.length - 1];
      const transcript = result?.[0]?.transcript?.trim() ?? "";
      finish(() => {
        if (transcript) resolve(transcript);
        else reject(new Error("Heard nothing — try typing instead"));
      });
    };

    recognition.onerror = (event) => {
      finish(() => {
        reject(new Error(`Mic/speech error: ${event.error}`));
      });
    };

    recognition.onend = () => {
      finish(() => {
        reject(new Error("Listening ended — try typing instead"));
      });
    };

    try {
      recognition.start();
    } catch (err) {
      finish(() => {
        reject(err instanceof Error ? err : new Error("Could not start mic"));
      });
    }
  });
}
