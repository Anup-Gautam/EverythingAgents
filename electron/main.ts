import {
  app,
  BrowserWindow,
  clipboard,
  desktopCapturer,
  globalShortcut,
  ipcMain,
  Menu,
  screen,
  session,
  shell,
  systemPreferences,
  type Rectangle,
} from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const COMPACT_WIDTH = 128;
const COMPACT_HEIGHT = 150;
const PICKER_WIDTH = 360;
const PICKER_HEIGHT = 440;
const COMMAND_WIDTH = 320;
const COMMAND_HEIGHT = 210;
const EDGE_MARGIN = 10;
const THUMB_SIZE = { width: 320, height: 180 };
const ANIM_MS = 220;
const ANIM_FPS = 60;
const SCREENSHOT_HOTKEY = "CommandOrControl+Shift+S";
const RECORDING_HOTKEY = "CommandOrControl+Shift+R";
const NOTE_HOTKEY = "CommandOrControl+Shift+N";
const COMMAND_HOTKEY = "CommandOrControl+Shift+C";
const PTT_HOTKEY = "CommandOrControl+Shift+Space";
const CLIPBOARD_POLL_MS = 300;

type MenuAction =
  | "end_session"
  | "pause_capture"
  | "open_past_sessions"
  | "settings"
  | "change_source";

type WindowLayout = "compact" | "picker" | "command";
type SourceType = "screen" | "window";
type ScreenAccess = ReturnType<typeof systemPreferences.getMediaAccessStatus>;

type CaptureSourceDto = {
  id: string;
  name: string;
  sourceType: SourceType;
  thumbnailDataUrl: string;
  appIconDataUrl: string | null;
};

type SourcesListResult = {
  sources: CaptureSourceDto[];
  screenAccess: ScreenAccess;
  permissionHint: "ok" | "needs_permission" | "restart_required";
};

type ActiveSession = {
  id: string;
  sourceId: string;
  sourceType: SourceType;
  sourceLabel: string;
  startedAt: number;
};

type SessionEventType = "note_silent" | "screenshot" | "recording";

type SessionEvent = {
  id: string;
  type: SessionEventType;
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

let orbWindow: BrowserWindow | null = null;
let currentLayout: WindowLayout = "compact";
let animTimer: ReturnType<typeof setInterval> | null = null;
let activeSession: ActiveSession | null = null;
let isRecording = false;
let sessionEvents: SessionEvent[] = [];
let currentSelection: string | null = null;
let lastClipboardText = "";
let clipboardTimer: ReturnType<typeof setInterval> | null = null;

/** Keep the orb above fullscreen apps and across all macOS Spaces. */
function applyOverlayBehavior(win: BrowserWindow): void {
  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
  });
  setImmediate(() => {
    if (win.isDestroyed()) return;
    win.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
    });
    win.setAlwaysOnTop(true, "screen-saver");
  });
}

