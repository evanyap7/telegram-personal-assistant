/**
 * Offline tests for hold-to-talk voice input: PCM helpers (downsample, encodeWav, parseWav)
 * and the voice endpoint's validation and short-audio / empty-transcript paths. The model
 * call and the EGO turn are fakes: no model, Sheets or Telegram call is made.
 *
 * Usage:
 *   node --experimental-strip-types --import ./scripts/bench/register.mjs scripts/test-app-audio.ts
 */

import {
  VOICE_MAX_BYTES,
  VOICE_MIN_SAMPLES_16K,
  downsample,
  encodeWav,
  parseWav,
  samplesAt16k,
} from "../lib/app/audio";
import { SESSION_COOKIE, signSession } from "../lib/app/auth";
import type { AppEvent } from "../lib/app/events";
import { VOICE_LIMIT_PER_MIN, resetRateLimits } from "../lib/app/rate-limit";
import { NOTHING_HEARD, handleVoicePost, type VoiceDeps } from "../lib/app/voice";

let passed = 0;
let failed = 0;
function assert(condition: boolean, name: string, detail?: unknown) {
  if (condition) {
    console.log(`  ✅ PASS: ${name}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${name}`, detail === undefined ? "" : JSON.stringify(detail));
    failed++;
  }
}

const SECRET = "s".repeat(40);
const HOST = "ego.example.com";
const ORIGIN = `https://${HOST}`;
const REQUEST_ID = "3f2b6c1e-7a4d-4e8b-9c0f-1a2b3c4d5e6f";

function tone(n: number): Float32Array {
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = Math.sin(i / 10) * 0.5;
  return a;
}

function testHelpers() {
  const wav = encodeWav(tone(100), 16000);
  const text = (o: number, n: number) => String.fromCharCode(...wav.slice(o, o + n));
  assert(text(0, 4) === "RIFF" && text(8, 4) === "WAVE", "encodeWav starts with RIFF/WAVE");
  assert(wav.length === 44 + 200, "encodeWav has a 44-byte header plus 2 bytes per sample");
  const view = new DataView(wav.buffer);
  assert(text(36, 4) === "data" && view.getUint32(40, true) === 200, "data chunk length is 2 * samples");
  assert(view.getUint16(22, true) === 1 && view.getUint16(34, true) === 16, "mono, 16-bit");
  assert(view.getUint32(24, true) === 16000, "sample rate in header");
  const clipped = encodeWav(new Float32Array([2, -2, 0]), 16000);
  const cv = new DataView(clipped.buffer);
  assert(cv.getInt16(44, true) === 32767 && cv.getInt16(46, true) === -32768 && cv.getInt16(48, true) === 0, "samples clip to int16 range");

  assert(downsample(tone(48000), 48000, 16000).length === 16000, "downsample 48k -> 16k has one third the length");
  const same = tone(10);
  assert(downsample(same, 16000, 16000) === same, "downsample at equal rate returns the same samples");
  const avg = downsample(new Float32Array([1, 1, 1, 0, 0, 0]), 48000, 16000);
  assert(avg.length === 2 && avg[0] === 1 && avg[1] === 0, "downsample averages each window");
  assert(downsample(tone(44100), 44100, 16000).length === Math.floor(44100 / (44100 / 16000)), "non-integer ratio length");

  const info = parseWav(wav);
  assert(info?.sampleRate === 16000 && info.samples === 100, "parseWav reads rate and sample count", info);
  assert(parseWav(new Uint8Array(10)) === null, "parseWav rejects a short buffer");
  const notWav = wav.slice();
  notWav[0] = 0x58;
  assert(parseWav(notWav) === null, "parseWav rejects a bad RIFF tag");
  const stereo = wav.slice();
  new DataView(stereo.buffer).setUint16(22, 2, true);
  assert(parseWav(stereo) === null, "parseWav rejects stereo");
  const eightBit = wav.slice();
  new DataView(eightBit.buffer).setUint16(34, 8, true);
  assert(parseWav(eightBit) === null, "parseWav rejects non-16-bit");
  const lying = wav.slice();
  new DataView(lying.buffer).setUint32(40, 1_000_000, true);
  assert(parseWav(lying)?.samples === 100, "parseWav clamps a data length larger than the file");
  assert(samplesAt16k({ sampleRate: 48000, samples: 48000 }) === 16000, "samplesAt16k normalizes the rate");
}

interface Calls {
  transcribed: number;
  turns: { text: string; requestId: string }[];
  kept: number;
}

function deps(transcript: string | Error, calls: Calls): VoiceDeps {
  return {
    async transcribe() {
      calls.transcribed++;
      if (transcript instanceof Error) throw transcript;
      return transcript;
    },
    async runTurn(input, emit) {
      calls.turns.push(input);
      emit({ type: "message", id: 1, text: "ok" });
      emit({ type: "done" });
    },
    keepAlive: () => {
      calls.kept++;
    },
  };
}

