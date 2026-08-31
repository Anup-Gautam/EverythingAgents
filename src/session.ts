export type SourceType = "screen" | "window";

export type CaptureSource = {
  id: string;
  name: string;
  sourceType: SourceType;
  thumbnailDataUrl: string;
  appIconDataUrl: string | null;
};

export type LocalSession = {
  sourceId: string;
  sourceType: SourceType;
  sourceLabel: string;
  startedAt: number;
};

export type SessionEventType = "note_silent" | "screenshot" | "recording" | "qa";

export type SessionEvent = {
  id: string;
  type: SessionEventType;
  timestamp: number;
  text?: string;
  filePath?: string;
  fileName?: string;
  question?: string;
  answer?: string;
  label?: string;
};
