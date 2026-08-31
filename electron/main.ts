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
import dotenv from "dotenv";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  readFirebaseConfigFromEnv,
  startGoogleSystemBrowserLogin,
} from "./authLogin";
import {
  ensureFreshAuthSession,
  loadAuthSession,
  refreshAuthSession,
  saveAuthSession,
  withTokenExpiry,
  type AuthSession,
} from "./authSession";
import {
  apiCaption,
  apiEndSession,
  apiExplain,
  apiSpeak,
  apiStartSession,
  apiSynthesize,
  apiTranscribe,
  apiUploadScreenshot,
  apiUploadTextEvent,
} from "./cloudApi";
import { openNotesPackWindow, writeNotesHtml } from "./notesPack";

dotenv.config({ path: path.join(__dirname, "..", ".env") });

const COMPACT_WIDTH = 128;
const COMPACT_HEIGHT = 150;
const REMEMBER_WIDTH = 128;
const REMEMBER_HEIGHT = 210;
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
const REMEMBER_HOTKEY = "CommandOrControl+Shift+M";
const COMMAND_HOTKEY = "CommandOrControl+Shift+C";
const PTT_HOTKEY = "CommandOrControl+Shift+Space";
const CLIPBOARD_POLL_MS = 300;

type MenuAction =
  | "end_session"
  | "change_source"
  | "sign_in"
  | "sign_out";

type WindowLayout = "compact" | "picker" | "command" | "remember";
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
  cloudSessionId?: string | null;
};

type SessionEventType = "note_silent" | "screenshot" | "recording" | "qa";

