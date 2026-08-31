/** Single offline HTML study note with embedded captures + Save download. */

import { BrowserWindow, dialog, ipcMain, shell } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { marked } from "marked";

export type NotesPackMedia = {
  type: "screenshot" | "recording";
  label?: string;
  fileName?: string;
  filePath?: string;
  timestamp: number;
};

type EmbeddedMedia = NotesPackMedia & {
  fileName: string;
  dataUri?: string;
};

const notesWindowSources = new Map<number, string>();
let notesIpcRegistered = false;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function mimeFor(fileName: string, type: "screenshot" | "recording"): string {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".mp4") return "video/mp4";
  if (ext === ".webm") return "video/webm";
  return type === "recording" ? "video/webm" : "image/png";
}

async function embedMedia(items: NotesPackMedia[]): Promise<EmbeddedMedia[]> {
  const out: EmbeddedMedia[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const fileName =
      path.basename(item.fileName || item.filePath || "") ||
      `${item.type}-${i + 1}${item.type === "screenshot" ? ".png" : ".webm"}`;

    let dataUri: string | undefined;
    if (item.filePath) {
      try {
        const bytes = await fs.readFile(item.filePath);
        const mime = mimeFor(fileName, item.type);
        dataUri = `data:${mime};base64,${bytes.toString("base64")}`;
      } catch (err) {
        console.warn("[coco] notes html: could not embed media", item.filePath, err);
      }
    }

    out.push({ ...item, fileName, dataUri });
  }

  return out;
}

function extractTitleAndTags(markdown: string): {
  title: string | null;
  tags: string[];
  bodyMarkdown: string;
} {
  let title: string | null = null;
  const tags: string[] = [];
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const kept: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const h1 = line.match(/^#\s+(.+)$/);
    if (!title && h1) {
      title = h1[1].trim();
      continue;
    }
    const tagLine = line.match(/^Tags:\s*(.+)$/i);
    if (tagLine) {
      for (const part of tagLine[1].split(/[|,]/)) {
        const t = part.trim();
        if (t) tags.push(t);
      }
      continue;
    }
    kept.push(line);
  }

  return { title, tags, bodyMarkdown: kept.join("\n").trim() };
}

function enhanceStudyHtml(html: string): string {
  let out = html;

  // Big-idea blockquotes → callout boxes
  out = out.replace(
    /<blockquote>\s*<p>\s*<strong>\s*Big idea:\s*<\/strong>\s*([\s\S]*?)<\/p>\s*<\/blockquote>/gi,
    (_m, body: string) =>
      `<div class="callout"><strong>Big idea:</strong> ${body.trim()}</div>`,
  );

  // Key-term bullets → definition list when pattern matches **Term** — def
  out = out.replace(
    /(<h2[^>]*>\s*Key terms\s*<\/h2>\s*)(<ul>[\s\S]*?<\/ul>)/i,
    (_m, heading: string, ul: string) => {
      const items = [...ul.matchAll(/<li>\s*(?:<p>)?(.*?)\s*(?:<\/p>)?\s*<\/li>/gi)];
      if (items.length === 0) return `${heading}${ul}`;
      const rows: string[] = [];
      for (const item of items) {
        const inner = item[1];
        const m = inner.match(
          /<strong>\s*([^<]+?)\s*<\/strong>\s*(?:—|-|–|:)\s*([\s\S]+)/i,
        );
        if (!m) return `${heading}${ul}`;
        rows.push(
          `<div class="term"><dt>${m[1].trim()}</dt><dd>${m[2].trim()}</dd></div>`,
        );
      }
      return `${heading}<dl class="term-list">${rows.join("")}</dl>`;
    },
  );

  // Wrap Self-check section in summary box
  out = out.replace(
    /<h2([^>]*)>\s*Self-check\s*<\/h2>([\s\S]*?)(?=<h2[\s>]|$)/i,
    (_m, attrs: string, body: string) =>
      `<section class="summary-box"><h2${attrs}>Self-check</h2><div class="qa">${body.trim()}</div></section>`,
  );

  // Numbered coverage list class
  out = out.replace(
    /(<h2[^>]*>\s*What you covered\s*<\/h2>\s*)(<ol>)/i,
    "$1<ol class=\"steps\">",
  );

  return out;
}

