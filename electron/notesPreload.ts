import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("cocoNotes", {
  saveCopy: (): Promise<
    { ok: true; filePath: string } | { ok: false; error?: string; canceled?: boolean }
  > => ipcRenderer.invoke("notes-window:save-copy"),
  reveal: (): Promise<void> => ipcRenderer.invoke("notes-window:reveal"),
});
