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