function mediaSectionHtml(media: EmbeddedMedia[]): string {
  if (media.length === 0) return "";

  const blocks = media.map((m) => {
    const title = escapeHtml(m.label || m.fileName || m.type);
    const when = escapeHtml(
      new Date(m.timestamp).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }),
    );
    const kind = m.type === "screenshot" ? "Screenshot" : "Recording";
    let body = `<p class="muted">Capture unavailable.</p>`;

    if (m.dataUri && m.type === "screenshot") {
      body = `<figure>
  <img src="${m.dataUri}" alt="${title}" />
  <figcaption>${title} · ${when}</figcaption>
</figure>`;
    } else if (m.dataUri && m.type === "recording") {
      body = `<figure>
  <div class="video-frame"><video controls preload="metadata" src="${m.dataUri}"></video></div>
  <figcaption>${title} · ${when}</figcaption>
</figure>
<p class="video-note">${kind} from this session — replay to refresh the moment.</p>`;
    }

    return `<article class="capture-block">
  <h3>${title}</h3>
  ${body}
</article>`;
  });

  return `<section>
  <h2>Diagrams & captures</h2>
  ${blocks.join("\n")}
</section>`;
}

function packStyles(): string {
  return `
    :root {
      --paper: #fbf7ee;
      --rule: #dcd3bd;
      --ink: #2e2a22;
      --leaf: #3f6b4a;
      --leaf-light: #e7efe4;
      --accent: #c96a3f;
      --sub: #7a7362;
      --card: #ffffff;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--paper);
      color: var(--ink);
      font-family: Georgia, "Iowan Old Style", "Palatino Linotype", serif;
      line-height: 1.6;
      font-size: 16px;
      min-height: 100vh;
    }
    .topbar {
      position: sticky;
      top: 0;
      z-index: 2;
      display: flex;
      gap: 12px;
      align-items: center;
      justify-content: space-between;
      padding: 10px 20px;
      background: rgba(251, 247, 238, 0.94);
      border-bottom: 1px solid var(--rule);
      backdrop-filter: blur(10px);
      font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
      font-size: 13px;
    }
    .brand { font-weight: 650; letter-spacing: 0.04em; color: var(--leaf); text-transform: uppercase; font-size: 0.75rem; }
    .actions { display: flex; gap: 8px; }
    .actions button {
      color: var(--leaf);
      border: 1px solid var(--leaf);
      background: var(--card);
      padding: 6px 10px;
      border-radius: 8px;
      font: inherit;
      cursor: pointer;
    }
    .actions button:hover { background: var(--leaf-light); }
    .page {
      max-width: 820px;
      margin: 0 auto;
      padding: 40px 36px 80px;
    }
    .masthead {
      border-bottom: 3px solid var(--ink);
      padding-bottom: 14px;
      margin-bottom: 22px;
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      flex-wrap: wrap;
      gap: 8px;
    }
    .masthead h1 {
      font-size: 1.9rem;
      margin: 0;
      letter-spacing: 0.2px;
      line-height: 1.2;
    }
    .masthead .meta {
      font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
      font-size: 0.78rem;
      color: var(--sub);
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    .tags {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-bottom: 28px;
    }
    .tag {
      font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
      font-size: 0.72rem;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      background: var(--leaf-light);
      color: var(--leaf);
      border: 1px solid var(--leaf);
      padding: 3px 10px;
      border-radius: 20px;
    }
    .notes section, .notes > h2 { }
    .notes h2 {
      font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
      font-size: 0.95rem;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: var(--leaf);
      border-bottom: 1px solid var(--rule);
      padding-bottom: 6px;
      margin: 1.8em 0 14px;
    }
    .notes h3 {
      font-size: 1.05rem;
      margin: 1.1em 0 0.35em;
    }
    .notes p, .notes li { margin: 0 0 12px; }
    .notes ul { padding-left: 1.2em; }
    .callout {
      background: var(--card);
      border-left: 4px solid var(--accent);
      padding: 14px 18px;
      margin: 16px 0;
      font-size: 0.95rem;
    }
    .callout strong { color: var(--accent); }
    .notes blockquote {
      margin: 14px 0;
      padding: 12px 16px;
      border-left: 4px solid var(--accent);
      background: var(--card);
      color: var(--ink);
    }
    .term-list {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px 24px;
      font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
      font-size: 0.9rem;
      margin: 0;
    }
    .term-list .term { display: contents; }
    .term-list dt { font-weight: 700; color: var(--leaf); }
    .term-list dd { margin: 0 0 10px 0; color: var(--ink); }
    ol.steps { padding-left: 22px; margin: 0; }
    ol.steps li { margin-bottom: 10px; }
    .summary-box {
      background: var(--leaf-light);
      border: 1px solid var(--leaf);
      border-radius: 8px;
      padding: 18px 20px;
      margin: 28px 0 8px;
    }
    .summary-box h2 {
      color: var(--leaf);
      border: none;
      margin: 0 0 10px;
      padding: 0;
    }
    .qa {
      font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
      font-size: 0.9rem;
    }
    .qa p { margin: 0 0 6px; }
    figure {
      margin: 16px 0 8px;
      text-align: center;
    }
    figure img, .video-frame video {
      display: block;
      width: 100%;
      max-height: 480px;
      object-fit: contain;
      background: #fff;
      border: 1px solid var(--rule);
      border-radius: 6px;
      padding: 10px;
    }
    .video-frame {
      border-radius: 8px;
      overflow: hidden;
      border: 1px solid var(--rule);
      background: #111;
    }
    .video-frame video { padding: 0; border: none; border-radius: 0; max-height: 480px; }
    figcaption, .video-note, .muted {
      font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
      font-size: 0.78rem;
      color: var(--sub);
      margin-top: 8px;
    }
    .capture-block { margin-bottom: 28px; }
    .capture-block h3 {
      font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
      font-size: 0.95rem;
      margin: 0 0 6px;
    }
    .footer-tip {
      margin-top: 40px;
      padding-top: 16px;
      border-top: 1px dashed var(--rule);
      font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
      font-size: 0.82rem;
      color: var(--sub);
    }
    .notes code, .notes pre {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.86em;
    }
    .notes pre {
      background: #fff;
      border: 1px solid var(--rule);
      padding: 10px 12px;
      overflow-wrap: anywhere;
      white-space: pre-wrap;
      border-radius: 6px;
    }
    @media (max-width: 640px) {
      .page { padding: 28px 18px 64px; }
      .term-list { grid-template-columns: 1fr; }
      .masthead h1 { font-size: 1.55rem; }
    }
  `;
}