function layoutSize(layout: WindowLayout): { width: number; height: number } {
  if (layout === "picker") {
    return { width: PICKER_WIDTH, height: PICKER_HEIGHT };
  }
  if (layout === "command") {
    return { width: COMMAND_WIDTH, height: COMMAND_HEIGHT };
  }
  return { width: COMPACT_WIDTH, height: COMPACT_HEIGHT };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function clampBoundsToWorkArea(bounds: Rectangle): Rectangle {
  const display = screen.getDisplayMatching(bounds);
  const work = display.workArea;
  const width = Math.min(bounds.width, work.width - EDGE_MARGIN * 2);
  const height = Math.min(bounds.height, work.height - EDGE_MARGIN * 2);
  const x = clamp(
    bounds.x,
    work.x + EDGE_MARGIN,
    work.x + work.width - width - EDGE_MARGIN,
  );
  const y = clamp(
    bounds.y,
    work.y + EDGE_MARGIN,
    work.y + work.height - height - EDGE_MARGIN,
  );
  return { x: Math.round(x), y: Math.round(y), width, height };
}

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

function stopBoundsAnimation(): void {
  if (animTimer !== null) {
    clearInterval(animTimer);
    animTimer = null;
  }
}

function animateBounds(win: BrowserWindow, target: Rectangle, durationMs = ANIM_MS): void {
  stopBoundsAnimation();
  const from = win.getBounds();
  const to = clampBoundsToWorkArea(target);
  const started = Date.now();

  animTimer = setInterval(() => {
    if (win.isDestroyed()) {
      stopBoundsAnimation();
      return;
    }

    const t = Math.min(1, (Date.now() - started) / durationMs);
    const e = easeOutCubic(t);
    win.setBounds({
      x: Math.round(from.x + (to.x - from.x) * e),
      y: Math.round(from.y + (to.y - from.y) * e),
      width: Math.round(from.width + (to.width - from.width) * e),
      height: Math.round(from.height + (to.height - from.height) * e),
    });

    if (t >= 1) {
      stopBoundsAnimation();
      win.setBounds(to);
    }
  }, Math.round(1000 / ANIM_FPS));
}

function nearestEdgeBounds(win: BrowserWindow, size?: { width: number; height: number }): Rectangle {
  const bounds = win.getBounds();
  const width = size?.width ?? bounds.width;
  const height = size?.height ?? bounds.height;
  const display = screen.getDisplayMatching(bounds);
  const work = display.workArea;

  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;

  const distLeft = centerX - work.x;
  const distRight = work.x + work.width - centerX;
  const distTop = centerY - work.y;
  const distBottom = work.y + work.height - centerY;
  const nearest = Math.min(distLeft, distRight, distTop, distBottom);

  const minX = work.x + EDGE_MARGIN;
  const maxX = work.x + work.width - width - EDGE_MARGIN;
  const minY = work.y + EDGE_MARGIN;
  const maxY = work.y + work.height - height - EDGE_MARGIN;

  let nextX = bounds.x + (bounds.width - width) / 2;
  let nextY = bounds.y;

  if (nearest === distLeft) {
    nextX = minX;
    nextY = clamp(bounds.y, minY, maxY);
  } else if (nearest === distRight) {
    nextX = maxX;
    nextY = clamp(bounds.y, minY, maxY);
  } else if (nearest === distTop) {
    nextY = minY;
    nextX = clamp(nextX, minX, maxX);
  } else {
    nextY = maxY;
    nextX = clamp(nextX, minX, maxX);
  }

  return clampBoundsToWorkArea({
    x: Math.round(nextX),
    y: Math.round(nextY),
    width,
    height,
  });
}

function setWindowLayout(layout: WindowLayout): void {
  if (!orbWindow) return;

  const prev = orbWindow.getBounds();
  const { width, height } = layoutSize(layout);
  currentLayout = layout;

  if (layout === "compact") {
    // Shrink + dock to nearest edge in one smooth motion.
    animateBounds(orbWindow, nearestEdgeBounds(orbWindow, { width, height }));
    return;
  }

  // Expand picker while keeping the top-center stable.
  const prevCenterX = prev.x + prev.width / 2;
  animateBounds(orbWindow, {
    x: Math.round(prevCenterX - width / 2),
    y: prev.y,
    width,
    height,
  });
}

function createOrbWindow(): BrowserWindow {
  const display = screen.getPrimaryDisplay();
  const { workArea } = display;
  const { width, height } = layoutSize("compact");

  const win = new BrowserWindow({
    width,
    height,
    x: Math.round(workArea.x + workArea.width - width - EDGE_MARGIN),
    y: Math.round(workArea.y + workArea.height / 2 - height / 2),
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: true,
    show: false,
    ...(process.platform === "darwin" ? { type: "panel" as const } : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (!app.isPackaged) {
    void win.loadURL("http://127.0.0.1:5174");
  } else {
    void win.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  win.once("ready-to-show", () => {
    win.showInactive();
    applyOverlayBehavior(win);
  });

  win.on("closed", () => {
    stopBoundsAnimation();
    orbWindow = null;
    currentLayout = "compact";
  });

  return win;
}

function snapToNearestEdge(win: BrowserWindow, animate = true): void {
  const target = nearestEdgeBounds(win);
  if (animate) {
    animateBounds(win, target, 180);
  } else {
    win.setBounds(target);
  }
}

function sendMenuAction(action: MenuAction): void {
  orbWindow?.webContents.send("orb:menu-action", action);
}

function showOrbContextMenu(): void {
  if (!orbWindow) return;

  const menu = Menu.buildFromTemplate([
    {
      label: "Take screenshot",
      accelerator: "CommandOrControl+Shift+S",
      enabled: Boolean(activeSession),
      click: () => {
        void captureScreenshot();
      },
    },
    {
      label: isRecording ? "Stop recording" : "Start recording",
      accelerator: "CommandOrControl+Shift+R",
      enabled: Boolean(activeSession) || isRecording,
      click: () => {
        requestToggleRecording();
      },
    },
    {
      label: "Note this",
      accelerator: "CommandOrControl+Shift+N",
      enabled: Boolean(activeSession),
      click: () => {
        void noteSilent();
      },
    },
    {
      label: "Command…",
      accelerator: "CommandOrControl+Shift+C",
      click: () => {
        orbWindow?.webContents.send("command:toggle");
      },
    },
    {
      label: "Push to talk",
      accelerator: "CommandOrControl+Shift+Space",
      click: () => {
        orbWindow?.webContents.send("command:ptt");
      },
    },
    {
      label: "End session",
      click: () => sendMenuAction("end_session"),
    },
    {
      label: "Change source",
      click: () => sendMenuAction("change_source"),
    },
    {
      label: "Pause capture",
      click: () => sendMenuAction("pause_capture"),
    },
    { type: "separator" },
    {
      label: "Open past sessions",
      click: () => sendMenuAction("open_past_sessions"),
    },
    {
      label: "Settings",
      click: () => sendMenuAction("settings"),
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => app.quit(),
    },
  ]);

  menu.popup({ window: orbWindow });
}

function screenshotsDir(): string {
  return path.join(app.getPath("pictures"), "Coco", "screenshots");
}

function recordingsDir(): string {
  return path.join(app.getPath("pictures"), "Coco", "recordings");
}

function sessionsDir(): string {
  return path.join(app.getPath("pictures"), "Coco", "sessions");
}

function previewText(text: string, max = 42): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, max - 1)}…`;
}

function appendSessionEvent(
  event: Omit<SessionEvent, "id" | "timestamp"> & {
    id?: string;
    timestamp?: number;
  },
): SessionEvent {
  const full: SessionEvent = {
    id: event.id ?? randomUUID(),
    type: event.type,
    timestamp: event.timestamp ?? Date.now(),
    text: event.text,
    filePath: event.filePath,
    fileName: event.fileName,
  };
  sessionEvents.push(full);
  return full;
}

async function persistSessionLog(): Promise<string | null> {
  if (!activeSession || sessionEvents.length === 0) return null;

  const dir = sessionsDir();
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${activeSession.id}.json`);
  const payload = {
    session: activeSession,
    events: sessionEvents,
    savedAt: Date.now(),
  };
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
  return filePath;
}

function stopClipboardWatcher(): void {
  if (clipboardTimer !== null) {
    clearInterval(clipboardTimer);
    clipboardTimer = null;
  }
}

function startClipboardWatcher(): void {
  stopClipboardWatcher();
  // Baseline so pre-existing clipboard content is not treated as a fresh copy.
  lastClipboardText = clipboard.readText();
  currentSelection = null;

  clipboardTimer = setInterval(() => {
    if (!activeSession) return;

    const next = clipboard.readText();
    if (!next || next === lastClipboardText) return;

    lastClipboardText = next;
    currentSelection = next;
    console.info("[coco] clipboard selection updated", {
      length: next.length,
      preview: previewText(next),
    });
  }, CLIPBOARD_POLL_MS);
}

function emitNoteResult(result: NoteSilentResult): void {
  orbWindow?.webContents.send("notes:silent-result", result);
}

async function noteSilent(): Promise<NoteSilentResult> {
  if (!activeSession) {
    const result: NoteSilentResult = {
      ok: false,
      error: "Start a session first",
    };
    emitNoteResult(result);
    return result;
  }

  const text = currentSelection?.trim() ?? "";
  if (!text) {
    const result: NoteSilentResult = {
      ok: false,
      error: "Copy text first, then Note this",
    };
    emitNoteResult(result);
    return result;
  }

  const event = appendSessionEvent({
    type: "note_silent",
    text,
  });

  try {
    await persistSessionLog();
  } catch (err) {
    console.warn("[coco] failed to persist session log", err);
  }

  const result: NoteSilentResult = {
    ok: true,
    event,
    preview: previewText(text),
  };
  emitNoteResult(result);
  console.info("[coco] note_silent saved", {
    eventId: event.id,
    preview: result.preview,
    totalEvents: sessionEvents.length,
  });
  return result;
}

function requestToggleRecording(): void {
  if (!activeSession && !isRecording) {
    orbWindow?.webContents.send("capture:recording-result", {
      ok: false,
      error: "Start a session first",
    } satisfies RecordingSaveResult);
    return;
  }
  orbWindow?.webContents.send("capture:toggle-recording");
}

function captureThumbnailSize(): { width: number; height: number } {
  const display = screen.getPrimaryDisplay();
  const width = Math.min(
    3840,
    Math.round(display.size.width * display.scaleFactor),
  );
  const height = Math.min(
    2160,
    Math.round(display.size.height * display.scaleFactor),
  );
  return { width, height };
}

function emitScreenshotResult(result: ScreenshotResult): void {
  orbWindow?.webContents.send("capture:screenshot-result", result);
}

async function captureScreenshot(): Promise<ScreenshotResult> {
  if (!activeSession) {
    const result: ScreenshotResult = {
      ok: false,
      error: "Start a session first",
    };
    emitScreenshotResult(result);
    return result;
  }

  try {
    const sources = await desktopCapturer.getSources({
      types: [activeSession.sourceType],
      thumbnailSize: captureThumbnailSize(),
      fetchWindowIcons: false,
    });

    const source =
      sources.find((item) => item.id === activeSession?.sourceId) ?? null;

    if (!source || source.thumbnail.isEmpty()) {
      const result: ScreenshotResult = {
        ok: false,
        error: "Could not capture source. Check Screen Recording permission.",
      };
      emitScreenshotResult(result);
      return result;
    }

    const dir = screenshotsDir();
    await fs.mkdir(dir, { recursive: true });

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const safeLabel = activeSession.sourceLabel
      .replace(/[^\w\-]+/g, "_")
      .slice(0, 40);
    const fileName = `${stamp}_${safeLabel || "capture"}.png`;
    const filePath = path.join(dir, fileName);

    await fs.writeFile(filePath, source.thumbnail.toPNG());
    shell.showItemInFolder(filePath);

    appendSessionEvent({
      type: "screenshot",
      filePath,
      fileName,
    });
    void persistSessionLog().catch((err) => {
      console.warn("[coco] failed to persist session log", err);
    });

    const result: ScreenshotResult = { ok: true, filePath, fileName };
    emitScreenshotResult(result);
    console.info("[coco] screenshot saved", result);
    return result;
  } catch (err) {
    const result: ScreenshotResult = {
      ok: false,
      error: err instanceof Error ? err.message : "Screenshot failed",
    };
    emitScreenshotResult(result);
    return result;
  }
}

function registerCaptureHotkeys(): void {
  const shotOk = globalShortcut.register(SCREENSHOT_HOTKEY, () => {
    void captureScreenshot();
  });
  if (!shotOk) {
    console.warn(`[coco] failed to register hotkey ${SCREENSHOT_HOTKEY}`);
  }

  const recOk = globalShortcut.register(RECORDING_HOTKEY, () => {
    requestToggleRecording();
  });
  if (!recOk) {
    console.warn(`[coco] failed to register hotkey ${RECORDING_HOTKEY}`);
  }

  const noteOk = globalShortcut.register(NOTE_HOTKEY, () => {
    void noteSilent();
  });
  if (!noteOk) {
    console.warn(`[coco] failed to register hotkey ${NOTE_HOTKEY}`);
  }

  const cmdOk = globalShortcut.register(COMMAND_HOTKEY, () => {
    orbWindow?.webContents.send("command:toggle");
  });
  if (!cmdOk) {
    console.warn(`[coco] failed to register hotkey ${COMMAND_HOTKEY}`);
  }

  const pttOk = globalShortcut.register(PTT_HOTKEY, () => {
    orbWindow?.webContents.send("command:ptt");
  });
  if (!pttOk) {
    console.warn(`[coco] failed to register hotkey ${PTT_HOTKEY}`);
  }
}

async function saveRecording(payload: {
  bytes: ArrayBuffer;
  sourceLabel: string;
}): Promise<RecordingSaveResult> {
  try {
    const dir = recordingsDir();
    await fs.mkdir(dir, { recursive: true });

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const safeLabel = String(payload.sourceLabel || "capture")
      .replace(/[^\w\-]+/g, "_")
      .slice(0, 40);
    const fileName = `${stamp}_${safeLabel || "capture"}.webm`;
    const filePath = path.join(dir, fileName);

    await fs.writeFile(filePath, Buffer.from(payload.bytes));
    shell.showItemInFolder(filePath);

    if (activeSession) {
      appendSessionEvent({
        type: "recording",
        filePath,
        fileName,
      });
      void persistSessionLog().catch((err) => {
        console.warn("[coco] failed to persist session log", err);
      });
    }

    const result: RecordingSaveResult = { ok: true, filePath, fileName };
    console.info("[coco] recording saved", result);
    return result;
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to save recording",
    };
  }
}

