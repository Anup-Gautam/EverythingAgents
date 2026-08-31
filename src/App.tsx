import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { CommandBar } from "./CommandBar";
import { playErrorChime, playSuccessChime, speakText } from "./feedback";
import { isFirebaseConfigured } from "./firebase";
import { classifyCommand, intentLabel, type Intent } from "./intents";
import { orbStateLabel, type OrbState } from "./orbStates";
import { ScreenRecorder } from "./screenRecorder";
import type { CaptureSource, LocalSession } from "./session";
import { SourcePicker } from "./SourcePicker";
import { isSpeechRecognitionAvailable, listenOnce } from "./speech";
import { recordVoiceCommand, RememberRecorder } from "./voiceCapture";

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
  const [remembering, setRemembering] = useState(false);
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
  const togglingRef = useRef(false);
  const pttBusyRef = useRef(false);
  const rememberBusyRef = useRef(false);
  const rememberRecorderRef = useRef(new RememberRecorder());
  const stopRememberRef = useRef<() => Promise<void>>(async () => {});
  const rememberingRef = useRef(false);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    recordingRef.current = recording;
    window.coco?.setRecordingState(recording);
  }, [recording]);

  useEffect(() => {
    rememberingRef.current = remembering;
  }, [remembering]);

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

  const handleSignIn = useCallback(async () => {
    if (!isFirebaseConfigured()) {
      showCaption("Fill VITE_FIREBASE_* in .env, then restart", 2800);
      return;
    }
    if (!window.coco?.signInWithGoogle) {
      showCaption("Sign-in unavailable", 1800);
      return;
    }

    showCaption("Opening browser…", 2000);
    const result = await window.coco.signInWithGoogle();
    if (!result.ok) {
      if (!result.cancelled) {
        showCaption(result.error, 3200);
      }
      return;
    }

    const label = result.session.email ?? result.session.uid;
    showCaption(`Signed in as ${label}`, 2200);
  }, [showCaption]);

  const handleSignOut = useCallback(async () => {
    try {
      await window.coco?.signOut();
      showCaption("Signed out", 1600);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      showCaption(message, 2800);
    }
  }, [showCaption]);

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
        void playSuccessChime();
        showCaption(`Saved ${result.fileName}`, 2600);
      } else {
        void playErrorChime();
        showCaption(result.error, 2200);
      }
    } catch (err) {
      setRecording(false);
      setOrbState(currentSession ? "session" : "idle");
      void playErrorChime();
      showCaption(
        err instanceof Error ? err.message : "Failed to stop recording",
        2200,
      );
    }
  }, [showCaption]);

  const startRecording = useCallback(async () => {
    const currentSession = sessionRef.current;
    if (!currentSession) {
      void playErrorChime();
      showCaption("Start a session first", 1800);
      return;
    }

    try {
      await recorderRef.current.start(currentSession.sourceId);
      setRecording(true);
      setOrbState("recording");
      void playSuccessChime();
      showCaption("Recording…", 1400);
    } catch (err) {
      setRecording(false);
      setOrbState("session");
      void playErrorChime();
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
      }).then((active) => {
        if (active?.cloudSessionId) {
          showCaption(`Session + cloud: ${source.name}`, 2200);
        } else {
          showCaption(`Session: ${source.name}`, 2200);
        }
        speakText("Session started");
      });
      await window.coco?.setLayout("compact");
      console.info("[coco] local session started", next);
    },
    [showCaption, stopRecordingAndSave],
  );

  const stopRememberAndSave = useCallback(async () => {
    if (rememberBusyRef.current) return;
    if (!rememberRecorderRef.current.active && !rememberingRef.current) {
      return;
    }

    rememberBusyRef.current = true;
    try {
      showCaption("Saving voice note…", 2000);
      const clip = await rememberRecorderRef.current.stop();
      setRemembering(false);
      await window.coco?.setLayout("compact");

      if (sessionRef.current) {
        setOrbState("session");
      } else {
        setOrbState("idle");
      }

      if (!clip) {
        void playErrorChime();
        showCaption("Heard nothing — try Remember again", 2600);
        return;
      }

      const auth = await window.coco?.getAuthSession();
      if (!auth?.idToken || !window.coco?.transcribeVoice) {
        void playErrorChime();
        showCaption("Sign in to save spoken notes", 2600);
        return;
      }

      showCaption("Transcribing…", 2000);
      const transcript = await window.coco.transcribeVoice(clip);
      if (!transcript.ok) {
        void playErrorChime();
        showCaption(transcript.error, 2800);
        return;
      }

      let text = transcript.transcript.trim();
      text = text
        .replace(/\b(stop remembering|stop remember|that's it|thats it)\s*$/i, "")
        .trim();

      if (!text) {
        void playErrorChime();
        showCaption("Heard nothing useful", 2200);
        return;
      }

      if (!window.coco?.saveNoteText) {
        void playErrorChime();
        showCaption("Could not save note", 2200);
        return;
      }

      const saved = await window.coco.saveNoteText(text);
      if (saved.ok) {
        void playSuccessChime();
        showCaption(`Remembered: ${saved.preview}`, 3600);
      } else {
        void playErrorChime();
        showCaption(saved.error, 2800);
      }
    } catch (err) {
      setRemembering(false);
      await window.coco?.setLayout("compact");
      if (sessionRef.current) setOrbState("session");
      else setOrbState("idle");
      void playErrorChime();
      showCaption(
        err instanceof Error ? err.message : "Could not save voice note",
        2800,
      );
    } finally {
      rememberBusyRef.current = false;
    }
  }, [showCaption]);

  useEffect(() => {
    stopRememberRef.current = stopRememberAndSave;
  }, [stopRememberAndSave]);

  const startRemember = useCallback(async () => {
    if (!sessionRef.current) {
      showCaption("Start a session first", 1800);
      return;
    }
    if (rememberingRef.current || rememberRecorderRef.current.active) {
      showCaption("Already remembering — click the mic to stop", 2600);
      return;
    }
    // Don't block on PTT flags — voice "remember" runs inside PTT completion.
    if (recordingRef.current) {
      showCaption("Stop screen recording first", 2000);
      return;
    }

    rememberBusyRef.current = true;
    try {
      setCommandOpen(false);
      setPickerOpen(false);
      await rememberRecorderRef.current.start({
        maxMs: 90_000,
        onMaxDuration: () => {
          void stopRememberRef.current();
        },
      });
      setRemembering(true);
      setOrbState("listening");
      await window.coco?.setLayout("remember");
      showCaption("Remembering… click the mic to stop", 3200);
    } catch (err) {
      setRemembering(false);
      await window.coco?.setLayout("compact");
      setOrbState("session");
      void playErrorChime();
      showCaption(
        err instanceof Error ? err.message : "Could not open mic",
        2600,
      );
    } finally {
      rememberBusyRef.current = false;
    }
  }, [showCaption]);

  const endSession = useCallback(async () => {
    if (!sessionRef.current && orbState === "idle") {
      showCaption("No active session");
      return;
    }

    if (rememberingRef.current || rememberRecorderRef.current.active) {
      await stopRememberAndSave();
    }

    if (recordingRef.current || recorderRef.current.isRecording) {
      await stopRecordingAndSave();
    }

    console.info("[coco] local session ending", sessionRef.current);
    setPickerOpen(false);
    setCommandOpen(false);
    void window.coco?.setLayout("compact");
    setOrbState("synthesizing");
    showCaption("Building your notes…", 8000);

    const result = await window.coco?.endSession?.();
    setSession(null);

    if (result?.ok) {
      showCaption(`Notes ready · ${result.fileName}`, 4200);
      void speakText("Your notes are ready");
      console.info("[coco] notes ready", result);
    } else {
      void playErrorChime();
      showCaption(result?.error || "Could not build notes", 3200);
      void window.coco?.clearSession();
    }

    window.setTimeout(() => {
      setOrbState("idle");
    }, 2200);
  }, [orbState, showCaption, stopRecordingAndSave, stopRememberAndSave]);

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
        case "remember":
          await startRemember();
          break;
        case "explain": {
          setOrbState("thinking");
          showCaption("Explaining…", 1800);
          const result = await window.coco.explain();
          if (sessionRef.current || recordingRef.current) {
            setOrbState(recordingRef.current ? "recording" : "session");
          } else {
            setOrbState("idle");
          }
          if (result.ok) {
            showCaption(result.preview || result.answer, 5200);
            speakText(result.answer);
            console.info("[coco] explain", {
              model: result.model,
              answer: result.answer,
            });
          } else {
            void playErrorChime();
            showCaption(result.error, 2800);
          }
          break;
        }
        case "end_session":
          await endSession();
          break;
        case "unknown":
          break;
      }
    },
    [
      endSession,
      showCaption,
      startRecording,
      startRemember,
      stopRecordingAndSave,
    ],
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
          `Not sure what “${classified.raw || "…"}” means. Try: screenshot, note this, remember, start recording, end session.`,
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
    if (rememberingRef.current || rememberRecorderRef.current.active) {
      showCaption("Click the mic to finish Remember", 2200);
      return;
    }
    pttBusyRef.current = true;

    const restoreOrb = () => {
      if (sessionRef.current || recordingRef.current) {
        setOrbState(recordingRef.current ? "recording" : "session");
      } else {
        setOrbState("idle");
      }
    };

    try {
      const auth = await window.coco?.getAuthSession();
      setListening(true);
      setOrbState("listening");
      showCaption(
        auth?.idToken ? "Listening… speak a command" : "Listening…",
        1600,
      );

      let transcript = "";

      if (auth?.idToken && window.coco?.transcribeVoice) {
        try {
          const clip = await recordVoiceCommand({ durationMs: 4500 });
          showCaption("Transcribing…", 1600);
          const result = await window.coco.transcribeVoice(clip);
          if (!result.ok) {
            throw new Error(result.error);
          }
          transcript = result.transcript;
          console.info("[coco] voice transcript", {
            model: result.model,
            transcript,
          });
        } catch (err) {
          setListening(false);
          restoreOrb();
          void playErrorChime();
          await openCommandBar(
            "",
            err instanceof Error
              ? err.message
              : "Voice failed — type a command",
          );
          return;
        }
      } else if (isSpeechRecognitionAvailable()) {
        try {
          transcript = await listenOnce({ timeoutMs: 8000 });
        } catch (err) {
          setListening(false);
          restoreOrb();
          await openCommandBar(
            "",
            err instanceof Error
              ? `${err.message} (sign in for better voice)`
              : "Try typing a command",
          );
          return;
        }
      } else {
        setListening(false);
        restoreOrb();
        await openCommandBar(
          "",
          "Sign in for Gemini voice commands, or type instead.",
        );
        return;
      }

      setListening(false);
      restoreOrb();
      showCaption(`Heard: ${transcript}`, 1600);
      // Release PTT lock before intents that need the mic (Remember).
      pttBusyRef.current = false;
      await handleCommandSubmit(transcript);
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
      void rememberRecorderRef.current.cancel();
    };
  }, []);

  useEffect(() => {
    if (!window.coco?.onScreenshotResult) return;
    return window.coco.onScreenshotResult((result) => {
      if (!result.ok) {
        void playErrorChime();
        showCaption(result.error, 2200);
        return;
      }
      void playSuccessChime();
      if (result.label) {
        showCaption(result.label, 3200);
      } else if (result.cloudUploaded) {
        showCaption(`Saved + uploaded ${result.fileName}`, 2800);
      } else if (result.cloudError) {
        showCaption(`Saved locally (cloud: ${result.cloudError})`, 3200);
      } else {
        showCaption(`Saved ${result.fileName}`, 2600);
      }
    });
  }, [showCaption]);

  useEffect(() => {
    if (!window.coco?.onRecordingResult) return;
    return window.coco.onRecordingResult((result) => {
      if (!result.ok) {
        void playErrorChime();
        showCaption(result.error, 2200);
        return;
      }
      void playSuccessChime();
      if (result.label) {
        showCaption(result.label, 3200);
      } else {
        showCaption(`Recording saved · ${result.fileName}`, 2600);
      }
    });
  }, [showCaption]);

  useEffect(() => {
    if (!window.coco?.onNoteSilentResult) return;
    return window.coco.onNoteSilentResult((result) => {
      if (result.ok) {
        void playSuccessChime();
        showCaption(`Note: ${result.preview}`, 2600);
      } else {
        void playErrorChime();
        showCaption(result.error, 2200);
      }
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
    if (!window.coco?.onRemember) return;
    return window.coco.onRemember(() => {
      if (rememberingRef.current || rememberRecorderRef.current.active) {
        void stopRememberAndSave();
      } else {
        void startRemember();
      }
    });
  }, [startRemember, stopRememberAndSave]);

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
        case "sign_in":
          void handleSignIn();
          break;
        case "sign_out":
          void handleSignOut();
          break;
        default:
          break;
      }
    });
  }, [endSession, handleSignIn, handleSignOut, openPicker]);

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

      if (remembering) {
        showCaption("Remembering… click the mic to stop", 2000);
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
      remembering,
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
    : remembering
      ? "listening"
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
      : remembering
        ? "shell shell--remember"
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

        {remembering ? (
          <button
            type="button"
            className="remember-mic remember-mic--active"
            aria-label="Stop remembering and save note"
            title="Click to stop and save"
            onClick={(event) => {
              event.stopPropagation();
              void stopRememberAndSave();
            }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <svg
              className="remember-mic__icon"
              viewBox="0 0 24 24"
              aria-hidden
            >
              <path
                fill="currentColor"
                d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z"
              />
            </svg>
            <span className="remember-mic__pulse" aria-hidden />
          </button>
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
