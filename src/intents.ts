/** Local Day-7 intent stubs — keyword matching only (no Gemini). */

export type Intent =
  | "start_recording"
  | "stop_recording"
  | "capture_screenshot"
  | "note_silent"
  | "explain"
  | "end_session"
  | "unknown";

export type ClassifiedCommand = {
  intent: Intent;
  confidence: "high" | "low";
  raw: string;
};

export function classifyCommand(input: string): ClassifiedCommand {
  const raw = input.trim();
  const text = raw.toLowerCase().replace(/\s+/g, " ");

  if (!text) {
    return { intent: "unknown", confidence: "low", raw };
  }

  if (
    /\b(stop recording|stop record|end recording|finish recording)\b/.test(text)
  ) {
    return { intent: "stop_recording", confidence: "high", raw };
  }

  if (
    /\b(start recording|start record|begin recording)\b/.test(text) ||
    /\brecord (this|screen|window)\b/.test(text) ||
    text === "record"
  ) {
    return { intent: "start_recording", confidence: "high", raw };
  }

  if (
    /\b(screenshot|screen shot|take a (screen ?)?shot|capture( this)?|snap( this)?)\b/.test(
      text,
    ) ||
    text === "shot"
  ) {
    return { intent: "capture_screenshot", confidence: "high", raw };
  }

  if (
    /\b(note this|note that|save (this )?note|annotate)\b/.test(text) ||
    text === "note"
  ) {
    return { intent: "note_silent", confidence: "high", raw };
  }

  if (
    /\b(what does this mean|explain( this)?|what is this|eli5)\b/.test(text)
  ) {
    return { intent: "explain", confidence: "high", raw };
  }

  if (
    /\b(end session|stop session|finish session|close session)\b/.test(text) ||
    text === "done"
  ) {
    return { intent: "end_session", confidence: "high", raw };
  }

  // Ambiguous single tokens — ask for confirmation via command bar.
  if (text === "stop") {
    return { intent: "stop_recording", confidence: "low", raw };
  }

  return { intent: "unknown", confidence: "low", raw };
}

export function intentLabel(intent: Intent): string {
  switch (intent) {
    case "start_recording":
      return "Start recording";
    case "stop_recording":
      return "Stop recording";
    case "capture_screenshot":
      return "Screenshot";
    case "note_silent":
      return "Note this";
    case "explain":
      return "Explain";
    case "end_session":
      return "End session";
    case "unknown":
      return "Unknown";
  }
}
