/**
 * Avatar frame files and the regions that change between them.
 * Provenance and prompts: docs/avatar/shot-list.md. All frames are 1536x1536 and share
 * framing, so a renderer can either crossfade whole frames (default, drift-proof) or swap
 * just the eye and mouth regions over a base portrait.
 */

export type AvatarFrameName =
  | "neutral"
  | "warm"
  | "focused"
  | "concerned"
  | "blink"
  | "mouth-closed"
  | "mouth-small"
  | "mouth-open"
  | "mouth-wide";

/** A rectangle as fractions (0..1) of the frame width and height. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const AVATAR_FRAMES: Record<AvatarFrameName, string> = {
  neutral: "/avatar/neutral.png",
  warm: "/avatar/warm.png",
  focused: "/avatar/focused.png",
  concerned: "/avatar/concerned.png",
  blink: "/avatar/blink.png",
  "mouth-closed": "/avatar/mouth-closed.png",
  "mouth-small": "/avatar/mouth-small.png",
  "mouth-open": "/avatar/mouth-open.png",
  "mouth-wide": "/avatar/mouth-wide.png",
};

/** Estimated from the generated frames; generous so a layered renderer can feather the edges. */
export const AVATAR_REGIONS: { eyes: Rect; mouth: Rect } = {
  eyes: { x: 0.28, y: 0.25, w: 0.44, h: 0.13 },
  mouth: { x: 0.35, y: 0.4, w: 0.3, h: 0.17 },
};
