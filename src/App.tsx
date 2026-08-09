import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { CommandBar } from "./CommandBar";
import { classifyCommand, intentLabel, type Intent } from "./intents";
import { orbStateLabel, type OrbState } from "./orbStates";
import { ScreenRecorder } from "./screenRecorder";
import type { CaptureSource, LocalSession } from "./session";
import { SourcePicker } from "./SourcePicker";
import { isSpeechRecognitionAvailable, listenOnce } from "./speech";

type DragState = {
  offsetX: number;
  offsetY: number;
  startX: number;
  startY: number;
};

const DRAG_THRESHOLD_PX = 5;
const LONG_PRESS_MS = 450;

export function App() {
  const [orbState, setOrbState] = useState<OrbState>("idle");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandText, setCommandText] = useState("");
  const [commandHint, setCommandHint] = useState<string | null>(null);
  const [session, setSession] = useState<LocalSession | null>(null);
  const [recording, setRecording] = useState(false);
  const [listening, setListening] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [caption, setCaption] = useState<string | null>(null);

  const draggingRef = useRef(false);
  const didDragRef = useRef(false);
  const longPressRef = useRef(false);
  const pressTimerRef = useRef<number | null>(null);
  const dragOffsetRef = useRef<DragState>({
    offsetX: 0,
    offsetY: 0,
    startX: 0,
    startY: 0,
  });
  const captionTimerRef = useRef<number | null>(null);
  const recorderRef = useRef(new ScreenRecorder());
  const sessionRef = useRef<LocalSession | null>(null);
  const recordingRef = useRef(false);
  const listeningRef = useRef(false);
  const togglingRef = useRef(false);
  const pttBusyRef = useRef(false);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    recordingRef.current = recording;
    window.coco?.setRecordingState(recording);
  }, [recording]);

  useEffect(() => {
    listeningRef.current = listening;
  }, [listening]);

  const showCaption = useCallback((text: string, ms = 1600) => {
    setCaption(text);
    if (captionTimerRef.current !== null) {
      window.clearTimeout(captionTimerRef.current);
    }
    captionTimerRef.current = window.setTimeout(() => {
      setCaption(null);
      captionTimerRef.current = null;
    }, ms);
  }, []);

  const closeCommandBar = useCallback(async () => {
    setCommandOpen(false);
    setCommandHint(null);
    await window.coco?.setLayout("compact");
  }, []);

  const openCommandBar = useCallback(
    async (prefill = "", hint: string | null = null) => {
      setPickerOpen(false);
      setCommandOpen(true);
      setCommandText(prefill);
      setCommandHint(hint);
      await window.coco?.setLayout("command");
    },
    [],
  );

  const openPicker = useCallback(async () => {
    setCommandOpen(false);
    setCommandHint(null);
    setPickerOpen(true);
    await window.coco?.setLayout("picker");
  }, []);

  const closePicker = useCallback(async () => {
    setPickerOpen(false);
    await window.coco?.setLayout("compact");
  }, []);

  const stopRecordingAndSave = useCallback(async () => {
    const currentSession = sessionRef.current;
    try {
      const blob = await recorderRef.current.stop();
      setRecording(false);
      setOrbState(currentSession ? "session" : "idle");
      showCaption("Saving recording…", 1200);

      const bytes = await blob.arrayBuffer();
      const result = await window.coco.saveRecording({
        bytes,
        sourceLabel: currentSession?.sourceLabel ?? "capture",
      });

      if (result.ok) {
        showCaption(`Saved ${result.fileName}`, 2600);
      } else {
        showCaption(result.error, 2200);
      }
    } catch (err) {
      setRecording(false);
      setOrbState(currentSession ? "session" : "idle");
      showCaption(
        err instanceof Error ? err.message : "Failed to stop recording",
        2200,
      );
    }
  }, [showCaption]);

  const startRecording = useCallback(async () => {
    const currentSession = sessionRef.current;
    if (!currentSession) {
      showCaption("Start a session first", 1800);
      return;
    }

    try {
      await recorderRef.current.start(currentSession.sourceId);
      setRecording(true);
      setOrbState("recording");
      showCaption("Recording…", 1400);
    } catch (err) {
      setRecording(false);
      setOrbState("session");
      showCaption(
        err instanceof Error
          ? err.message
          : "Could not start recording. Check Screen Recording permission.",
        2400,
      );
    }
  }, [showCaption]);

  const toggleRecording = useCallback(async () => {
    if (togglingRef.current) return;
    togglingRef.current = true;
    try {
      if (recordingRef.current || recorderRef.current.isRecording) {
        await stopRecordingAndSave();
      } else {
        await startRecording();
      }
    } finally {
      togglingRef.current = false;
    }
  }, [startRecording, stopRecordingAndSave]);

  const startSession = useCallback(
    async (source: CaptureSource) => {
      if (recordingRef.current) {
        await stopRecordingAndSave();
      }

      const next: LocalSession = {
        sourceId: source.id,
        sourceType: source.sourceType,
        sourceLabel: source.name,
        startedAt: Date.now(),
      };
      setSession(next);
      setOrbState("session");
      setPickerOpen(false);
      setCommandOpen(false);
      await window.coco?.setSession({
        sourceId: next.sourceId,
        sourceType: next.sourceType,
        sourceLabel: next.sourceLabel,
      });
      await window.coco?.setLayout("compact");
      showCaption(`Session: ${source.name}`, 2200);
      console.info("[coco] local session started", next);
    },
    [showCaption, stopRecordingAndSave],
  );

  const endSession = useCallback(async () => {
    if (!sessionRef.current && orbState === "idle") {
      showCaption("No active session");
      return;
    }

    if (recordingRef.current || recorderRef.current.isRecording) {
      await stopRecordingAndSave();
    }

    console.info("[coco] local session ended", sessionRef.current);
    setSession(null);
    void window.coco?.clearSession();
    setPickerOpen(false);
    setCommandOpen(false);
    void window.coco?.setLayout("compact");
    setOrbState("synthesizing");
    showCaption("Building your notes…", 2200);
    window.setTimeout(() => {
      setOrbState("idle");
    }, 2200);
  }, [orbState, showCaption, stopRecordingAndSave]);

  const runIntent = useCallback(
    async (intent: Intent) => {
      switch (intent) {
        case "start_recording":
          await startRecording();
          break;
        case "stop_recording":
          if (recordingRef.current || recorderRef.current.isRecording) {
            await stopRecordingAndSave();
          } else {
            showCaption("Not recording", 1600);
          }
          break;
        case "capture_screenshot":
          await window.coco.takeScreenshot();
          break;
        case "note_silent":
          await window.coco.noteSilent();
          break;
        case "explain":
          showCaption("Explain — soon (later day)", 2200);
          break;
        case "end_session":
          await endSession();
          break;
        case "unknown":
          break;
      }
    },
    [endSession, showCaption, startRecording, stopRecordingAndSave],
  );

  const handleCommandSubmit = useCallback(
    async (raw: string) => {
      const classified = classifyCommand(raw);
      console.info("[coco] local intent", classified);

      if (
        classified.intent === "unknown" ||
        (classified.confidence === "low" &&
          classified.intent !== "stop_recording")
      ) {
        await openCommandBar(
          classified.raw,
          `Not sure what “${classified.raw || "…"}” means. Try: screenshot, note this, start recording, end session.`,
        );
        return;
      }

      if (
        classified.confidence === "low" &&
        classified.intent === "stop_recording" &&
        !recordingRef.current
      ) {
        await openCommandBar(
          classified.raw,
          "Did you mean stop recording or end session? Type the full command.",
        );
        return;
      }

      await closeCommandBar();
      showCaption(intentLabel(classified.intent), 1200);
      await runIntent(classified.intent);
    },
    [closeCommandBar, openCommandBar, runIntent, showCaption],
  );

  const toggleCommandBar = useCallback(async () => {
    if (commandOpen) {
      await closeCommandBar();
      return;
    }
    await openCommandBar("");
  }, [closeCommandBar, commandOpen, openCommandBar]);

  const runPushToTalk = useCallback(async () => {
    if (pttBusyRef.current) return;
    pttBusyRef.current = true;

    try {
      if (!isSpeechRecognitionAvailable()) {
        await openCommandBar(
          "",
          "Speech unavailable here — type a command instead.",
        );
        return;
      }

      setListening(true);
      setOrbState("listening");
      showCaption("Listening…", 1200);

      try {
        const transcript = await listenOnce({ timeoutMs: 8000 });
        setListening(false);
        if (sessionRef.current || recordingRef.current) {
          setOrbState(recordingRef.current ? "recording" : "session");
        } else {
          setOrbState("idle");
        }
        showCaption(`Heard: ${transcript}`, 1600);
        await handleCommandSubmit(transcript);
      } catch (err) {
        setListening(false);
        if (sessionRef.current || recordingRef.current) {
          setOrbState(recordingRef.current ? "recording" : "session");
        } else {
          setOrbState("idle");
        }
        await openCommandBar(
          "",
          err instanceof Error ? err.message : "Try typing a command",
        );
      }
    } finally {
      pttBusyRef.current = false;
    }
  }, [handleCommandSubmit, openCommandBar, showCaption]);

  useEffect(() => {
    return () => {
      if (captionTimerRef.current !== null) {
        window.clearTimeout(captionTimerRef.current);
      }
      if (pressTimerRef.current !== null) {
        window.clearTimeout(pressTimerRef.current);
      }
      recorderRef.current.cancel();
    };
  }, []);

  useEffect(() => {
    if (!window.coco?.onScreenshotResult) return;
    return window.coco.onScreenshotResult((result) => {
      if (result.ok) showCaption(`Saved ${result.fileName}`, 2600);
      else showCaption(result.error, 2200);
    });
  }, [showCaption]);

  useEffect(() => {
    if (!window.coco?.onRecordingResult) return;
    return window.coco.onRecordingResult((result) => {
      if (!result.ok) showCaption(result.error, 2200);
    });
  }, [showCaption]);

  useEffect(() => {
    if (!window.coco?.onNoteSilentResult) return;
    return window.coco.onNoteSilentResult((result) => {
      if (result.ok) showCaption(`Note: ${result.preview}`, 2600);
      else showCaption(result.error, 2200);
    });
  }, [showCaption]);

  useEffect(() => {
    if (!window.coco?.onToggleRecording) return;
    return window.coco.onToggleRecording(() => {
      void toggleRecording();
    });
  }, [toggleRecording]);

  useEffect(() => {
    if (!window.coco?.onCommandToggle) return;
    return window.coco.onCommandToggle(() => {
      void toggleCommandBar();
    });
  }, [toggleCommandBar]);

  useEffect(() => {
    if (!window.coco?.onPtt) return;
    return window.coco.onPtt(() => {
      void runPushToTalk();
    });
  }, [runPushToTalk]);

  useEffect(() => {
    if (!window.coco?.onMenuAction) return;
    return window.coco.onMenuAction((action) => {
      switch (action) {
        case "end_session":
          void endSession();
          break;
        case "change_source":
          void openPicker();
          break;
        case "pause_capture":
          showCaption("Pause capture — soon");
          break;
        case "open_past_sessions":
          showCaption("Past sessions — soon");
          break;
        case "settings":
          showCaption("Settings — soon");
          break;
        default:
          break;
      }
    });
  }, [endSession, openPicker, showCaption]);

  const clearPressTimer = () => {
    if (pressTimerRef.current !== null) {
      window.clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
  };

  const onPointerDown = useCallback(
    async (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0 || !window.coco) return;

      event.currentTarget.setPointerCapture(event.pointerId);
      setPressed(true);
      didDragRef.current = false;
      longPressRef.current = false;
      draggingRef.current = true;
      clearPressTimer();

      pressTimerRef.current = window.setTimeout(() => {
        if (!didDragRef.current) {
          longPressRef.current = true;
          void openCommandBar("");
        }
      }, LONG_PRESS_MS);

      const bounds = await window.coco.getBounds();
      dragOffsetRef.current = {
        offsetX: event.screenX - bounds.x,
        offsetY: event.screenY - bounds.y,
        startX: event.screenX,
        startY: event.screenY,
      };
    },
    [openCommandBar],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (!draggingRef.current || !window.coco) return;

      const { offsetX, offsetY, startX, startY } = dragOffsetRef.current;
      const distance = Math.hypot(
        event.screenX - startX,
        event.screenY - startY,
      );

      if (distance >= DRAG_THRESHOLD_PX) {
        didDragRef.current = true;
        clearPressTimer();
      }

      if (!didDragRef.current) return;

      window.coco.setPosition(
        event.screenX - offsetX,
        event.screenY - offsetY,
      );
    },
    [],
  );

  const endPointer = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (!draggingRef.current) return;

      draggingRef.current = false;
      setPressed(false);
      clearPressTimer();

      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // Already released.
      }

      if (didDragRef.current) {
        window.coco?.snapToEdge();
        return;
      }

      // Long-press already opened the command bar.
      if (longPressRef.current) {
        longPressRef.current = false;
        return;
      }

      if (commandOpen) {
        void closeCommandBar();
        return;
      }

      if (pickerOpen) {
        void closePicker();
        return;
      }

      if (orbState === "idle" && !session) {
        void openPicker();
        return;
      }

      if (listening) {
        showCaption("Listening…", 1200);
        return;
      }

      if (recording) {
        showCaption("Recording… ⌘⇧R to stop", 1800);
        return;
      }

      if (session) {
        showCaption(`${session.sourceType}: ${session.sourceLabel}`, 1800);
        return;
      }

      showCaption(orbStateLabel(orbState), 1200);
    },
    [
      closeCommandBar,
      closePicker,
      commandOpen,
      listening,
      openPicker,
      orbState,
      pickerOpen,
      recording,
      session,
      showCaption,
    ],
  );

  const onContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      window.coco?.openContextMenu();
    },
    [],
  );

  const visualState: OrbState = pickerOpen
    ? "idle"
    : listening
      ? "listening"
      : recording
        ? "recording"
        : orbState === "idle" && session
          ? "session"
          : orbState;

  const showCaptionBubble =
    !commandOpen &&
    !pickerOpen &&
    (visualState === "synthesizing" || caption !== null);
  const captionText =
    visualState === "synthesizing" && !caption
      ? "Building your notes…"
      : caption;

  const shellClass = pickerOpen
    ? "shell shell--picker"
    : commandOpen
      ? "shell shell--command"
      : "shell";

  return (
    <div className={shellClass}>
      <div className="orb-wrap">
        <span className={`orb__ring orb__ring--${visualState}`} aria-hidden />
        <button
          type="button"
          className={`orb orb--${visualState}${pressed ? " orb--pressed" : ""}`}
          aria-label={`Coco orb — ${orbStateLabel(visualState)}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endPointer}
          onPointerCancel={endPointer}
          onContextMenu={onContextMenu}
        >
          <span className="orb__core" />
        </button>
        {visualState === "recording" ? (
          <span className="orb__badge" aria-hidden />
        ) : null}
      </div>

      {pickerOpen ? (
        <SourcePicker
          onSelect={startSession}
          onCancel={() => void closePicker()}
        />
      ) : commandOpen ? (
        <CommandBar
          value={commandText}
          hint={commandHint}
          onChange={setCommandText}
          onSubmit={(value) => void handleCommandSubmit(value)}
          onCancel={() => void closeCommandBar()}
        />
      ) : (
        <div
          className={`caption${showCaptionBubble && captionText ? " caption--visible" : ""}`}
          aria-live="polite"
        >
          {captionText}
        </div>
      )}
    </div>
  );
}