function saveScript(): string {
  return `
<script>
(function () {
  var saveBtn = document.getElementById("save-html");
  var revealBtn = document.getElementById("reveal-html");
  if (saveBtn) {
    saveBtn.addEventListener("click", function () {
      if (window.cocoNotes && window.cocoNotes.saveCopy) {
        window.cocoNotes.saveCopy().then(function (result) {
          if (result && result.ok) {
            saveBtn.textContent = "Saved";
            setTimeout(function () { saveBtn.textContent = "Save HTML"; }, 1600);
          }
        });
        return;
      }
      var html = "<!doctype html>\\n" + document.documentElement.outerHTML;
      var blob = new Blob([html], { type: "text/html;charset=utf-8" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = "coco-notes.html";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
    });
  }
  if (revealBtn && window.cocoNotes && window.cocoNotes.reveal) {
    revealBtn.addEventListener("click", function () {
      window.cocoNotes.reveal();
    });
  }
})();
</script>`;
}

function ensureNotesIpc(): void {
  if (notesIpcRegistered) return;
  notesIpcRegistered = true;

  ipcMain.handle("notes-window:save-copy", async (event) => {
    const sourcePath = notesWindowSources.get(event.sender.id);
    if (!sourcePath) {
      return { ok: false, error: "Notes file not found for this window." };
    }

    const parent = BrowserWindow.fromWebContents(event.sender);
    const result = parent
      ? await dialog.showSaveDialog(parent, {
          title: "Save Coco notes",
          defaultPath: path.basename(sourcePath),
          filters: [{ name: "HTML", extensions: ["html"] }],
        })
      : await dialog.showSaveDialog({
          title: "Save Coco notes",
          defaultPath: path.basename(sourcePath),
          filters: [{ name: "HTML", extensions: ["html"] }],
        });

    if (result.canceled || !result.filePath) {
      return { ok: false, canceled: true };
    }

    const dest = result.filePath.endsWith(".html")
      ? result.filePath
      : `${result.filePath}.html`;
    await fs.copyFile(sourcePath, dest);
    return { ok: true, filePath: dest };
  });

  ipcMain.handle("notes-window:reveal", async (event) => {
    const sourcePath = notesWindowSources.get(event.sender.id);
    if (!sourcePath) return;
    shell.showItemInFolder(sourcePath);
  });
}

