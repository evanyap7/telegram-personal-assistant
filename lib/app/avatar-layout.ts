/**
 * Avatar frame files and the regions that change between them.
 * Provenance and prompts: docs/avatar/shot-list.md. Full-resolution PNG sources are in docs/avatar/source (1536x1536); the app serves 768px webp copies. All frames share
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
  neutral: "/avatar/neutral.webp",
  warm: "/avatar/warm.webp",
  focused: "/avatar/focused.webp",
  concerned: "/avatar/concerned.webp",
  blink: "/avatar/blink.webp",
  "mouth-closed": "/avatar/mouth-closed.webp",
  "mouth-small": "/avatar/mouth-small.webp",
  "mouth-open": "/avatar/mouth-open.webp",
  "mouth-wide": "/avatar/mouth-wide.webp",
};

/** Estimated from the generated frames; generous so a layered renderer can feather the edges. */
export const AVATAR_REGIONS: { eyes: Rect; mouth: Rect } = {
  eyes: { x: 0.28, y: 0.25, w: 0.44, h: 0.13 },
  mouth: { x: 0.35, y: 0.4, w: 0.3, h: 0.17 },
};
