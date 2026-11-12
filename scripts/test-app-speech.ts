/**
 * Offline tests for spoken replies: speech text cleaning, the synthesize wrapper (fake
 * fetch), the speak route's guards (fake synthesizer) and the avatar events that keep
 * thinking -> speaking free of an idle flicker. No Gemini call is made.
 *
 * Usage:
 *   node --experimental-strip-types --import ./scripts/bench/register.mjs scripts/test-app-speech.ts
 */

import { SESSION_COOKIE, signSession } from "../lib/app/auth";
import { initialAvatarState, reduceAvatar, type AvatarEvent } from "../lib/app/avatar-state";
import { CHUNK_CHARS, FIRST_CHUNK_CHARS, ON_SCREEN_LINE, SPEECH_MAX_CHARS, cleanSpeechText, splitSpeechChunks } from "../lib/app/speech-text";
import { SPEAK_LIMIT_PER_MIN } from "../lib/app/rate-limit";
import { resetRateLimits } from "../lib/app/rate-limit";
import { SPEAK_MAX_INPUT_CHARS, handleSpeakPost, synthesize, type SpeakDeps } from "../lib/app/tts";

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

function testCleaning() {
  assert(cleanSpeechText("*Logged* $14 for lunch 🍜") === "Logged $14 for lunch", "markdown and emoji stripped");
  assert(cleanSpeechText("") === "", "empty -> empty");
  assert(cleanSpeechText("   \n ") === "", "whitespace -> empty");
  assert(cleanSpeechText("🍜🎉👍🏽") === "", "emoji only -> empty");
  assert(cleanSpeechText("**Bold** and _italic_ and `code`") === "Bold and italic and code", "bold, italic, code");
  assert(cleanSpeechText("# Plan\n- one\n- two\n1. three") === "Plan one two three", "headings and list markers");
  assert(cleanSpeechText("See [the docs](https://example.com/x) now") === "See the docs now", "links keep their label");
  assert(cleanSpeechText("use snake_case_name here") === "use snake_case_name here", "underscores inside words stay");
  assert(cleanSpeechText("Hello\n\nthere   friend") === "Hello there friend", "whitespace collapsed");

  const table = "Here you go:\n| Item | Cost |\n| --- | --- |\n| Lunch | $14 |";
  assert(cleanSpeechText(table) === ON_SCREEN_LINE && ON_SCREEN_LINE === "The details are on screen.", "table -> on-screen line");

  const sentence = "This is a sentence that goes on for a little while. ";
  const long = sentence.repeat(Math.ceil(1000 / sentence.length)).slice(0, 1000);
  const cut = cleanSpeechText(long);
  assert(cut.length <= SPEECH_MAX_CHARS && cut.length > 300, "1000 chars cut to at most 400", cut.length);
  assert(cut.endsWith("."), "cut ends at a sentence boundary", cut.slice(-20));
  const noStops = "word ".repeat(200);
  const hard = cleanSpeechText(noStops);
  assert(hard.length <= SPEECH_MAX_CHARS && !hard.endsWith(" "), "no sentence end -> cut at a word boundary");
  assert(cleanSpeechText("© 2026 Acme™ and Tide® 🎉") === "© 2026 Acme™ and Tide®", "(c), (R) and TM symbols are kept, emoji dropped");
  assert(cleanSpeechText("Use (c) or a | b for choices") === "Use (c) or a | b for choices", "one pipe in prose is not a table");
  assert(cleanSpeechText("Cost: a | b | c") === "Cost: a | b | c", "two pipes on one line are not a table");
  assert(cleanSpeechText("|---|---|") === ON_SCREEN_LINE, "a separator row marks a table");
  assert(cleanSpeechText("a | b\nc | d\ne | f") === ON_SCREEN_LINE, "three pipe lines are a table");
  const exact = "a".repeat(SPEECH_MAX_CHARS);
  assert(cleanSpeechText(exact) === exact, "exactly the limit is kept whole");
}

