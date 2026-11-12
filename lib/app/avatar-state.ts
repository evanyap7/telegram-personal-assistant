/** Pure avatar state machine. The UI feeds events in and renders the resulting state. */

export type Activity = "idle" | "listening" | "thinking" | "speaking";
export type Mood = "neutral" | "warm" | "focused" | "concerned";
export type Mouth = "closed" | "small" | "open" | "wide";

export interface AvatarState {
  activity: Activity;
  mood: Mood;
  blinking: boolean;
  mouth: Mouth;
}

export type AvatarEvent =
  | { type: "listen_start" }
  | { type: "listen_end" }
  | { type: "request_sent" }
  | { type: "turn_done"; status?: string }
  | { type: "turn_error" }
  | { type: "speech_start" }
  | { type: "speech_end" }
  | { type: "speech_interrupted" }
  | { type: "level"; value: number }
  | { type: "blink"; on: boolean }
  | { type: "mood_decay" };

export const initialAvatarState: AvatarState = {
  activity: "idle",
  mood: "neutral",
  blinking: false,
  mouth: "closed",
};

const FAILURE_STATUS = /(_failed|_not_found|_empty)$/;

/** Maps a 0..1 audio level to a mouth shape. NaN and negatives are closed; above 1 is wide. */
export function mouthForLevel(level: number): Mouth {
  if (!(level >= 0.05)) return "closed";
  if (level < 0.2) return "small";
  if (level < 0.45) return "open";
  return "wide";
}

function next(state: AvatarState, patch: Partial<AvatarState>): AvatarState {
  const changed = (Object.keys(patch) as (keyof AvatarState)[]).some((k) => state[k] !== patch[k]);
  return changed ? { ...state, ...patch } : state;
}

/** Returns the same object reference when the event changes nothing. Never throws. */
export function reduceAvatar(state: AvatarState, event: AvatarEvent): AvatarState {
  switch (event.type) {
    case "listen_start":
      return next(state, { activity: "listening", mouth: "closed" });
    case "listen_end":
      return state.activity === "listening" ? next(state, { activity: "idle" }) : state;
    case "request_sent":
      return next(state, { activity: "thinking", mood: "focused", mouth: "closed" });
    case "turn_done":
      return next(state, {
        mood: event.status && FAILURE_STATUS.test(event.status) ? "concerned" : "warm",
      });
    case "turn_error":
      return next(state, { activity: "idle", mood: "concerned", mouth: "closed" });
    case "speech_start":
      return next(state, { activity: "speaking" });
    case "speech_end":
    case "speech_interrupted":
      return state.activity === "speaking" || state.mouth !== "closed"
        ? next(state, { activity: "idle", mouth: "closed" })
        : state;
    case "level":
      return next(state, { mouth: state.activity === "speaking" ? mouthForLevel(event.value) : "closed" });
    case "blink":
      return next(state, { blinking: event.on });
    case "mood_decay":
      return state.mood === "warm" || state.mood === "concerned" ? next(state, { mood: "neutral" }) : state;
    default:
      return state;
  }
}
