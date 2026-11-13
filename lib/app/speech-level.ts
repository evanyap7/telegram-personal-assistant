/**
 * Turns raw output RMS into the avatar's 0..1 mouth level. A fixed gain saturates on loud
 * synthesized speech and pins the mouth wide open, so the level is scaled against the
 * recent loudest sound instead: syllables and pauses then move the mouth whatever the volume.
 */

/** Per-tick decay of the tracked peak: at 30 Hz the peak halves in about 1.5 s. */
const PEAK_DECAY = 0.985;
/** Below this RMS the signal is silence or hiss and must not set the scale. */
const FLOOR = 0.01;
/** Above 1, dips below the peak are deepened so quiet syllables read as a smaller mouth. */
const CURVE = 1.4;

export interface LevelNormalizer {
  (rms: number): number;
  reset(): void;
}

export function createLevelNormalizer(): LevelNormalizer {
  let peak = 0;
  const fn = ((rms: number) => {
    if (!(rms > FLOOR)) {
      peak *= PEAK_DECAY;
      return 0;
    }
    peak = Math.max(rms, peak * PEAK_DECAY);
    return Math.min(1, Math.pow(rms / peak, CURVE));
  }) as LevelNormalizer;
  fn.reset = () => {
    peak = 0;
  };
  return fn;
}
