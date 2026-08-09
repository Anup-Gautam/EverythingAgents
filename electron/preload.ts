import { contextBridge, ipcRenderer } from "electron";

export type OrbBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const coco = {
  getBounds: (): Promise<OrbBounds> => ipcRenderer.invoke("orb:get-bounds"),
  setPosition: (x: number, y: number): void => {
    ipcRenderer.send("orb:set-position", x, y);
  },
  snapToEdge: (): void => {
    ipcRenderer.send("orb:snap-to-edge");
  },
};

contextBridge.exposeInMainWorld("coco", coco);