function testChunks() {
  const sentence = "This is one fairly ordinary sentence of speech.";
  const text = Array.from({ length: 8 }, () => sentence).join(" ");
  const chunks = splitSpeechChunks(text);
  assert(chunks.join(" ") === text, "chunks rejoin to the original text");
  assert(chunks.length > 1 && chunks[0].length <= FIRST_CHUNK_CHARS, "first chunk is short", chunks[0].length);
  assert(chunks.slice(1).every((c) => c.length <= CHUNK_CHARS), "later chunks stay under the chunk size");
  assert(chunks.every((c) => /[.!?]$/.test(c)), "every chunk ends at a sentence boundary");
  assert(splitSpeechChunks("Short reply.").join("|") === "Short reply.", "a short reply is one chunk");
  assert(splitSpeechChunks("Paid 14.50 today. Done!").join("|") === "Paid 14.50 today. Done!", "decimals are not sentence ends");
  const long = "x".repeat(300) + ".";
  assert(splitSpeechChunks(long + " Next.").length === 2 && splitSpeechChunks(long)[0] === long, "one long sentence stays whole");
  assert(splitSpeechChunks("").length === 0, "empty -> no chunks");
  assert(splitSpeechChunks(cleanSpeechText("Sentence one is here. ".repeat(100))).join(" ").length <= SPEECH_MAX_CHARS, "cut text chunks within the cap");
}

function pcmEvent(samples: number[], mimeType: string): string {
  const buf = Buffer.alloc(samples.length * 2);
  samples.forEach((v, i) => buf.writeInt16LE(v, i * 2));
  const json = { candidates: [{ content: { parts: [{ inlineData: { mimeType, data: buf.toString("base64") } }] } }] };
  return `data: ${JSON.stringify(json)}\r\n\r\n`;
}

/** A streamed reply: the PCM split over events, as the SSE endpoint sends it. */
function pcmResponse(samples: number[], mimeType = "audio/L16;codec=pcm;rate=24000"): Response {
  const mid = Math.ceil(samples.length / 2);
  return new Response(pcmEvent(samples.slice(0, mid), mimeType) + pcmEvent(samples.slice(mid), mimeType));
}

async function testSynthesize() {
  process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test-key";
  let seen: { url: string; body: string; key: string | null } | null = null;
  const { wav } = await synthesize("Hello there", async (url, init) => {
    seen = { url, body: String(init.body), key: new Headers(init.headers).get("x-goog-api-key") };
    return pcmResponse([0, 16384, -16384, 32767]);
  });
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  assert(String.fromCharCode(...wav.slice(0, 4)) === "RIFF", "synthesize returns a WAV");
  assert(view.getUint32(24, true) === 24000 && wav.length === 44 + 8, "rate from the mime type, 2 bytes per sample");
  assert(Math.abs(view.getInt16(46, true) - 16384) <= 1, "PCM samples round-trip");
  assert(Math.abs(view.getInt16(50, true) - 32767) <= 1 && wav.length === 44 + 8, "audio split over several events is joined in order");
  assert(seen !== null && /gemini-.*tts:streamGenerateContent\?alt=sse$/.test((seen as { url: string }).url), "calls the TTS model");
  assert((seen as unknown as { key: string }).key === "test-key", "key sent in a header, not the URL");
  assert((seen as unknown as { body: string }).body.includes('"AUDIO"') && (seen as unknown as { body: string }).body.includes("Hello there"), "asks for audio of the text");

  const rate = await synthesize("x", async () => pcmResponse([1, 2], "audio/L16;rate=16000"));
  assert(new DataView(rate.wav.buffer, rate.wav.byteOffset).getUint32(24, true) === 16000, "other sample rates honoured");
  let threw = false;
  await synthesize("x", async () => new Response("no", { status: 500 })).catch(() => (threw = true));
  assert(threw, "HTTP failure throws");
  threw = false;
  await synthesize("x", async () => new Response("data: {\"candidates\":[]}\n\n")).catch(() => (threw = true));
  assert(threw, "no audio in the response throws");
}

function speakRequest(opts: { cookie?: string | null; origin?: string | null; body?: string; contentType?: string | null }): Request {
  const headers: Record<string, string> = { host: HOST };
  const cookie = opts.cookie === undefined ? `${SESSION_COOKIE}=${signSession(SECRET, Date.now())}` : opts.cookie;
  if (cookie) headers.cookie = cookie;
  const origin = opts.origin === undefined ? ORIGIN : opts.origin;
  if (origin) headers.origin = origin;
  if (opts.contentType !== null) headers["content-type"] = opts.contentType ?? "application/json";
  return new Request(`${ORIGIN}/api/ego/speak`, { method: "POST", headers, body: opts.body ?? "{}" });
}

