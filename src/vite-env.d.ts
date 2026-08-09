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

type WindowLayout = "compact" | "picker" | "command";

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
  id: string;
  sourceId: string;
  sourceType: SourceType;
  sourceLabel: string;
  startedAt: number;
};

type SessionEvent = {
  id: string;
  type: "note_silent" | "screenshot" | "recording";
  timestamp: number;
  text?: string;
  filePath?: string;
  fileName?: string;
};

type ScreenshotResult =
  | { ok: true; filePath: string; fileName: string }
  | { ok: false; error: string };

type RecordingSaveResult =
  | { ok: true; filePath: string; fileName: string }
  | { ok: false; error: string };

type NoteSilentResult =
  | { ok: true; event: SessionEvent; preview: string }
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
  setSession: (session: {
    sourceId: string;
    sourceType: SourceType;
    sourceLabel: string;
  }) => Promise<ActiveSession | null>;
  clearSession: () => Promise<void>;
  takeScreenshot: () => Promise<ScreenshotResult>;
  saveRecording: (payload: {
    bytes: ArrayBuffer;
    sourceLabel: string;
  }) => Promise<RecordingSaveResult>;
  setRecordingState: (recording: boolean) => void;
  noteSilent: () => Promise<NoteSilentResult>;
  getSessionEvents: () => Promise<SessionEvent[]>;
  getCurrentSelection: () => Promise<string | null>;
  onMenuAction: (handler: (action: MenuAction) => void) => () => void;
  onScreenshotResult: (handler: (result: ScreenshotResult) => void) => () => void;
  onToggleRecording: (handler: () => void) => () => void;
  onRecordingResult: (handler: (result: RecordingSaveResult) => void) => () => void;
  onNoteSilentResult: (handler: (result: NoteSilentResult) => void) => () => void;
  onCommandToggle: (handler: () => void) => () => void;
  onPtt: (handler: () => void) => () => void;
}

interface Window {
  coco: CocoApi;
}
