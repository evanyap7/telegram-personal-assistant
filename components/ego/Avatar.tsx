"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { AVATAR_FRAMES, AVATAR_REGIONS, type AvatarFrameName, type Rect } from "@/lib/app/avatar-layout";
import { mouthForLevel, type AvatarState, type Mood, type Mouth } from "@/lib/app/avatar-state";
import { LayerStack } from "./layerStack";

const MOODS: Mood[] = ["neutral", "warm", "focused", "concerned"];
const SHAPES = ["small", "open", "wide"] as const;
type Shape = (typeof SHAPES)[number];

const MOOD_MS = 170;
const MOUTH_MS = 85;
const BLINK_MS = 70;
const BLINK_HOLD_MS = 90;
const MOUTH_MIN_HOLD_MS = 110;
const HYSTERESIS = 0.025;
const ATTACK_MS = 45;
const RELEASE_MS = 150;

const RANK: Record<Mouth, number> = { closed: 0, small: 1, open: 2, wide: 3 };
const BY_RANK: Mouth[] = ["closed", "small", "open", "wide"];

const STATUS: Record<AvatarState["activity"], string> = {
  idle: "Ready",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
};

/** Plausible speech envelope for when no audio analyser feeds the avatar. */
function simulatedLevel(tSec: number): number {
  const phrase = Math.sin(2 * Math.PI * 0.45 * tSec) > -0.55 ? 1 : 0.05;
  const syllable = Math.abs(Math.sin(2 * Math.PI * 1.6 * tSec + 0.6 * Math.sin(tSec * 1.7)));
  const emphasis = 0.7 + 0.3 * Math.sin(2 * Math.PI * 0.31 * tSec);
  return phrase * (0.08 + 0.55 * syllable) * emphasis;
}

const FEATHER = "radial-gradient(ellipse 50% 50% at 50% 50%, #000 62%, transparent 100%)";

function MoodLayer({ mood, stack }: { mood: Mood; stack: LayerStack }) {
  const setRef = useCallback((el: HTMLImageElement | null) => stack.register(mood, el), [stack, mood]);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={setRef}
      className="ego-base"
      src={AVATAR_FRAMES[mood]}
      alt=""
      draggable={false}
      style={{ opacity: mood === "neutral" ? 1 : 0 }}
    />
  );
}

