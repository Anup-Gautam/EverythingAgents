/// <reference types="vite/client" />

type OrbBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type MenuAction =
  | "end_session"
  | "pause_capture"
  | "open_past_sessions"
  | "settings"
  | "change_source";

type WindowLayout = "compact" | "picker";

type SourceType = "screen" | "window";

type CaptureSource = {
  id: string;
  name: string;
  sourceType: SourceType;
  thumbnailDataUrl: string;
  appIconDataUrl: string | null;
};

type SourcesListResult = {
  sources: CaptureSource[];
  screenAccess: string;
  permissionHint: "ok" | "needs_permission" | "restart_required";
};

type ActiveSession = {
  sourceId: string;
  sourceType: SourceType;
  sourceLabel: string;
};

type ScreenshotResult =
  | { ok: true; filePath: string; fileName: string }
  | { ok: false; error: string };

type RecordingSaveResult =
  | { ok: true; filePath: string; fileName: string }
  | { ok: false; error: string };

interface CocoApi {
  getBounds: () => Promise<OrbBounds>;
  setPosition: (x: number, y: number) => void;
  snapToEdge: () => void;
  openContextMenu: () => void;
  setLayout: (layout: WindowLayout) => Promise<WindowLayout>;
  listSources: (sourceType: SourceType) => Promise<SourcesListResult>;
  openScreenRecordingSettings: () => Promise<void>;
  revealElectronApp: () => Promise<void>;
  setSession: (session: ActiveSession) => Promise<ActiveSession | null>;
  clearSession: () => Promise<void>;
  takeScreenshot: () => Promise<ScreenshotResult>;
  saveRecording: (payload: {
    bytes: ArrayBuffer;
    sourceLabel: string;
  }) => Promise<RecordingSaveResult>;
  setRecordingState: (recording: boolean) => void;
  onMenuAction: (handler: (action: MenuAction) => void) => () => void;
  onScreenshotResult: (handler: (result: ScreenshotResult) => void) => () => void;
  onToggleRecording: (handler: () => void) => () => void;
  onRecordingResult: (handler: (result: RecordingSaveResult) => void) => () => void;
}

interface Window {
  coco: CocoApi;
}
