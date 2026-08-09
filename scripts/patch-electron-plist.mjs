import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const plist = path.join(
  root,
  "node_modules/electron/dist/Electron.app/Contents/Info.plist",
);

const description =
  "Coco needs Screen Recording to show live screen and window previews and capture your study session.";

if (!fs.existsSync(plist)) {
  console.warn("[coco] Electron Info.plist not found; skip screen permission patch.");
  process.exit(0);
}

try {
  execFileSync(
    "plutil",
    ["-replace", "NSScreenCaptureUsageDescription", "-string", description, plist],
    { stdio: "inherit" },
  );
  console.log("[coco] Patched Electron Info.plist with NSScreenCaptureUsageDescription");
} catch {
  try {
    execFileSync(
      "plutil",
      ["-insert", "NSScreenCaptureUsageDescription", "-string", description, plist],
      { stdio: "inherit" },
    );
    console.log("[coco] Inserted NSScreenCaptureUsageDescription into Electron Info.plist");
  } catch (err) {
    console.warn(
      "[coco] Could not patch Electron Info.plist:",
      err instanceof Error ? err.message : err,
    );
  }
}