function freshCalls(): Calls {
  return { transcribed: 0, turns: [], kept: 0 };
}

function voiceRequest(opts: {
  cookie?: string | null;
  origin?: string | null;
  audio?: Uint8Array | null;
  requestId?: string | null;
  contentLength?: string;
  raw?: { body: Uint8Array; contentType: string };
}): Request {
  const headers: Record<string, string> = { host: HOST };
  const cookie = opts.cookie === undefined ? `${SESSION_COOKIE}=${signSession(SECRET, Date.now())}` : opts.cookie;
  if (cookie) headers.cookie = cookie;
  const origin = opts.origin === undefined ? ORIGIN : opts.origin;
  if (origin) headers.origin = origin;
  if (opts.contentLength) headers["content-length"] = opts.contentLength;
  if (opts.raw) {
    headers["content-type"] = opts.raw.contentType;
    return new Request(`${ORIGIN}/api/ego/voice`, { method: "POST", headers, body: opts.raw.body as BodyInit });
  }
  const form = new FormData();
  if (opts.audio !== null) {
    form.append("audio", new Blob([(opts.audio ?? encodeWav(tone(VOICE_MIN_SAMPLES_16K + 100), 16000)) as BlobPart], { type: "audio/wav" }), "voice.wav");
  }
  if (opts.requestId !== null) form.append("requestId", opts.requestId ?? REQUEST_ID);
  // Serialize the multipart body ourselves so content-type carries the boundary.
  return new Request(`${ORIGIN}/api/ego/voice`, { method: "POST", headers, body: form });
}

async function frames(res: Response): Promise<AppEvent[]> {
  return (await res.text())
    .split("\n\n")
    .map((f) => f.trim())
    .filter((f) => f.startsWith("data:"))
    .map((f) => JSON.parse(f.slice(5)) as AppEvent);
}

