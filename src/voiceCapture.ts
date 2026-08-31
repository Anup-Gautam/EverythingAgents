/** Mic capture: short PTT clips + open-ended Remember dictation. */

function pickMimeType(): string {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
  ];
  for (const type of candidates) {
    if (
      typeof MediaRecorder !== "undefined" &&
      MediaRecorder.isTypeSupported(type)
    ) {
      return type;
    }
  }
  return "audio/webm";
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read audio clip"));
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(blob);
  });
}

export async function recordVoiceCommand(options?: {
  durationMs?: number;
}): Promise<{ audioBase64: string; mimeType: string }> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Microphone API unavailable in this window");
  }

  const durationMs = options?.durationMs ?? 4500;
  const mimeType = pickMimeType();
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
    },
  });

  try {
    const recorder = new MediaRecorder(stream, { mimeType });
    const chunks: BlobPart[] = [];

    const stopped = new Promise<Blob>((resolve, reject) => {
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.onerror = () => reject(new Error("Mic recording failed"));
      recorder.onstop = () => {
        resolve(new Blob(chunks, { type: mimeType }));
      };
    });

    recorder.start(200);
    await new Promise((r) => window.setTimeout(r, durationMs));
    if (recorder.state !== "inactive") {
      recorder.stop();
    }

    const blob = await stopped;
    if (blob.size < 256) {
      throw new Error("Heard nothing — speak a short command");
    }

    const audioBase64 = await blobToBase64(blob);
    return { audioBase64, mimeType: blob.type || mimeType };
  } finally {
    for (const track of stream.getTracks()) {
      track.stop();
    }
  }
}

export type RememberClip = {
  audioBase64: string;
  mimeType: string;
};

/** Open-ended mic session for “Remember” voice notes. Stop via UI click. */
export class RememberRecorder {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: BlobPart[] = [];
  private mimeType = "";
  private stoppedPromise: Promise<Blob> | null = null;
  private maxTimer: number | null = null;
  private onMaxDuration: (() => void) | null = null;

  get active(): boolean {
    return this.recorder?.state === "recording";
  }

  async start(options?: {
    maxMs?: number;
    onMaxDuration?: () => void;
  }): Promise<void> {
    if (this.active) {
      throw new Error("Already remembering");
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Microphone API unavailable in this window");
    }

    this.mimeType = pickMimeType();
    this.chunks = [];
    this.onMaxDuration = options?.onMaxDuration ?? null;

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
      },
    });

    const recorder = new MediaRecorder(this.stream, { mimeType: this.mimeType });
    this.recorder = recorder;

    this.stoppedPromise = new Promise<Blob>((resolve, reject) => {
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) this.chunks.push(event.data);
      };
      recorder.onerror = () => reject(new Error("Mic recording failed"));
      recorder.onstop = () => {
        resolve(new Blob(this.chunks, { type: this.mimeType }));
      };
    });

    recorder.start(250);

    const maxMs = options?.maxMs ?? 90_000;
    this.maxTimer = window.setTimeout(() => {
      this.maxTimer = null;
      this.onMaxDuration?.();
    }, maxMs);
  }

  async stop(): Promise<RememberClip | null> {
    this.clearMaxTimer();

    const recorder = this.recorder;
    const stoppedPromise = this.stoppedPromise;
    if (!recorder || !stoppedPromise) {
      this.cleanupStream();
      return null;
    }

    if (recorder.state !== "inactive") {
      recorder.stop();
    }

    let blob: Blob;
    try {
      blob = await stoppedPromise;
    } finally {
      this.recorder = null;
      this.stoppedPromise = null;
      this.cleanupStream();
    }

    if (blob.size < 256) {
      return null;
    }

    const audioBase64 = await blobToBase64(blob);
    return { audioBase64, mimeType: blob.type || this.mimeType };
  }

  async cancel(): Promise<void> {
    this.clearMaxTimer();
    const recorder = this.recorder;
    const stoppedPromise = this.stoppedPromise;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
    if (stoppedPromise) {
      try {
        await stoppedPromise;
      } catch {
        // ignore
      }
    }
    this.recorder = null;
    this.stoppedPromise = null;
    this.cleanupStream();
  }

  private clearMaxTimer(): void {
    if (this.maxTimer !== null) {
      window.clearTimeout(this.maxTimer);
      this.maxTimer = null;
    }
  }

  private cleanupStream(): void {
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        track.stop();
      }
      this.stream = null;
    }
  }
}
