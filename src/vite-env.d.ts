/// <reference types="vite/client" />

type OrbBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

interface CocoApi {
  getBounds: () => Promise<OrbBounds>;
  setPosition: (x: number, y: number) => void;
  snapToEdge: () => void;
}

interface Window {
  coco: CocoApi;
}