async function testRoute() {
  // Route module config.
  const route = await import("../app/api/ego/voice/route");
  assert(route.runtime === "nodejs" && route.maxDuration === 120, "route: nodejs runtime, maxDuration 120");

  let c = freshCalls();
  resetRateLimits();
  assert((await handleVoicePost(voiceRequest({ cookie: null }), deps("hi", c))).status === 401, "no cookie -> 401");
  assert((await handleVoicePost(voiceRequest({ cookie: `${SESSION_COOKIE}=garbage` }), deps("hi", c))).status === 401, "bad cookie -> 401");
  assert((await handleVoicePost(voiceRequest({ origin: "https://evil.example.com" }), deps("hi", c))).status === 403, "wrong Origin -> 403");
  assert(c.transcribed === 0 && c.kept === 0, "rejected requests never transcribe");

  const json = new Request(`${ORIGIN}/api/ego/voice`, {
    method: "POST",
    headers: { host: HOST, origin: ORIGIN, "content-type": "application/json", cookie: `${SESSION_COOKIE}=${signSession(SECRET, Date.now())}` },
    body: "{}",
  });
  assert((await handleVoicePost(json, deps("hi", c))).status === 415, "non-multipart -> 415");

  // Size caps: declared and streamed, before any buffering into form data.
  const big = new Uint8Array(VOICE_MAX_BYTES + 1);
  assert(
    (await handleVoicePost(voiceRequest({ audio: big }), deps("hi", c))).status === 413,
    "audio above VOICE_MAX_BYTES -> 413"
  );
  assert(
    (await handleVoicePost(voiceRequest({ contentLength: String(VOICE_MAX_BYTES * 2) }), deps("hi", c))).status === 413,
    "declared content-length over the cap -> 413"
  );
  const junk = new Uint8Array(VOICE_MAX_BYTES + 100_000).fill(65);
  assert(
    (await handleVoicePost(voiceRequest({ raw: { body: junk, contentType: "multipart/form-data; boundary=x" } }), deps("hi", c))).status === 413,
    "streamed body over the cap with no content-length -> 413"
  );
  assert(c.transcribed === 0, "oversized requests never transcribe");

  resetRateLimits();
  assert((await handleVoicePost(voiceRequest({ requestId: "bad id;" }), deps("hi", c))).status === 400, "bad requestId -> 400");
  assert((await handleVoicePost(voiceRequest({ requestId: null }), deps("hi", c))).status === 400, "missing requestId -> 400");
  assert((await handleVoicePost(voiceRequest({ audio: null }), deps("hi", c))).status === 400, "missing audio -> 400");
  assert((await handleVoicePost(voiceRequest({ audio: new Uint8Array(500).fill(1) }), deps("hi", c))).status === 400, "non-WAV audio -> 400");
  assert(
    (await handleVoicePost(voiceRequest({ raw: { body: new Uint8Array(20), contentType: "multipart/form-data; boundary=x" } }), deps("hi", c))).status === 400,
    "malformed multipart -> 400"
  );
  assert(c.transcribed === 0, "invalid requests never transcribe");

  // Too-short audio: SSE error, no transcription, no turn.
  c = freshCalls();
  const res = await handleVoicePost(voiceRequest({ audio: encodeWav(tone(VOICE_MIN_SAMPLES_16K - 1), 16000) }), deps("hi", c));
  let ev = await frames(res);
  assert(res.status === 200 && res.headers.get("content-type")?.includes("text/event-stream") === true, "short audio streams SSE");
  assert(ev.length === 1 && ev[0].type === "error" && ev[0].message === NOTHING_HEARD, "short audio -> 'couldn't hear anything' error", ev);
  assert(c.transcribed === 0 && c.turns.length === 0, "short audio: no transcription, no turn");
  assert(NOTHING_HEARD.includes("I couldn't hear anything"), "error text matches the brief");

  // The minimum is judged in 16 kHz samples: 0.3 s at 48 kHz is long enough, 0.1 s is not.
  c = freshCalls();
  ev = await frames(await handleVoicePost(voiceRequest({ audio: encodeWav(tone(14_400), 48000) }), deps("hi", c)));
  assert(!ev.some((e) => e.type === "error") && c.transcribed === 1, "0.3 s at 48 kHz is exactly the minimum -> accepted");
  c = freshCalls();
  ev = await frames(await handleVoicePost(voiceRequest({ audio: encodeWav(tone(4_800), 48000) }), deps("hi", c)));
  assert(ev[0]?.type === "error" && c.transcribed === 0, "0.1 s at 48 kHz -> too short");

  // Empty transcript.
  c = freshCalls();
  resetRateLimits();
  ev = await frames(await handleVoicePost(voiceRequest({}), deps("   ", c)));
  assert(ev.some((e) => e.type === "error" && e.message === NOTHING_HEARD), "empty transcript -> 'couldn't hear anything' error", ev);
  assert(c.transcribed === 1 && c.turns.length === 0, "empty transcript: transcribed once, no turn");
  assert(!ev.some((e) => e.type === "transcript"), "empty transcript emits no transcript event");

  // Transcription failure: generic error, no turn.
  c = freshCalls();
  ev = await frames(await handleVoicePost(voiceRequest({}), deps(new Error("boom secret detail"), c)));
  assert(ev.at(-1)?.type === "error" && !JSON.stringify(ev).includes("boom"), "transcription failure -> generic error, no detail");
  assert(c.turns.length === 0, "transcription failure: no turn");

  // Happy path: transcript first, then the turn, keepAlive handed the run.
  c = freshCalls();
  ev = await frames(await handleVoicePost(voiceRequest({}), deps("  add lunch 12.50  ", c)));
  const ti = ev.findIndex((e) => e.type === "transcript");
  assert(ti >= 0 && ev[ti].type === "transcript" && (ev[ti] as { text: string }).text === "add lunch 12.50", "transcript event carries the trimmed text", ev);
  assert(ev.findIndex((e) => e.type === "message") > ti && ev.at(-1)?.type === "done", "transcript precedes the turn's events");
  assert(c.turns.length === 1 && c.turns[0].text === "add lunch 12.50" && c.turns[0].requestId === REQUEST_ID, "turn runs with the transcript and requestId");
  assert(c.kept === 1, "run promise is handed to keepAlive");

  // Per-session rate limit: over the limit -> 429 before transcription.
  resetRateLimits();
  c = freshCalls();
  const sameCookie = `${SESSION_COOKIE}=${signSession(SECRET, Date.now())}`; // one browser session
  for (let i = 0; i < VOICE_LIMIT_PER_MIN; i++) {
    await (await handleVoicePost(voiceRequest({ cookie: sameCookie, audio: encodeWav(tone(VOICE_MIN_SAMPLES_16K - 1), 16000) }), deps("hi", c))).text();
  }
  const limited = await handleVoicePost(voiceRequest({ cookie: sameCookie }), deps("hi", c));
  assert(limited.status === 429 && c.transcribed === 0, "voice over the limit -> 429, nothing transcribed");
  resetRateLimits();
}

async function main() {
  const env = process.env as Record<string, string | undefined>;
  const saved = { secret: env.EGO_APP_SECRET, token: env.EGO_APP_TOKEN };
  env.EGO_APP_SECRET = SECRET;
  env.EGO_APP_TOKEN = "t".repeat(40);
  try {
    testHelpers();
    await testRoute();
  } finally {
    if (saved.secret === undefined) delete env.EGO_APP_SECRET;
    else env.EGO_APP_SECRET = saved.secret;
    if (saved.token === undefined) delete env.EGO_APP_TOKEN;
    else env.EGO_APP_TOKEN = saved.token;
  }
  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