function configureMediaPermissions(): void {
  session.defaultSession.setPermissionRequestHandler(
    (_webContents, permission, callback) => {
      if (permission === "media" || permission === "mediaKeySystem") {
        callback(true);
        return;
      }
      callback(false);
    },
  );

  session.defaultSession.setPermissionCheckHandler(
    (_webContents, permission) =>
      permission === "media" || permission === "mediaKeySystem",
  );
}

function thumbnailLooksBlank(dataUrl: string): boolean {
  // Fully empty native images become tiny data URLs; treat those as unusable.
  return dataUrl.length < 200;
}

async function listSources(sourceType: SourceType): Promise<SourcesListResult> {
  const screenAccess =
    process.platform === "darwin"
      ? systemPreferences.getMediaAccessStatus("screen")
      : "granted";

  // Always invoke the capture API so macOS can associate a real TCC request
  // with Electron (do not hard-block on "denied" before this call).
  const sources = await desktopCapturer.getSources({
    types: [sourceType],
    thumbnailSize: THUMB_SIZE,
    fetchWindowIcons: true,
  });

  const mapped = sources.map((source) => {
    const thumbnailDataUrl = source.thumbnail.isEmpty()
      ? ""
      : source.thumbnail.toDataURL();
    return {
      id: source.id,
      name: source.name,
      sourceType,
      thumbnailDataUrl,
      appIconDataUrl:
        source.appIcon && !source.appIcon.isEmpty()
          ? source.appIcon.toDataURL()
          : null,
    };
  });

  const usable = mapped.filter(
    (source) => source.thumbnailDataUrl && !thumbnailLooksBlank(source.thumbnailDataUrl),
  );

  let permissionHint: SourcesListResult["permissionHint"] = "ok";
  if (screenAccess === "denied" || screenAccess === "restricted") {
    permissionHint = "needs_permission";
  } else if (mapped.length > 0 && usable.length === 0) {
    // Common after toggling permission on: APIs enumerate but frames stay blank
    // until the app is fully restarted.
    permissionHint =
      screenAccess === "granted" ? "restart_required" : "needs_permission";
  } else if (mapped.length === 0 && screenAccess !== "granted") {
    permissionHint = "needs_permission";
  }

  return {
    sources: mapped,
    screenAccess,
    permissionHint,
  };
}

