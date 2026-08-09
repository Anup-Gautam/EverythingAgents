import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

export type OrbBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type MenuAction =
  | "end_session"
  | "pause_capture"
  | "open_past_sessions"
  | "settings"
  | "change_source";

export type WindowLayout = "compact" | "picker";

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
  sourceId: string;
  sourceType: SourceType;
  sourceLabel: string;
};

export type ScreenshotResult =
  | { ok: true; filePath: string; fileName: string }
  | { ok: false; error: string };

export type RecordingSaveResult =
  | { ok: true; filePath: string; fileName: string }
  | { ok: false; error: string };

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
  setSession: (session: ActiveSession): Promise<ActiveSession | null> =>
    ipcRenderer.invoke("session:set", session),
  clearSession: (): Promise<void> => ipcRenderer.invoke("session:clear"),
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
};

contextBridge.exposeInMainWorld("coco", coco);
