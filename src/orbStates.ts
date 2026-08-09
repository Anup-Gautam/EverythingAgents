export const ORB_STATES = [
  "idle",
  "session",
  "listening",
  "recording",
  "thinking",
  "synthesizing",
] as const;

export type OrbState = (typeof ORB_STATES)[number];

export function orbStateLabel(state: OrbState): string {
  switch (state) {
    case "idle":
      return "Idle";
    case "session":
      return "Session active";
    case "listening":
      return "Listening";
    case "recording":
      return "Recording";
    case "thinking":
      return "Thinking";
    case "synthesizing":
      return "Building your notes…";
  }
}