export async function writeNotesHtml(input: {
  htmlPath: string;
  markdown: string;
  media: NotesPackMedia[];
  title?: string;
  sourceLabel?: string;
  startedAt?: number;
  downloadName?: string;
}): Promise<{ htmlPath: string; mediaCount: number }> {
  const embedded = await embedMedia(input.media);
  const { title: mdTitle, tags, bodyMarkdown } = extractTitleAndTags(
    input.markdown,
  );
  const parsedBody = await marked.parse(bodyMarkdown || input.markdown, {
    async: true,
  });
  const notesHtml = enhanceStudyHtml(String(parsedBody));

  const displayTitle =
    mdTitle ||
    input.title?.replace(/^Coco notes\s*[·•-]\s*/i, "").trim() ||
    "Session study note";
  const pageTitle = escapeHtml(displayTitle);
  const metaBits = [
    input.sourceLabel?.trim() || null,
    input.startedAt
      ? new Date(input.startedAt).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
          year: "numeric",
        })
      : null,
  ].filter(Boolean);
  const meta = escapeHtml(metaBits.join(" · ") || "Coco session");

  const tagsHtml =
    tags.length > 0
      ? `<div class="tags">${tags
          .map((t) => `<span class="tag">${escapeHtml(t)}</span>`)
          .join("")}</div>`
      : "";

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${pageTitle}</title>
  <style>${packStyles()}</style>
</head>
<body>
  <div class="topbar">
    <div class="brand">Coco study note</div>
    <div class="actions">
      <button type="button" id="reveal-html">Show in Finder</button>
      <button type="button" id="save-html">Save HTML</button>
    </div>
  </div>
  <div class="page">
    <div class="masthead">
      <h1>${pageTitle}</h1>
      <div class="meta">${meta}</div>
    </div>
    ${tagsHtml}
    <article class="notes">${notesHtml}</article>
    ${mediaSectionHtml(embedded)}
    <div class="footer-tip">
      Tip: skim the Big idea, then key terms, then replay any capture that still feels fuzzy.
      Use Self-check last to lock it in.
    </div>
  </div>
  ${saveScript()}
</body>
</html>`;

  await fs.mkdir(path.dirname(input.htmlPath), { recursive: true });
  await fs.writeFile(input.htmlPath, html, "utf8");
  console.info("[coco] notes html written", input.htmlPath);

  return {
    htmlPath: input.htmlPath,
    mediaCount: embedded.filter((m) => Boolean(m.dataUri)).length,
  };
}

export function openNotesPackWindow(htmlPath: string): BrowserWindow {
  ensureNotesIpc();

  const win = new BrowserWindow({
    width: 980,
    height: 1100,
    minWidth: 640,
    minHeight: 480,
    title: "Coco Notes",
    show: true,
    webPreferences: {
      preload: path.join(__dirname, "notesPreload.js"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  notesWindowSources.set(win.webContents.id, htmlPath);
  win.on("closed", () => {
    notesWindowSources.delete(win.webContents.id);
  });

  void win.loadFile(htmlPath).catch(async (err) => {
    console.warn("[coco] notes window loadFile failed, opening in browser", err);
    await shell.openPath(htmlPath);
  });

  shell.showItemInFolder(htmlPath);
  return win;
}
