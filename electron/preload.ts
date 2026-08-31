import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

export type OrbBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type MenuAction =
  | "end_session"
  | "change_source"
  | "sign_in"
  | "sign_out";

export type WindowLayout = "compact" | "picker" | "command" | "remember";

export type SourceType = "screen" | "window";

export type CaptureSource = {
  id: string;
  name: string;
  sourceType: SourceType;
  thumbnailDataUrl: string;
  appIconDataUrl: string | null;
};

export type SourcesListResult = {
  sources: CaptureSource[];
  screenAccess: string;
  permissionHint: "ok" | "needs_permission" | "restart_required";
};

export type ActiveSession = {
  id: string;
  sourceId: string;
  sourceType: SourceType;
  sourceLabel: string;
  startedAt: number;
  cloudSessionId?: string | null;
};

export type SessionEvent = {
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

export type ScreenshotResult =
  | {
      ok: true;
      filePath: string;
      fileName: string;
      cloudUploaded?: boolean;
      cloudError?: string;
      label?: string;
    }
  | { ok: false; error: string };

export type RecordingSaveResult =
  | { ok: true; filePath: string; fileName: string; label?: string }
  | { ok: false; error: string };

export type NoteSilentResult =
  | { ok: true; event: SessionEvent; preview: string }
  | { ok: false; error: string };

export type ExplainResult =
  | { ok: true; answer: string; preview: string; model: string }
  | { ok: false; error: string };

export type EndSessionResult =
  | {
      ok: true;
      filePath: string;
      fileName: string;
      model: string | null;
      eventCount: number;
    }
  | { ok: false; error: string };

export type TranscribeResult =
  | { ok: true; transcript: string; model: string }
  | { ok: false; error: string };

export type SpeakResult =
  | {
      ok: true;
      audioBase64: string;
      mimeType: string;
      model: string;
      provider?: string;
    }
  | { ok: false; error: string };

export type AuthSession = {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  idToken: string;
  refreshToken: string | null;
  accessToken: string | null;
  signedInAt: number;
};

export type GoogleSignInResult =
  | { ok: true; session: AuthSession }
  | { ok: false; error: string; cancelled?: boolean };

const coco = {
  getBounds: (): Promise<OrbBounds> => ipcRenderer.invoke("orb:get-bounds"),
  setPosition: (x: number, y: number): void => {
    ipcRenderer.send("orb:set-position", x, y);
  },
  snapToEdge: (): void => {
    ipcRenderer.send("orb:snap-to-edge");
  },
  openContextMenu: (): void => {
    ipcRenderer.send("orb:context-menu");
  },
  setLayout: (layout: WindowLayout): Promise<WindowLayout> =>
    ipcRenderer.invoke("orb:set-layout", layout),
  listSources: (sourceType: SourceType): Promise<SourcesListResult> =>
    ipcRenderer.invoke("sources:list", sourceType),
  openScreenRecordingSettings: (): Promise<void> =>
    ipcRenderer.invoke("sources:open-settings"),
  revealElectronApp: (): Promise<void> =>
    ipcRenderer.invoke("sources:reveal-electron"),
  setSession: (session: {
    sourceId: string;
    sourceType: SourceType;
    sourceLabel: string;
  }): Promise<ActiveSession | null> =>
    ipcRenderer.invoke("session:set", session),
  clearSession: (): Promise<void> => ipcRenderer.invoke("session:clear"),
  endSession: (): Promise<EndSessionResult> => ipcRenderer.invoke("session:end"),
  takeScreenshot: (): Promise<ScreenshotResult> =>
    ipcRenderer.invoke("capture:screenshot"),
  saveRecording: (payload: {
    bytes: ArrayBuffer;
    sourceLabel: string;
  }): Promise<RecordingSaveResult> =>
    ipcRenderer.invoke("capture:save-recording", payload),
  setRecordingState: (recording: boolean): void => {
    ipcRenderer.send("capture:recording-state", recording);
  },
  noteSilent: (): Promise<NoteSilentResult> =>
    ipcRenderer.invoke("notes:silent"),
  saveNoteText: (text: string): Promise<NoteSilentResult> =>
    ipcRenderer.invoke("notes:save-text", text),
  explain: (): Promise<ExplainResult> => ipcRenderer.invoke("ai:explain"),
  transcribeVoice: (payload: {
    audioBase64: string;
    mimeType: string;
  }): Promise<TranscribeResult> => ipcRenderer.invoke("voice:transcribe", payload),
  speakText: (text: string): Promise<SpeakResult> =>
    ipcRenderer.invoke("voice:speak", text),
  getSessionEvents: (): Promise<SessionEvent[]> =>
    ipcRenderer.invoke("notes:get-events"),
  getCurrentSelection: (): Promise<string | null> =>
    ipcRenderer.invoke("notes:get-selection"),
  signInWithGoogle: (): Promise<GoogleSignInResult> =>
    ipcRenderer.invoke("auth:google-sign-in"),
  getAuthSession: (): Promise<AuthSession | null> =>
    ipcRenderer.invoke("auth:get-session"),
  signOut: (): Promise<{ ok: true }> => ipcRenderer.invoke("auth:sign-out"),
  onMenuAction: (handler: (action: MenuAction) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, action: MenuAction) => {
      handler(action);
    };
    ipcRenderer.on("orb:menu-action", listener);
    return () => {
      ipcRenderer.removeListener("orb:menu-action", listener);
    };
  },
  onScreenshotResult: (
    handler: (result: ScreenshotResult) => void,
  ): (() => void) => {
    const listener = (_event: IpcRendererEvent, result: ScreenshotResult) => {
      handler(result);
    };
    ipcRenderer.on("capture:screenshot-result", listener);
    return () => {
      ipcRenderer.removeListener("capture:screenshot-result", listener);
    };
  },
  onToggleRecording: (handler: () => void): (() => void) => {
    const listener = () => {
      handler();
    };
    ipcRenderer.on("capture:toggle-recording", listener);
    return () => {
      ipcRenderer.removeListener("capture:toggle-recording", listener);
    };
  },
  onRecordingResult: (
    handler: (result: RecordingSaveResult) => void,
  ): (() => void) => {
    const listener = (
      _event: IpcRendererEvent,
      result: RecordingSaveResult,
    ) => {
      handler(result);
    };
    ipcRenderer.on("capture:recording-result", listener);
    return () => {
      ipcRenderer.removeListener("capture:recording-result", listener);
    };
  },
  onNoteSilentResult: (
    handler: (result: NoteSilentResult) => void,
  ): (() => void) => {
    const listener = (_event: IpcRendererEvent, result: NoteSilentResult) => {
      handler(result);
    };
    ipcRenderer.on("notes:silent-result", listener);
    return () => {
      ipcRenderer.removeListener("notes:silent-result", listener);
    };
  },
  onCommandToggle: (handler: () => void): (() => void) => {
    const listener = () => {
      handler();
    };
    ipcRenderer.on("command:toggle", listener);
    return () => {
      ipcRenderer.removeListener("command:toggle", listener);
    };
  },
  onPtt: (handler: () => void): (() => void) => {
    const listener = () => {
      handler();
    };
    ipcRenderer.on("command:ptt", listener);
    return () => {
      ipcRenderer.removeListener("command:ptt", listener);
    };
  },
  onRemember: (handler: () => void): (() => void) => {
    const listener = () => {
      handler();
    };
    ipcRenderer.on("command:remember", listener);
    return () => {
      ipcRenderer.removeListener("command:remember", listener);
    };
  },
};

contextBridge.exposeInMainWorld("coco", coco);