async function testRoute() {
  const route = await import("../app/api/ego/speak/route");
  assert(route.runtime === "nodejs" && typeof route.POST === "function", "route: nodejs runtime, POST handler");

  const spoken: string[] = [];
  let fail = false;
  const deps: SpeakDeps = {
    async synthesize(text) {
      spoken.push(text);
      if (fail) throw new Error("boom");
      return { wav: new Uint8Array([82, 73, 70, 70]) };
    },
  };
  const body = (text: unknown) => JSON.stringify({ text });

  assert((await handleSpeakPost(speakRequest({ cookie: null, body: body("hi") }), deps)).status === 401, "no cookie -> 401");
  assert((await handleSpeakPost(speakRequest({ cookie: `${SESSION_COOKIE}=garbage`, body: body("hi") }), deps)).status === 401, "bad cookie -> 401");
  assert((await handleSpeakPost(speakRequest({ origin: "https://evil.example.com", body: body("hi") }), deps)).status === 403, "wrong Origin -> 403");
  assert((await handleSpeakPost(speakRequest({ contentType: "text/plain", body: body("hi") }), deps)).status === 415, "non-JSON -> 415");
  assert((await handleSpeakPost(speakRequest({ body: "{nope" }), deps)).status === 400, "invalid JSON -> 400");
  assert((await handleSpeakPost(speakRequest({ body: "{}" }), deps)).status === 400, "missing text -> 400");
  assert((await handleSpeakPost(speakRequest({ body: body(42) }), deps)).status === 400, "non-string text -> 400");
  assert((await handleSpeakPost(speakRequest({ body: body("🍜 🎉") }), deps)).status === 400, "emoji-only text -> 400");
  assert((await handleSpeakPost(speakRequest({ body: body("") }), deps)).status === 400, "empty text -> 400");
  assert((await handleSpeakPost(speakRequest({ body: body("a".repeat(SPEAK_MAX_INPUT_CHARS + 1)) }), deps)).status === 413, "text over the speak cap -> 413 before synthesis");
  assert((await handleSpeakPost(speakRequest({ body: body("a".repeat(4001)) }), deps)).status === 413, "text over MAX_INPUT_CHARS -> 413");
  assert((await handleSpeakPost(speakRequest({ body: JSON.stringify({ text: "a", pad: "b".repeat(40_000) }) }), deps)).status === 413, "body over the cap -> 413");
  assert(spoken.length === 0, "rejected requests never synthesize");

  const ok = await handleSpeakPost(speakRequest({ body: body("*Logged* $14 🍜") }), deps);
  assert(ok.status === 200 && ok.headers.get("content-type") === "audio/wav", "valid request -> 200 audio/wav");
  assert(spoken[0] === "Logged $14", "synthesizer receives the cleaned text", spoken);
  assert((await ok.arrayBuffer()).byteLength === 4, "body is the WAV bytes");

  // Per-session rate limit: the first SPEAK_LIMIT_PER_MIN calls pass, the next is 429 without synthesizing.
  resetRateLimits();
  const sameCookie = `${SESSION_COOKIE}=${signSession(SECRET, Date.now())}`; // one browser session
  const before = spoken.length;
  let allowed = 0;
  for (let i = 0; i < SPEAK_LIMIT_PER_MIN; i++) {
    if ((await handleSpeakPost(speakRequest({ cookie: sameCookie, body: body("hello there") }), deps)).status === 200) allowed++;
  }
  assert(allowed === SPEAK_LIMIT_PER_MIN, "calls up to the limit are allowed", allowed);
  const limited = await handleSpeakPost(speakRequest({ cookie: sameCookie, body: body("hello there") }), deps);
  assert(limited.status === 429 && spoken.length === before + SPEAK_LIMIT_PER_MIN, "call over the limit -> 429, no synthesis");
  assert((await handleSpeakPost(speakRequest({ cookie: null, body: body("hi") }), deps)).status === 401, "unauthenticated is 401, not counted");
  resetRateLimits();

  const long = await handleSpeakPost(speakRequest({ body: body("Sentence one is here. ".repeat(40)) }), deps);
  assert(long.status === 200 && spoken[spoken.length - 1].length <= SPEECH_MAX_CHARS, "long text is cut before synthesis");

  fail = true;
  const err = await handleSpeakPost(speakRequest({ body: body("hello") }), deps);
  assert(err.status === 502, "synthesis failure -> 502");
}