type SessionEvent = {
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

let orbWindow: BrowserWindow | null = null;
let currentLayout: WindowLayout = "compact";
let animTimer: ReturnType<typeof setInterval> | null = null;
let activeSession: ActiveSession | null = null;
let isRecording = false;
let sessionEvents: SessionEvent[] = [];
let currentSelection: string | null = null;
let lastClipboardText = "";
let clipboardTimer: ReturnType<typeof setInterval> | null = null;
let authSession: AuthSession | null = null;

function authEmail(): string | null {
  return authSession?.email?.trim() || authSession?.uid || null;
}

/**
 * Return a valid Firebase ID token, refreshing when near expiry.
 * Clears the saved session if refresh fails.
 */
async function getValidIdToken(): Promise<string | null> {
  if (!authSession?.idToken) return null;

  const apiKey = readFirebaseConfigFromEnv()?.apiKey;
  if (!apiKey) {
    console.warn("[coco] cannot refresh auth — missing VITE_FIREBASE_API_KEY");
    return authSession.idToken;
  }

  try {
    const fresh = await ensureFreshAuthSession(authSession, apiKey);
    if (
      fresh.idToken !== authSession.idToken ||
      fresh.refreshToken !== authSession.refreshToken ||
      fresh.expiresAt !== authSession.expiresAt
    ) {
      authSession = fresh;
      await saveAuthSession(authSession);
      console.info("[coco] Firebase ID token refreshed");
    } else {
      authSession = fresh;
    }
    return authSession.idToken;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[coco] Firebase token refresh failed", message);
    authSession = null;
    await saveAuthSession(null);
    return null;
  }
}

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
  if (layout === "remember") {
    return { width: REMEMBER_WIDTH, height: REMEMBER_HEIGHT };
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
      label: "Remember",
      accelerator: "CommandOrControl+Shift+M",
      enabled: Boolean(activeSession),
      click: () => {
        orbWindow?.webContents.send("command:remember");
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
    { type: "separator" },
    authEmail()
      ? {
          label: `Sign out (${authEmail()})`,
          click: () => sendMenuAction("sign_out"),
        }
      : {
          label: "Sign in with Google",
          click: () => sendMenuAction("sign_in"),
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

function notesDir(): string {
  return path.join(app.getPath("pictures"), "Coco", "notes");
}

function nearbyContextBlurb(
  events: SessionEvent[],
  around: SessionEvent,
  radius = 2,
): string {
  const sorted = events.slice().sort((a, b) => a.timestamp - b.timestamp);
  const idx = sorted.findIndex((e) => e.id === around.id);
  if (idx < 0) return "";
  const neighbors = sorted
    .slice(Math.max(0, idx - radius), Math.min(sorted.length, idx + radius + 1))
    .filter((e) => e.id !== around.id);
  const bits: string[] = [];
  for (const n of neighbors) {
    if (n.label) bits.push(n.label);
    else if (n.type === "note_silent" && n.text) {
      bits.push(`note “${previewText(n.text, 60)}”`);
    } else if (n.type === "qa" && n.question) {
      bits.push(`Q&A about “${previewText(n.question, 50)}”`);
    } else if (n.fileName) {
      bits.push(`${n.type} (${n.fileName})`);
    } else {
      bits.push(n.type);
    }
  }
  return bits.slice(0, 4).join("; ");
}

function firstSentences(text: string, maxChars = 220): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (!compact) return "";
  const parts = compact.split(/(?<=[.!?])\s+/);
  let out = parts[0] || compact;
  if (out.length < 80 && parts[1]) {
    out = `${out} ${parts[1]}`;
  }
  if (out.length <= maxChars) return out;
  return `${out.slice(0, maxChars - 1).trim()}…`;
}

function inferSessionTitle(events: SessionEvent[], sourceLabel: string): string {
  const labels = events
    .map((e) => e.label?.trim())
    .filter((s): s is string => Boolean(s));
  if (labels[0]) return previewText(labels[0], 72);
  const quote = events.find((e) => e.type === "note_silent" && e.text)?.text;
  if (quote) return previewText(firstSentences(quote, 80), 72);
  return sourceLabel || "Session study note";
}

function inferBigIdea(events: SessionEvent[]): string {
  const sorted = events.slice().sort((a, b) => a.timestamp - b.timestamp);
  const quotes = sorted
    .filter((e) => e.type === "note_silent" && e.text)
    .map((e) => String(e.text).trim())
    .sort((a, b) => b.length - a.length);
  if (quotes[0]) {
    return firstSentences(quotes[0], 240);
  }

  const qa = sorted.find((e) => e.type === "qa" && e.answer);
  if (qa?.answer) {
    return firstSentences(qa.answer, 240);
  }

  const labeled = sorted.find((e) => e.label);
  if (labeled?.label) {
    return `This session focused on: ${labeled.label}.`;
  }

  return "This session had captures, but not enough text yet to state a crisp takeaway — save a quote or run Explain next time.";
}

function buildSelfCheckFromSession(events: SessionEvent[]): string[] {
  const lines: string[] = [];
  const sorted = events.slice().sort((a, b) => a.timestamp - b.timestamp);
  const qa = sorted.filter((e) => e.type === "qa" && (e.question || e.answer));

  for (const e of qa.slice(0, 3)) {
    if (e.question) lines.push(`**Q:** ${e.question}`);
    if (e.answer) lines.push(`**A:** ${e.answer}`, ``);
  }
  if (lines.length > 0) return lines;

  const quotes = sorted
    .filter((e) => e.type === "note_silent" && e.text)
    .map((e) => String(e.text).trim())
    .sort((a, b) => b.length - a.length);

  if (quotes[0]) {
    const claim = firstSentences(quotes[0], 180);
    lines.push(`**Q:** What key claim or goal did you save from this session?`);
    lines.push(`**A:** ${claim}`, ``);

    const lower = quotes[0].toLowerCase();
    if (/case[- ]control|study|experiment|survey|method/.test(lower)) {
      const methodHit = quotes[0].match(
        /\b(case[- ]control study|randomized|survey|experiment|interview|analysis)[^.?!]{0,80}/i,
      );
      lines.push(`**Q:** What method or study design showed up in your notes?`);
      lines.push(
        `**A:** ${methodHit ? methodHit[0].trim() : firstSentences(quotes[0], 140)}`,
        ``,
      );
    } else {
      const second = quotes[1] ? firstSentences(quotes[1], 160) : null;
      lines.push(`**Q:** Why did this passage matter in context of the session?`);
      lines.push(
        `**A:** ${
          second ||
          "It was the passage you chose to capture — likely the core idea you wanted to keep."
        }`,
        ``,
      );
    }
  }

  const label = sorted.find((e) => e.label)?.label;
  if (label && lines.length < 4) {
    lines.push(`**Q:** What did your screenshot/recording show?`);
    lines.push(`**A:** ${label}`, ``);
  }

  if (lines.length === 0) {
    lines.push(`**Q:** What will you capture next to make this note teachable?`);
    lines.push(
      `**A:** A verbatim quote of the main claim, plus one Explain on a hard sentence.`,
      ``,
    );
  }

  return lines;
}

function buildFallbackMarkdown(
  session: ActiveSession,
  events: SessionEvent[],
): string {
  const sorted = events.slice().sort((a, b) => a.timestamp - b.timestamp);
  const quotes = sorted.filter((e) => e.type === "note_silent" && e.text);
  const captures = sorted.filter(
    (e) => e.type === "screenshot" || e.type === "recording",
  );
  const title = inferSessionTitle(sorted, session.sourceLabel);
  const bigIdea = inferBigIdea(sorted);
  const tags = [
    ...new Set(
      [
        ...captures.map((c) => c.label).filter(Boolean),
        quotes.length ? "Quotes" : null,
        "Session review",
      ].filter((t): t is string => Boolean(t)),
    ),
  ]
    .slice(0, 5)
    .map((t) => previewText(t, 28));

  const overviewBits: string[] = [];
  overviewBits.push(
    `You captured ${events.length} item(s) while working with ${session.sourceLabel}.`,
  );
  if (quotes[0]?.text) {
    overviewBits.push(
      `A central passage you saved: “${previewText(String(quotes[0].text), 160)}”`,
    );
  }
  if (captures[0]?.label) {
    overviewBits.push(`Visual focus included: ${captures[0].label}.`);
  }
  overviewBits.push(
    `This note was built locally from your timeline when cloud synthesis was unavailable.`,
  );

  const lines: string[] = [
    `# ${title}`,
    ``,
    `Tags: ${tags.join(" | ") || "Session review"}`,
    ``,
    `## Overview`,
    overviewBits.join(" "),
    ``,
    `> **Big idea:** ${bigIdea}`,
    ``,
    `## Key terms`,
  ];

  const termCandidates = new Set<string>();
  for (const q of quotes) {
    const text = String(q.text);
    for (const m of text.matchAll(
      /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}|case-control|RMS|validity)\b/g,
    )) {
      if (m[1].length > 3) termCandidates.add(m[1]);
    }
  }
  const terms = [...termCandidates].slice(0, 6);
  if (terms.length === 0) {
    lines.push(`_(No clear key terms extracted offline.)_`, ``);
  } else {
    for (const term of terms) {
      lines.push(`- **${term}** — mentioned in your saved session text.`);
    }
    lines.push(``);
  }

  lines.push(`## What you covered`);
  if (sorted.length === 0) {
    lines.push(`1. **Empty session** — no captures were recorded.`);
  } else {
    let i = 1;
    for (const e of sorted) {
      if (e.type === "note_silent" && e.text) {
        lines.push(
          `${i}. **Saved quote** — ${previewText(String(e.text), 120)}`,
        );
        i += 1;
      } else if (e.type === "qa" && e.question) {
        lines.push(`${i}. **Explained** — ${previewText(e.question, 100)}`);
        i += 1;
      } else if (e.type === "screenshot" || e.type === "recording") {
        lines.push(
          `${i}. **${e.label || e.type}** — review this ${e.type} from the session.`,
        );
        i += 1;
      }
    }
  }

  lines.push(``, `## Quotes & context`, ``);
  if (quotes.length === 0) {
    lines.push(`_(No quotes captured.)_`, ``);
  } else {
    for (const e of quotes) {
      lines.push(`> ${String(e.text).replace(/\n/g, "\n> ")}`, ``);
      const ctx = nearbyContextBlurb(events, e);
      lines.push(
        `**Context:** ${ctx || "This was a passage you chose to keep from the session."}`,
        ``,
      );
    }
  }

  lines.push(`## Self-check`, ``);
  lines.push(...buildSelfCheckFromSession(sorted));

  if (captures.length > 0) {
    lines.push(`## Captures to review`, ``);
    for (const e of captures) {
      lines.push(`- ${e.label || e.type}`);
    }
    lines.push(``);
  }

  return lines.join("\n");
}

function recentContextForCaption(limit = 8): string {
  return sessionEvents
    .slice(-limit)
    .map((e) => {
      const bits = [`[${e.type}]`];
      if (e.label) bits.push(e.label);
      if (e.text) bits.push(e.text.slice(0, 240));
      if (e.question) bits.push(`Q:${e.question}`);
      if (e.answer) bits.push(`A:${e.answer.slice(0, 240)}`);
      if (e.fileName) bits.push(e.fileName);
      return bits.join(" ");
    })
    .join("\n");
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
    question: event.question,
    answer: event.answer,
    label: event.label,
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

  return saveNoteText(text, { emit: true });
}

async function saveNoteText(
  rawText: string,
  options?: { emit?: boolean },
): Promise<NoteSilentResult> {
  const shouldEmit = options?.emit === true;

  if (!activeSession) {
    const result: NoteSilentResult = {
      ok: false,
      error: "Start a session first",
    };
    if (shouldEmit) emitNoteResult(result);
    return result;
  }

  const text = rawText.trim();
  if (!text) {
    const result: NoteSilentResult = {
      ok: false,
      error: "Nothing to save as a note",
    };
    if (shouldEmit) emitNoteResult(result);
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

  if (activeSession.cloudSessionId) {
    void getValidIdToken().then((token) => {
      if (!token) return;
      void apiUploadTextEvent({
        idToken: token,
        cloudSessionId: activeSession!.cloudSessionId!,
        type: "note_silent",
        text,
        timestamp: event.timestamp,
      }).then((uploaded) => {
        if (uploaded.ok) {
          console.info("[coco] note uploaded", uploaded.eventId);
        } else {
          console.warn("[coco] note upload failed", uploaded.error);
        }
      });
    });
  }

  const result: NoteSilentResult = {
    ok: true,
    event,
    preview: previewText(text),
  };
  if (shouldEmit) emitNoteResult(result);
  console.info("[coco] note_silent saved", {
    eventId: event.id,
    preview: result.preview,
    totalEvents: sessionEvents.length,
  });
  return result;
}

async function explainSelection(): Promise<ExplainResult> {
  const text =
    currentSelection?.trim() || clipboard.readText().trim() || "";
  if (!text) {
    return {
      ok: false,
      error: "Copy text first, then ask Explain",
    };
  }

  if (!authSession?.idToken) {
    return {
      ok: false,
      error: "Sign in to use Explain",
    };
  }

  const idToken = await getValidIdToken();
  if (!idToken) {
    return {
      ok: false,
      error: "Sign in again — your session expired",
    };
  }

  let explained = await apiExplain({
    idToken,
    text,
    question: "What does this mean?",
  });

  if (
    !explained.ok &&
    /invalid or expired|unauth|id token/i.test(explained.error || "")
  ) {
    // Force refresh once even if skew said the token was fine.
    try {
      const apiKey = readFirebaseConfigFromEnv()?.apiKey;
      if (apiKey && authSession?.refreshToken) {
        authSession = await refreshAuthSession(authSession, apiKey);
        await saveAuthSession(authSession);
        explained = await apiExplain({
          idToken: authSession.idToken,
          text,
          question: "What does this mean?",
        });
      }
    } catch (err) {
      console.warn("[coco] explain forced refresh failed", err);
    }
    if (!explained.ok) {
      authSession = null;
      await saveAuthSession(null);
      return {
        ok: false,
        error: "Sign in again — your session expired",
      };
    }
  }

  if (!explained.ok) {
    return { ok: false, error: explained.error };
  }

  if (activeSession) {
    const event = appendSessionEvent({
      type: "qa",
      text,
      question: "What does this mean?",
      answer: explained.answer,
    });
    try {
      await persistSessionLog();
    } catch (err) {
      console.warn("[coco] failed to persist qa event", err);
    }

    const uploadToken = await getValidIdToken();
    if (activeSession.cloudSessionId && uploadToken) {
      void apiUploadTextEvent({
        idToken: uploadToken,
        cloudSessionId: activeSession.cloudSessionId,
        type: "qa",
        text,
        question: "What does this mean?",
        answer: explained.answer,
        timestamp: event.timestamp,
      }).then((uploaded) => {
        if (uploaded.ok) {
          console.info("[coco] qa uploaded", uploaded.eventId);
        } else {
          console.warn("[coco] qa upload failed", uploaded.error);
        }
      });
    }
  }

  return {
    ok: true,
    answer: explained.answer,
    preview: previewText(explained.answer, 160),
    model: explained.model,
  };
}

async function endSessionAndSynthesize(): Promise<EndSessionResult> {
  if (!activeSession) {
    return { ok: false, error: "No active session" };
  }

  const sessionSnapshot = { ...activeSession };
  const eventsSnapshot = [...sessionEvents];

  try {
    await persistSessionLog();
  } catch (err) {
    console.warn("[coco] failed to persist session log before synthesize", err);
  }

  let markdown = "";
  let model: string | null = null;

  if (eventsSnapshot.length === 0) {
    markdown = [
      `# ${sessionSnapshot.sourceLabel || "Session study note"}`,
      ``,
      `Tags: Empty session`,
      ``,
      `## Overview`,
      `No captures were recorded in this session.`,
      ``,
      `> **Big idea:** Start a session, capture a screenshot or quote, then end to build a study note.`,
      ``,
      `## Key terms`,
      `_(No key terms captured.)_`,
      ``,
      `## What you covered`,
      `1. **Empty session** — nothing to review yet.`,
      ``,
      `## Quotes & context`,
      `_(No quotes captured.)_`,
      ``,
      `## Self-check`,
      `**Q:** What will you capture next time?`,
      `**A:** One screenshot, one quote, or one question worth explaining.`,
      ``,
    ].join("\n");
  } else {
    const synthToken = await getValidIdToken();
    if (synthToken) {
      const synth = await apiSynthesize({
        idToken: synthToken,
        cloudSessionId: sessionSnapshot.cloudSessionId,
        sourceLabel: sessionSnapshot.sourceLabel,
        startedAt: sessionSnapshot.startedAt,
        events: eventsSnapshot.map((e) => ({
          type: e.type,
          timestamp: e.timestamp,
          text: e.text,
          fileName: e.fileName,
          question: e.question,
          answer: e.answer,
          label: e.label,
        })),
      });
      if (synth.ok) {
        markdown = synth.markdown;
        model = synth.model;
      } else {
        console.warn("[coco] synthesize API failed, using fallback", synth.error);
        markdown = buildFallbackMarkdown(sessionSnapshot, eventsSnapshot);
        markdown += `\n\n---\n_Local fallback (synthesize failed: ${synth.error})_\n`;
      }
    } else {
      markdown = buildFallbackMarkdown(sessionSnapshot, eventsSnapshot);
      markdown += `\n\n---\n_Sign in next time for Gemini-written notes._\n`;
    }
  }

  if (sessionSnapshot.cloudSessionId) {
    void getValidIdToken().then((token) => {
      if (!token) return;
      void apiEndSession({
        idToken: token,
        cloudSessionId: sessionSnapshot.cloudSessionId!,
      }).then((ended) => {
        if (ended.ok) {
          console.info("[coco] cloud session ended", sessionSnapshot.cloudSessionId);
        } else {
          console.warn("[coco] cloud session end failed", ended.error);
        }
      });
    });
  }

  const dir = notesDir();
  await fs.mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeLabel = sessionSnapshot.sourceLabel
    .replace(/[^\w\-]+/g, "_")
    .slice(0, 40);
  const baseName = `${stamp}_${safeLabel || "session"}`;
  const htmlFileName = `${baseName}.html`;
  const htmlPath = path.join(dir, htmlFileName);

  const pack = await writeNotesHtml({
    htmlPath,
    markdown,
    title: `Coco notes · ${sessionSnapshot.sourceLabel}`,
    sourceLabel: sessionSnapshot.sourceLabel,
    startedAt: sessionSnapshot.startedAt,
    downloadName: htmlFileName,
    media: eventsSnapshot
      .filter((e) => e.type === "screenshot" || e.type === "recording")
      .map((e) => ({
        type: e.type as "screenshot" | "recording",
        label: e.label,
        fileName: e.fileName,
        filePath: e.filePath,
        timestamp: e.timestamp,
      })),
  });

  if (!pack.htmlPath.toLowerCase().endsWith(".html")) {
    console.warn("[coco] unexpected notes path (expected .html)", pack.htmlPath);
  }

  const filePath = pack.htmlPath;
  const fileName = htmlFileName;

  try {
    openNotesPackWindow(pack.htmlPath);
  } catch (err) {
    console.warn("[coco] notes window failed; opening path", err);
    try {
      await shell.openPath(pack.htmlPath);
    } catch (err2) {
      console.warn("[coco] could not open notes html", err2);
    }
  }

  stopClipboardWatcher();
  activeSession = null;
  sessionEvents = [];
  currentSelection = null;
  lastClipboardText = "";
  isRecording = false;

  console.info("[coco] notes ready", {
    filePath,
    mediaCount: pack.mediaCount,
    model,
    events: eventsSnapshot.length,
  });
  return {
    ok: true,
    filePath,
    fileName,
    model,
    eventCount: eventsSnapshot.length,
  };
}

async function transcribeVoice(payload: {
  audioBase64: string;
  mimeType: string;
}): Promise<TranscribeResult> {
  if (!authSession?.idToken) {
    return { ok: false, error: "Sign in to use voice commands" };
  }
  const idToken = await getValidIdToken();
  if (!idToken) {
    return { ok: false, error: "Sign in again — your session expired" };
  }
  const audioBase64 = String(payload.audioBase64 ?? "").trim();
  if (!audioBase64) {
    return { ok: false, error: "No audio captured" };
  }
  const mimeType = String(payload.mimeType ?? "audio/webm").trim() || "audio/webm";
  const result = await apiTranscribe({
    idToken,
    audioBase64,
    mimeType,
  });
  if (!result.ok) {
    return { ok: false, error: result.error };
  }
  return {
    ok: true,
    transcript: result.transcript,
    model: result.model,
  };
}

async function speakCloud(text: string): Promise<SpeakResult> {
  if (!authSession?.idToken) {
    return { ok: false, error: "Sign in to use spoken replies" };
  }
  const idToken = await getValidIdToken();
  if (!idToken) {
    return { ok: false, error: "Sign in again — your session expired" };
  }
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) {
    return { ok: false, error: "No text to speak" };
  }
  return apiSpeak({ idToken, text: clean });
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

    const event = appendSessionEvent({
      type: "screenshot",
      filePath,
      fileName,
    });
    void persistSessionLog().catch((err) => {
      console.warn("[coco] failed to persist session log", err);
    });

    let cloudUploaded = false;
    let cloudError: string | undefined;
    const cloudSessionId = activeSession.cloudSessionId;
    const token = await getValidIdToken();
    const png = await fs.readFile(filePath);
    const imageBase64 = png.toString("base64");

    if (token) {
      try {
        const captioned = await apiCaption({
          idToken: token,
          kind: "screenshot",
          imageBase64,
          mimeType: "image/png",
          sourceLabel: activeSession.sourceLabel,
          hint: recentContextForCaption(),
        });
        if (captioned.ok) {
          event.label = captioned.label;
          void persistSessionLog().catch(() => undefined);
          console.info("[coco] screenshot labeled", captioned.label);
        } else {
          console.warn("[coco] screenshot caption failed", captioned.error);
        }
      } catch (err) {
        console.warn("[coco] screenshot caption error", err);
      }
    }

    if (cloudSessionId && token) {
      try {
        const uploaded = await apiUploadScreenshot({
          idToken: token,
          cloudSessionId,
          fileName,
          imageBase64,
        });
        if (uploaded.ok) {
          cloudUploaded = true;
          console.info("[coco] screenshot uploaded", uploaded.storagePath);
        } else {
          cloudError = uploaded.error;
          console.warn("[coco] screenshot upload failed", uploaded.error);
        }
      } catch (err) {
        cloudError = err instanceof Error ? err.message : String(err);
        console.warn("[coco] screenshot upload error", cloudError);
      }
    }

    const result: ScreenshotResult = {
      ok: true,
      filePath,
      fileName,
      cloudUploaded,
      cloudError,
      label: event.label,
    };
    emitScreenshotResult(result);
    console.info("[coco] screenshot saved", {
      fileName,
      label: event.label,
      cloudUploaded,
      cloudError,
    });
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

  const rememberOk = globalShortcut.register(REMEMBER_HOTKEY, () => {
    orbWindow?.webContents.send("command:remember");
  });
  if (!rememberOk) {
    console.warn(`[coco] failed to register hotkey ${REMEMBER_HOTKEY}`);
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

    if (activeSession) {
      const event = appendSessionEvent({
        type: "recording",
        filePath,
        fileName,
      });
      void persistSessionLog().catch((err) => {
        console.warn("[coco] failed to persist session log", err);
      });

      const captionToken = await getValidIdToken();
      if (captionToken) {
        try {
          const captioned = await apiCaption({
            idToken: captionToken,
            kind: "recording",
            fileName,
            sourceLabel: activeSession.sourceLabel,
            recentContext: recentContextForCaption(),
          });
          if (captioned.ok) {
            event.label = captioned.label;
            void persistSessionLog().catch(() => undefined);
            console.info("[coco] recording labeled", captioned.label);
          } else {
            console.warn("[coco] recording caption failed", captioned.error);
          }
        } catch (err) {
          console.warn("[coco] recording caption error", err);
        }
      }

      const result: RecordingSaveResult = {
        ok: true,
        filePath,
        fileName,
        label: event.label,
      };
      console.info("[coco] recording saved", result);
      return result;
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
      layout !== "command" &&
      layout !== "remember"
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
    async (
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
        // Mid-session source change: keep timeline + clipboard selection + cloud session.
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
          cloudSessionId: null,
        };
        sessionEvents = [];
        startClipboardWatcher();

        const startToken = await getValidIdToken();
        if (startToken) {
          const cloud = await apiStartSession({
            idToken: startToken,
            sourceLabel: activeSession.sourceLabel,
            sourceType: activeSession.sourceType,
            localSessionId: activeSession.id,
          });
          if (cloud.ok) {
            activeSession.cloudSessionId = cloud.sessionId;
            console.info("[coco] cloud session started", cloud.sessionId);
          } else {
            console.warn("[coco] cloud session start failed", cloud.error);
          }
        }

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

  ipcMain.handle(
    "session:end",
    async (): Promise<EndSessionResult> => endSessionAndSynthesize(),
  );

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

  ipcMain.handle(
    "notes:save-text",
    async (_event, text: string): Promise<NoteSilentResult> =>
      saveNoteText(String(text ?? "")),
  );

  ipcMain.handle("notes:get-events", () => sessionEvents);

  ipcMain.handle("notes:get-selection", () => currentSelection);

  ipcMain.handle("ai:explain", async () => explainSelection());

  ipcMain.handle(
    "voice:transcribe",
    async (
      _event,
      payload: { audioBase64: string; mimeType: string },
    ): Promise<TranscribeResult> => transcribeVoice(payload),
  );

  ipcMain.handle(
    "voice:speak",
    async (_event, text: string): Promise<SpeakResult> =>
      speakCloud(String(text ?? "")),
  );

  ipcMain.handle("auth:google-sign-in", async () => {
    const config = readFirebaseConfigFromEnv();
    if (!config) {
      return {
        ok: false as const,
        error:
          "Firebase .env values are empty. Paste the web config into VITE_FIREBASE_* keys, then restart.",
      };
    }

    const result = await startGoogleSystemBrowserLogin(config);
    if (!result.ok) return result;

    authSession = withTokenExpiry(result.session);
    await saveAuthSession(authSession);
    return { ok: true as const, session: authSession };
  });

  ipcMain.handle("auth:get-session", () => authSession);

  ipcMain.handle("auth:sign-out", async () => {
    authSession = null;
    await saveAuthSession(null);
    return { ok: true as const };
  });
}

app.whenReady().then(async () => {
  if (process.platform === "darwin" && app.dock) {
    app.dock.hide();
  }

  authSession = await loadAuthSession();
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