function RegionLayer({ layer, frame, rect, stack }: { layer: string; frame: AvatarFrameName; rect: Rect; stack: LayerStack }) {
  const src = AVATAR_FRAMES[frame];
  const setRef = useCallback((el: HTMLDivElement | null) => stack.register(layer, el), [stack, layer]);
  const feather = FEATHER;
  return (
    <div
      ref={setRef}
      className="ego-region"
      style={{
        left: `${rect.x * 100}%`,
        top: `${rect.y * 100}%`,
        width: `${rect.w * 100}%`,
        height: `${rect.h * 100}%`,
        opacity: 0,
        maskImage: feather,
        WebkitMaskImage: feather,
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        draggable={false}
        style={{
          width: `${100 / rect.w}%`,
          height: `${100 / rect.h}%`,
          left: `${(-rect.x / rect.w) * 100}%`,
          top: `${(-rect.y / rect.h) * 100}%`,
        }}
      />
    </div>
  );
}

/**
 * EGO's face. Layers: a full base frame per mood, a blink layer cropped to the eye region
 * and mouth-shape layers cropped to the mouth region, each with a feathered edge. All are
 * mounted for good and only opacity changes (see LayerStack), so state changes never flash.
 * The mouth follows `levelRef` (0..1, e.g. from a Web Audio analyser) through exponential
 * smoothing, hysteresis and a minimum hold per shape; without it, a simulated envelope runs
 * while speaking.
 */
export default function Avatar({
  state,
  levelRef,
  onTap,
}: {
  state: AvatarState;
  levelRef?: RefObject<number | null>;
  /** Tapping the face; the app uses it to interrupt speech. */
  onTap?: () => void;
}) {
  const [moodStack] = useState(() => new LayerStack(MOODS, MOOD_MS, "neutral"));
  const [eyeStack] = useState(() => new LayerStack(["blink"], BLINK_MS, null, 10));
  const [mouthStack] = useState(() => new LayerStack(SHAPES, MOUTH_MS, null, 10));

  const speakingRef = useRef(false);
  const levelSourceRef = useRef<RefObject<number | null> | undefined>(levelRef);

  useEffect(() => {
    speakingRef.current = state.activity === "speaking";
    levelSourceRef.current = levelRef;
  }, [state.activity, levelRef]);

  useEffect(() => {
    moodStack.setTarget(state.mood);
  }, [moodStack, state.mood]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => {
      moodStack.setDuration(mq.matches ? 0 : MOOD_MS);
      eyeStack.setDuration(mq.matches ? 0 : BLINK_MS);
      mouthStack.setDuration(mq.matches ? 0 : MOUTH_MS);
    };
    apply();
    mq.addEventListener("change", apply);

    // Blinks every 3 to 6 seconds, never while reduced motion is requested.
    let blinkTimer: ReturnType<typeof setTimeout>;
    let openTimer: ReturnType<typeof setTimeout>;
    const scheduleBlink = () => {
      blinkTimer = setTimeout(() => {
        if (!mq.matches) {
          eyeStack.setTarget("blink");
          openTimer = setTimeout(() => eyeStack.setTarget(null), BLINK_HOLD_MS);
        }
        scheduleBlink();
      }, 3000 + Math.random() * 3000);
    };
    scheduleBlink();

    let raf = 0;
    let last = performance.now();
    let smoothed = 0;
    let current: Mouth = "closed";
    let changedAt = 0;
    const loop = (now: number) => {
      const dt = Math.max(0, Math.min(64, now - last));
      last = now;

      const speaking = speakingRef.current;
      let target = 0;
      if (speaking) {
        const external = levelSourceRef.current?.current;
        target = typeof external === "number" && Number.isFinite(external) ? external : simulatedLevel(now / 1000);
      }
      const tau = target > smoothed ? ATTACK_MS : RELEASE_MS;
      smoothed += (target - smoothed) * (1 - Math.exp(-dt / tau));

      // Hysteresis: moving up needs the level to clear the threshold by a margin, moving
      // down needs it to fall below by a margin. Minimum hold, then one shape at a time.
      let wanted = current;
      if (speaking) {
        const up = mouthForLevel(smoothed - HYSTERESIS);
        const down = mouthForLevel(smoothed + HYSTERESIS);
        if (RANK[up] > RANK[current]) wanted = BY_RANK[RANK[current] + 1];
        else if (RANK[down] < RANK[current]) wanted = BY_RANK[RANK[current] - 1];
      } else {
        wanted = "closed";
      }
      if (wanted !== current && (!speaking || now - changedAt >= MOUTH_MIN_HOLD_MS)) {
        current = wanted;
        changedAt = now;
        mouthStack.setTarget(current === "closed" ? null : (current as Shape));
      }

      moodStack.tick(dt);
      eyeStack.tick(dt);
      mouthStack.tick(dt);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(blinkTimer);
      clearTimeout(openTimer);
      mq.removeEventListener("change", apply);
    };
  }, [moodStack, eyeStack, mouthStack]);

  return (
    <section className="ego-stage" aria-label="EGO" onClick={onTap}>
      <div className="ego-frame">
        <div className="ego-breathe">
          {MOODS.map((m) => (
            <MoodLayer key={m} mood={m} stack={moodStack} />
          ))}
          <RegionLayer layer="blink" frame="blink" rect={AVATAR_REGIONS.eyes} stack={eyeStack} />
          {SHAPES.map((s) => (
            <RegionLayer key={s} layer={s} frame={`mouth-${s}`} rect={AVATAR_REGIONS.mouth} stack={mouthStack} />
          ))}
        </div>
      </div>
      <div className="ego-name">EGO</div>
      <div className={`ego-status s-${state.activity}`} role="status" aria-live="polite">
        <span className="ego-dot" aria-hidden="true" />
        <span>{STATUS[state.activity]}</span>
      </div>
    </section>
  );
}