function testAvatar() {
  const run = (events: AvatarEvent[]) => events.reduce(reduceAvatar, initialAvatarState);
  const states = (events: AvatarEvent[]) => {
    const seen: string[] = [];
    events.reduce((s, e) => {
      const n = reduceAvatar(s, e);
      seen.push(n.activity);
      return n;
    }, initialAvatarState);
    return seen;
  };

  const flow = states([{ type: "request_sent" }, { type: "turn_done", willSpeak: true }, { type: "speech_start" }, { type: "speech_end" }]);
  assert(flow.join() === "thinking,thinking,speaking,idle", "willSpeak: thinking holds through turn_done, no idle flicker", flow);
  assert(run([{ type: "request_sent" }, { type: "turn_done", willSpeak: true }]).mood === "warm", "willSpeak still sets the mood");
  assert(run([{ type: "request_sent" }, { type: "turn_done" }]).activity === "idle", "no spoken reply: turn_done -> idle as before");
  assert(
    run([{ type: "request_sent" }, { type: "turn_done", willSpeak: true }, { type: "speech_abandoned" }]).activity === "idle",
    "speech_abandoned ends a thinking that was waiting for speech"
  );
  assert(run([{ type: "request_sent" }, { type: "speech_abandoned" }]).activity === "idle", "speech_abandoned from thinking -> idle");
  const speaking = run([{ type: "turn_done" }, { type: "speech_start" }]);
  assert(reduceAvatar(speaking, { type: "speech_abandoned" }) === speaking, "speech_abandoned leaves speaking alone");
  assert(reduceAvatar(speaking, { type: "request_sent" }) === speaking, "a repeated thinking event does not cut off speech");
  // I2: a stale willSpeak:false (speech already finished) must not leave thinking stuck; and
  // the tap recovery (speech_abandoned) clears a thinking that nothing will end.
  const stuck = states([
    { type: "request_sent" }, { type: "speech_start" }, { type: "speech_end" },
    { type: "request_sent" }, { type: "turn_done", willSpeak: false },
  ]);
  assert(stuck[stuck.length - 1] === "idle", "turn_done without live speech ends thinking", stuck);
  const held = run([{ type: "request_sent" }, { type: "turn_done", willSpeak: true }]);
  assert(reduceAvatar(held, { type: "speech_abandoned" }).activity === "idle", "tap recovery clears held thinking");
  const thinking = run([{ type: "request_sent" }]);
  assert(reduceAvatar(thinking, { type: "speech_interrupted" }) === thinking, "speech_interrupted alone keeps a running turn thinking");
  assert(
    run([{ type: "speech_start" }, { type: "level", value: 0.5 }, { type: "speech_interrupted" }]).mouth === "closed",
    "speech_interrupted closes the mouth"
  );
}

async function main() {
  const env = process.env as Record<string, string | undefined>;
  const saved = { secret: env.EGO_APP_SECRET, token: env.EGO_APP_TOKEN, key: env.GOOGLE_GENERATIVE_AI_API_KEY };
  env.EGO_APP_SECRET = SECRET;
  env.EGO_APP_TOKEN = "t".repeat(40);
  try {
    await runAll();
  } finally {
    for (const [name, value] of [["EGO_APP_SECRET", saved.secret], ["EGO_APP_TOKEN", saved.token], ["GOOGLE_GENERATIVE_AI_API_KEY", saved.key]] as const) {
      if (value === undefined) delete env[name];
      else env[name] = value;
    }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

async function runAll() {
  console.log("\n🗣  Spoken replies\n");
  console.log("Speech text:");
  testCleaning();
  console.log("Chunks:");
  testChunks();
  console.log("Synthesize:");
  await testSynthesize();
  console.log("Speak route:");
  await testRoute();
  console.log("Avatar events:");
  testAvatar();
}

void main();