async function openScreenRecordingSettings(): Promise<void> {
  if (process.platform !== "darwin") return;

  // Prefer modern Settings deep link; fall back to legacy System Preferences URI.
  const candidates = [
    "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
    "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_ScreenCapture",
  ];

  for (const url of candidates) {
    try {
      await shell.openExternal(url);
      return;
    } catch {
      // try next
    }
  }
}

function revealElectronApp(): void {
  // Helps the user manually add Electron.app via the Screen Recording "+" control.
  const electronApp = path.resolve(
    path.dirname(process.execPath),
    "..",
    "..",
  );
  shell.showItemInFolder(electronApp);
}

function registerIpc(): void {
  ipcMain.handle("orb:get-bounds", (): Rectangle => {
    if (!orbWindow) {
      const { width, height } = layoutSize(currentLayout);
      return { x: 0, y: 0, width, height };
    }
    return orbWindow.getBounds();
  });

  ipcMain.on("orb:set-position", (_event, x: number, y: number) => {
    if (!orbWindow) return;
    stopBoundsAnimation();
    orbWindow.setPosition(Math.round(x), Math.round(y));
  });

  ipcMain.on("orb:snap-to-edge", () => {
    if (!orbWindow) return;
    snapToNearestEdge(orbWindow, true);
  });

  ipcMain.on("orb:context-menu", () => {
    showOrbContextMenu();
  });

  ipcMain.handle("orb:set-layout", (_event, layout: WindowLayout) => {
    if (
      layout !== "compact" &&
      layout !== "picker" &&
      layout !== "command"
    ) {
      return currentLayout;
    }
    setWindowLayout(layout);
    return currentLayout;
  });

  ipcMain.handle(
    "sources:list",
    async (_event, sourceType: SourceType): Promise<SourcesListResult> => {
      if (sourceType !== "screen" && sourceType !== "window") {
        return {
          sources: [],
          screenAccess: "unknown",
          permissionHint: "needs_permission",
        };
      }
      return listSources(sourceType);
    },
  );

  ipcMain.handle("sources:open-settings", async () => {
    await openScreenRecordingSettings();
  });

  ipcMain.handle("sources:reveal-electron", () => {
    revealElectronApp();
  });

  ipcMain.handle(
    "session:set",
    (
      _event,
      payload: {
        sourceId: string;
        sourceType: SourceType;
        sourceLabel: string;
      } | null,
    ) => {
      if (
        payload &&
        typeof payload.sourceId === "string" &&
        (payload.sourceType === "screen" || payload.sourceType === "window")
      ) {
        // Mid-session source change: keep timeline + clipboard selection.
        if (activeSession) {
          activeSession = {
            ...activeSession,
            sourceId: payload.sourceId,
            sourceType: payload.sourceType,
            sourceLabel: String(payload.sourceLabel ?? "capture"),
          };
          return activeSession;
        }

        activeSession = {
          id: randomUUID(),
          sourceId: payload.sourceId,
          sourceType: payload.sourceType,
          sourceLabel: String(payload.sourceLabel ?? "capture"),
          startedAt: Date.now(),
        };
        sessionEvents = [];
        startClipboardWatcher();
        return activeSession;
      }

      stopClipboardWatcher();
      activeSession = null;
      sessionEvents = [];
      currentSelection = null;
      return null;
    },
  );

  ipcMain.handle("session:clear", async () => {
    try {
      const logPath = await persistSessionLog();
      if (logPath) {
        console.info("[coco] session log saved", logPath);
      }
    } catch (err) {
      console.warn("[coco] failed to persist session log on clear", err);
    }

    stopClipboardWatcher();
    activeSession = null;
    sessionEvents = [];
    currentSelection = null;
    lastClipboardText = "";
    isRecording = false;
  });

  ipcMain.handle("capture:screenshot", async () => captureScreenshot());

  ipcMain.handle(
    "capture:save-recording",
    async (_event, payload: { bytes: ArrayBuffer; sourceLabel: string }) => {
      const result = await saveRecording(payload);
      orbWindow?.webContents.send("capture:recording-result", result);
      return result;
    },
  );

  ipcMain.on("capture:recording-state", (_event, recording: boolean) => {
    isRecording = Boolean(recording);
  });

  ipcMain.handle("notes:silent", async () => noteSilent());

  ipcMain.handle("notes:get-events", () => sessionEvents);

  ipcMain.handle("notes:get-selection", () => currentSelection);
}

app.whenReady().then(() => {
  if (process.platform === "darwin" && app.dock) {
    app.dock.hide();
  }

  configureMediaPermissions();
  registerIpc();
  registerCaptureHotkeys();
  orbWindow = createOrbWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      orbWindow = createOrbWindow();
    } else if (orbWindow && !orbWindow.isDestroyed()) {
      applyOverlayBehavior(orbWindow);
    }
  });
});

app.on("will-quit", () => {
  stopClipboardWatcher();
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
