import { useEffect, useState } from "react";
import type { CaptureSource, SourceType } from "./session";

type Props = {
  onSelect: (source: CaptureSource) => void;
  onCancel: () => void;
};

type PermissionHint = "ok" | "needs_permission" | "restart_required";

export function SourcePicker({ onSelect, onCancel }: Props) {
  const [tab, setTab] = useState<SourceType>("screen");
  const [sources, setSources] = useState<CaptureSource[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [permissionHint, setPermissionHint] = useState<PermissionHint>("ok");
  const [screenAccess, setScreenAccess] = useState("unknown");

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!window.coco?.listSources) {
        setError("Capture API unavailable");
        setLoading(false);
        return;
      }

      try {
        const result = await window.coco.listSources(tab);
        if (cancelled) return;

        setSources(result.sources);
        setPermissionHint(result.permissionHint);
        setScreenAccess(result.screenAccess);
        setError(null);
        setLoading(false);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Could not list sources. Check Screen Recording permission.",
          );
          setPermissionHint("needs_permission");
          setLoading(false);
        }
      }
    };

    void load();
    const id = window.setInterval(() => {
      void load();
    }, 1000);

    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [tab]);

  const showPermissionHelp = permissionHint !== "ok";
  const usableSources = sources.filter((source) => source.thumbnailDataUrl);

  return (
    <div className="picker" role="dialog" aria-label="Share a screen or window">
      <div className="picker__header">
        <p className="picker__title">Share with Coco</p>
        <button
          type="button"
          className="picker__close"
          aria-label="Close picker"
          onClick={onCancel}
        >
          ×
        </button>
      </div>

      <div className="picker__tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "screen"}
          className={`picker__tab${tab === "screen" ? " picker__tab--active" : ""}`}
          onClick={() => {
            setLoading(true);
            setTab("screen");
          }}
        >
          Screens
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "window"}
          className={`picker__tab${tab === "window" ? " picker__tab--active" : ""}`}
          onClick={() => {
            setLoading(true);
            setTab("window");
          }}
        >
          Windows
        </button>
      </div>

      <div className="picker__body">
        {error ? <p className="picker__error">{error}</p> : null}

        {showPermissionHelp ? (
          <div className="picker__permission">
            <p className="picker__hint">
              {permissionHint === "restart_required"
                ? "Screen Recording looks enabled, but previews are still blank. Quit Coco completely and run npm start again."
                : "Coco needs Screen Recording permission to request live previews. Enable Electron in System Settings, then quit and relaunch the app."}
            </p>
            <p className="picker__meta">Status: {screenAccess}</p>
            <div className="picker__actions">
              <button
                type="button"
                className="picker__action picker__action--primary"
                onClick={() => void window.coco.openScreenRecordingSettings()}
              >
                Open Screen Recording settings
              </button>
              <button
                type="button"
                className="picker__action"
                onClick={() => void window.coco.revealElectronApp()}
              >
                Reveal Electron.app
              </button>
            </div>
          </div>
        ) : null}

        {!error && !showPermissionHelp && loading && usableSources.length === 0 ? (
          <p className="picker__hint">Looking for sources…</p>
        ) : null}

        {!error && !showPermissionHelp && !loading && usableSources.length === 0 ? (
          <p className="picker__hint">
            No {tab === "screen" ? "screens" : "windows"} found.
          </p>
        ) : null}

        {!showPermissionHelp ? (
          <div className="picker__grid">
            {usableSources.map((source) => (
              <button
                key={source.id}
                type="button"
                className="picker__card"
                onClick={() => onSelect(source)}
              >
                <img
                  className="picker__thumb"
                  src={source.thumbnailDataUrl}
                  alt=""
                  draggable={false}
                />
                <span className="picker__name">
                  {source.appIconDataUrl ? (
                    <img
                      className="picker__icon"
                      src={source.appIconDataUrl}
                      alt=""
                      draggable={false}
                    />
                  ) : null}
                  {source.name}
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
