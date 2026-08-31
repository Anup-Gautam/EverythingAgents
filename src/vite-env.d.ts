/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN: string;
  readonly VITE_FIREBASE_PROJECT_ID: string;
  readonly VITE_FIREBASE_STORAGE_BUCKET: string;
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID: string;
  readonly VITE_FIREBASE_APP_ID: string;
  readonly VITE_API_BASE_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

type OrbBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type MenuAction =
  | "end_session"
  | "change_source"
  | "sign_in"
  | "sign_out";

type WindowLayout = "compact" | "picker" | "command" | "remember";

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
  cloudSessionId?: string | null;
};

type SessionEvent = {
  id: string;
  type: "note_silent" | "screenshot" | "recording" | "qa";
  timestamp: number;
  text?: string;
  filePath?: string;
  fileName?: string;
  question?: string;
  answer?: string;
  label?: string;
};

type ScreenshotResult =
  | {
      ok: true;
      filePath: string;
      fileName: string;
      cloudUploaded?: boolean;
      cloudError?: string;
      label?: string;
    }
  | { ok: false; error: string };

type RecordingSaveResult =
  | { ok: true; filePath: string; fileName: string; label?: string }
  | { ok: false; error: string };

type NoteSilentResult =
  | { ok: true; event: SessionEvent; preview: string }
  | { ok: false; error: string };

type ExplainResult =
  | { ok: true; answer: string; preview: string; model: string }
  | { ok: false; error: string };

type EndSessionResult =
  | {
      ok: true;
      filePath: string;
      fileName: string;
      model: string | null;
      eventCount: number;
    }
  | { ok: false; error: string };

type TranscribeResult =
  | { ok: true; transcript: string; model: string }
  | { ok: false; error: string };

type SpeakResult =
  | {
      ok: true;
      audioBase64: string;
      mimeType: string;
      model: string;
      provider?: string;
    }
  | { ok: false; error: string };

type AuthSession = {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  idToken: string;
  refreshToken: string | null;
  accessToken: string | null;
  signedInAt: number;
};

type GoogleSignInResult =
  | { ok: true; session: AuthSession }
  | { ok: false; error: string; cancelled?: boolean };

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
  endSession: () => Promise<EndSessionResult>;
  takeScreenshot: () => Promise<ScreenshotResult>;
  saveRecording: (payload: {
    bytes: ArrayBuffer;
    sourceLabel: string;
  }) => Promise<RecordingSaveResult>;
  setRecordingState: (recording: boolean) => void;
  noteSilent: () => Promise<NoteSilentResult>;
  saveNoteText: (text: string) => Promise<NoteSilentResult>;
  explain: () => Promise<ExplainResult>;
  transcribeVoice: (payload: {
    audioBase64: string;
    mimeType: string;
  }) => Promise<TranscribeResult>;
  speakText: (text: string) => Promise<SpeakResult>;
  getSessionEvents: () => Promise<SessionEvent[]>;
  getCurrentSelection: () => Promise<string | null>;
  signInWithGoogle: () => Promise<GoogleSignInResult>;
  getAuthSession: () => Promise<AuthSession | null>;
  signOut: () => Promise<{ ok: true }>;
  onMenuAction: (handler: (action: MenuAction) => void) => () => void;
  onScreenshotResult: (handler: (result: ScreenshotResult) => void) => () => void;
  onToggleRecording: (handler: () => void) => () => void;
  onRecordingResult: (handler: (result: RecordingSaveResult) => void) => () => void;
  onNoteSilentResult: (handler: (result: NoteSilentResult) => void) => () => void;
  onCommandToggle: (handler: () => void) => () => void;
  onPtt: (handler: () => void) => () => void;
  onRemember: (handler: () => void) => () => void;
}

interface Window {
  coco: CocoApi;
}
