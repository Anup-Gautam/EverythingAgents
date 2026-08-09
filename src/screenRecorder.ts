/** Local screen/window recorder using Chromium desktop capture + MediaRecorder. */

function pickWebmMimeType(): string {
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8,opus",
    "video/webm;codecs=vp8",
    "video/webm",
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

async function getDesktopStream(sourceId: string): Promise<MediaStream> {
  // Electron/Chromium desktop-capture constraints (not in standard TS DOM types).
  const constraints = {
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: "desktop",
        chromeMediaSourceId: sourceId,
      },
    },
  } as unknown as MediaStreamConstraints;

  return navigator.mediaDevices.getUserMedia(constraints);
}

export class ScreenRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: Blob[] = [];

  get isRecording(): boolean {
    return this.mediaRecorder?.state === "recording";
  }

  async start(sourceId: string): Promise<void> {
    if (this.isRecording) {
      throw new Error("Already recording");
    }

    const stream = await getDesktopStream(sourceId);
    const mimeType = pickWebmMimeType();
    const recorder = mimeType
      ? new MediaRecorder(stream, { mimeType })
      : new MediaRecorder(stream);

    this.stream = stream;
    this.chunks = [];
    this.mediaRecorder = recorder;

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        this.chunks.push(event.data);
      }
    };

    recorder.start(1000);
  }

  async stop(): Promise<Blob> {
    const recorder = this.mediaRecorder;
    if (!recorder || recorder.state === "inactive") {
      this.cleanup();
      throw new Error("Not recording");
    }

    const blob = await new Promise<Blob>((resolve, reject) => {
      recorder.onerror = () => {
        this.cleanup();
        reject(new Error("Recording failed"));
      };

      recorder.onstop = () => {
        const result = new Blob(this.chunks, { type: "video/webm" });
        this.cleanup();
        resolve(result);
      };

      try {
        recorder.stop();
      } catch (err) {
        this.cleanup();
        reject(err instanceof Error ? err : new Error("Failed to stop recording"));
      }
    });

    if (blob.size === 0) {
      throw new Error("Recording was empty");
    }

    return blob;
  }

  /** Force-stop tracks without returning a blob (e.g. session end while idle). */
  cancel(): void {
    try {
      if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
        this.mediaRecorder.stop();
      }
    } catch {
      // ignore
    }
    this.cleanup();
  }

  private cleanup(): void {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.mediaRecorder = null;
    this.chunks = [];
  }
}
