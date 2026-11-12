// Pure PCM helpers for hold-to-talk. Shared by the browser (downsample, encodeWav) and the
// voice route (parseWav), and free of any Web Audio or Node API so both can load it.

/** Largest accepted voice upload. 60 s of 16 kHz 16-bit mono is about 1.9 MB. */
export const VOICE_MAX_BYTES = 4_000_000;
/** Shortest accepted clip at 16 kHz: 0.3 s. */
export const VOICE_MIN_SAMPLES_16K = 4_800;
export const VOICE_SAMPLE_RATE = 16_000;

/**
 * Resamples mono samples down from `fromRate` to `toRate` by averaging each output
 * sample's source window (a box filter, enough to avoid aliasing speech). An equal rate
 * returns the input unchanged.
 */
export function downsample(samples: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (!(fromRate > 0) || !(toRate > 0)) throw new RangeError("Sample rates must be positive");
  if (toRate === fromRate) return samples;
  const ratio = fromRate / toRate;
  const length = Math.floor(samples.length / ratio);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(samples.length, Math.max(start + 1, Math.floor((i + 1) * ratio)));
    let sum = 0;
    for (let j = start; j < end; j++) sum += samples[j];
    out[i] = sum / (end - start);
  }
  return out;
}

const HEADER_BYTES = 44;

/** Encodes mono float samples (-1..1) as a 16-bit PCM WAV: 44-byte header plus data. */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const dataBytes = samples.length * 2;
  const out = new Uint8Array(HEADER_BYTES + dataBytes);
  const view = new DataView(out.buffer);
  const ascii = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) out[offset + i] = s.charCodeAt(i);
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  ascii(36, "data");
  view.setUint32(40, dataBytes, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(HEADER_BYTES + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return out;
}

export interface WavInfo {
  sampleRate: number;
  /** Samples in the data chunk (the bytes actually present, if the header overstates). */
  samples: number;
}

/**
 * Validates a RIFF/WAVE file as 16-bit mono PCM and returns its rate and sample count,
 * or null if it is anything else (including a truncated header or missing chunks).
 */
export function parseWav(bytes: Uint8Array): WavInfo | null {
  if (bytes.length < HEADER_BYTES) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o: number) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") return null;

  let format: { sampleRate: number } | null = null;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const id = tag(offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === "fmt ") {
      if (size < 16 || body + 16 > bytes.length) return null;
      const audioFormat = view.getUint16(body, true);
      const channels = view.getUint16(body + 2, true);
      const sampleRate = view.getUint32(body + 4, true);
      const bits = view.getUint16(body + 14, true);
      if (audioFormat !== 1 || channels !== 1 || bits !== 16) return null;
      if (sampleRate < 8_000 || sampleRate > 48_000) return null;
      format = { sampleRate };
    } else if (id === "data") {
      if (!format) return null;
      const available = Math.min(size, bytes.length - body);
      return { sampleRate: format.sampleRate, samples: Math.floor(available / 2) };
    }
    offset = body + size + (size % 2);
  }
  return null;
}

/** The clip length expressed in 16 kHz samples, for comparing against the minimum. */
export function samplesAt16k(info: WavInfo): number {
  return Math.floor((info.samples * VOICE_SAMPLE_RATE) / info.sampleRate);
}
