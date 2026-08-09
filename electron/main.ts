import {
  app,
  BrowserWindow,
  ipcMain,
  screen,
  type Rectangle,
} from "electron";
import path from "node:path";

const ORB_SIZE = 72;
const EDGE_MARGIN = 10;

let orbWindow: BrowserWindow | null = null;

/** Keep the orb above fullscreen apps and across all macOS Spaces. */
function applyOverlayBehavior(win: BrowserWindow): void {
  win.setAlwaysOnTop(true, "screen-saver");
  // Must run after the window is shown; calling only at create-time is flaky on macOS.
  win.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
  });
  // Re-assert once more on the next tick — macOS sometimes drops the first call.
  setImmediate(() => {
    if (win.isDestroyed()) return;
    win.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
    });
    win.setAlwaysOnTop(true, "screen-saver");
  });
}

function createOrbWindow(): BrowserWindow {
  const display = screen.getPrimaryDisplay();
  const { workArea } = display;

  const win = new BrowserWindow({
    width: ORB_SIZE,
    height: ORB_SIZE,
    x: Math.round(workArea.x + workArea.width - ORB_SIZE - EDGE_MARGIN),
    y: Math.round(workArea.y + workArea.height / 2 - ORB_SIZE / 2),
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
    // NSPanel-style window participates better across Spaces on macOS.
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
    orbWindow = null;
  });

  return win;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function snapToNearestEdge(win: BrowserWindow): void {
  const bounds = win.getBounds();
  const display = screen.getDisplayMatching(bounds);
  const work = display.workArea;

  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;

  const distLeft = centerX - work.x;
  const distRight = work.x + work.width - centerX;
  const distTop = centerY - work.y;
  const distBottom = work.y + work.height - centerY;

  const nearest = Math.min(distLeft, distRight, distTop, distBottom);

  let nextX = bounds.x;
  let nextY = bounds.y;

  const minX = work.x + EDGE_MARGIN;
  const maxX = work.x + work.width - bounds.width - EDGE_MARGIN;
  const minY = work.y + EDGE_MARGIN;
  const maxY = work.y + work.height - bounds.height - EDGE_MARGIN;

  if (nearest === distLeft) {
    nextX = minX;
    nextY = clamp(bounds.y, minY, maxY);
  } else if (nearest === distRight) {
    nextX = maxX;
    nextY = clamp(bounds.y, minY, maxY);
  } else if (nearest === distTop) {
    nextY = minY;
    nextX = clamp(bounds.x, minX, maxX);
  } else {
    nextY = maxY;
    nextX = clamp(bounds.x, minX, maxX);
  }

  win.setPosition(Math.round(nextX), Math.round(nextY));
}

function registerIpc(): void {
  ipcMain.handle("orb:get-bounds", (): Rectangle => {
    if (!orbWindow) {
      return { x: 0, y: 0, width: ORB_SIZE, height: ORB_SIZE };
    }
    return orbWindow.getBounds();
  });

  ipcMain.on("orb:set-position", (_event, x: number, y: number) => {
    if (!orbWindow) return;
    orbWindow.setPosition(Math.round(x), Math.round(y));
  });

  ipcMain.on("orb:snap-to-edge", () => {
    if (!orbWindow) return;
    snapToNearestEdge(orbWindow);
  });
}

app.whenReady().then(() => {
  // Overlay-style helper app: hide Dock icon so macOS treats us more like a UIElement.
  if (process.platform === "darwin" && app.dock) {
    app.dock.hide();
  }

  registerIpc();
  orbWindow = createOrbWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      orbWindow = createOrbWindow();
    } else if (orbWindow && !orbWindow.isDestroyed()) {
      applyOverlayBehavior(orbWindow);
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
