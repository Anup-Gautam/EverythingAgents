import {
  useCallback,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

type DragState = {
  offsetX: number;
  offsetY: number;
};

export function App() {
  const draggingRef = useRef(false);
  const dragOffsetRef = useRef<DragState>({ offsetX: 0, offsetY: 0 });
  const [pressed, setPressed] = useState(false);

  const onPointerDown = useCallback(
    async (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (!window.coco) return;

      event.currentTarget.setPointerCapture(event.pointerId);
      setPressed(true);

      const bounds = await window.coco.getBounds();
      dragOffsetRef.current = {
        offsetX: event.screenX - bounds.x,
        offsetY: event.screenY - bounds.y,
      };
      draggingRef.current = true;
    },
    [],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (!draggingRef.current || !window.coco) return;

      const { offsetX, offsetY } = dragOffsetRef.current;
      window.coco.setPosition(
        event.screenX - offsetX,
        event.screenY - offsetY,
      );
    },
    [],
  );

  const endDrag = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (!draggingRef.current) return;

      draggingRef.current = false;
      setPressed(false);

      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // Already released.
      }

      window.coco?.snapToEdge();
    },
    [],
  );

  return (
    <div className="shell">
      <button
        type="button"
        className={`orb orb--idle${pressed ? " orb--pressed" : ""}`}
        aria-label="Coco orb"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <span className="orb__core" />
      </button>
    </div>
  );
}
