/**
 * Unit tests for the app chat and callback endpoints: request validation (auth, Origin,
 * content type, size caps, field shapes) and the SSE response helper.
 *
 * Authorised turns are covered by test-app-turn.ts; these tests stop before the EGO
 * pipeline is loaded, so they run offline.
 *
 * Usage:
 *   node --experimental-strip-types --import ./scripts/bench/register.mjs scripts/test-app-routes.ts
 */

import { MAX_INPUT_CHARS, SESSION_COOKIE, signSession } from "../lib/app/auth";
import { MAX_BODY_BYTES, isValidRequestId, sseResponse } from "../lib/app/http";
import type { AppEvent } from "../lib/app/events";
import { POST as chat, maxDuration as chatMaxDuration, runtime as chatRuntime } from "../app/api/ego/chat/route";
import {
  POST as callback,
  maxDuration as callbackMaxDuration,
  runtime as callbackRuntime,
} from "../app/api/ego/callback/route";

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

const TOKEN = "t".repeat(40);
const SECRET = "s".repeat(40);
const HOST = "ego.example.com";
const ORIGIN = `https://${HOST}`;
const REQUEST_ID = "3f2b6c1e-7a4d-4e8b-9c0f-1a2b3c4d5e6f";

type ReqOpts = {
  cookie?: string | null;
  origin?: string | null;
  contentType?: string | null;
  body?: unknown;
  rawBody?: string;
  contentLength?: string;
};

function goodCookie(): string {
  return `${SESSION_COOKIE}=${signSession(SECRET, Date.now())}`;
}

function req(path: string, opts: ReqOpts = {}): Request {
  const headers: Record<string, string> = { host: HOST };
  const cookie = opts.cookie === undefined ? goodCookie() : opts.cookie;
  const origin = opts.origin === undefined ? ORIGIN : opts.origin;
  const contentType = opts.contentType === undefined ? "application/json" : opts.contentType;
  if (cookie) headers.cookie = cookie;
  if (origin) headers.origin = origin;
  if (contentType) headers["content-type"] = contentType;
  if (opts.contentLength) headers["content-length"] = opts.contentLength;
  const body = opts.rawBody ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body));
  return new Request(`${ORIGIN}${path}`, { method: "POST", headers, body });
}

type Handler = (r: Request) => Promise<Response>;

async function status(handler: Handler, path: string, opts: ReqOpts): Promise<number> {
  return (await handler(req(path, opts))).status;
}

/** Shared rejection cases; `valid` is a body that passes every check of that route. */
async function commonRejections(name: string, handler: Handler, path: string, valid: Record<string, unknown>) {
  const env = process.env as Record<string, string | undefined>;

  assert((await status(handler, path, { cookie: null, body: valid })) === 401, `${name}: no cookie -> 401`);
  assert(
    (await status(handler, path, { cookie: `${SESSION_COOKIE}=garbage`, body: valid })) === 401,
    `${name}: bad cookie -> 401`
  );
  assert(
    (await status(handler, path, { origin: "https://evil.example.com", body: valid })) === 403,
    `${name}: wrong Origin -> 403`
  );
  assert((await status(handler, path, { origin: null, body: valid })) === 403, `${name}: missing Origin -> 403`);

  const savedSecret = env.EGO_APP_SECRET;
  delete env.EGO_APP_SECRET;
  assert((await status(handler, path, { body: valid })) === 401, `${name}: auth not configured -> 401 (fail closed)`);
  env.EGO_APP_SECRET = savedSecret;

  assert(
    (await status(handler, path, { contentType: "text/plain", body: valid })) === 415,
    `${name}: text/plain -> 415`
  );
  assert(
    (await status(handler, path, { contentType: null, body: valid })) === 415,
    `${name}: no content type -> 415`
  );
  assert(
    (await status(handler, path, { contentType: "application/jsonx", body: valid })) === 415,
    `${name}: application/jsonx -> 415`
  );
  assert(
    (await status(handler, path, { rawBody: "x".repeat(MAX_BODY_BYTES + 1) })) === 413,
    `${name}: body over the byte cap -> 413`
  );
  assert(
    (await status(handler, path, { contentLength: String(MAX_BODY_BYTES + 1), body: valid })) === 413,
    `${name}: declared content-length over the cap -> 413`
  );
  assert((await status(handler, path, { rawBody: "{not json" })) === 400, `${name}: invalid JSON -> 400`);
  assert((await status(handler, path, { rawBody: "null" })) === 400, `${name}: JSON null -> 400`);
  assert((await status(handler, path, { body: [valid] })) === 400, `${name}: JSON array -> 400`);

  const { requestId: _omit, ...noRequestId } = valid;
  void _omit;
  assert((await status(handler, path, { body: noRequestId })) === 400, `${name}: missing requestId -> 400`);
  assert(
    (await status(handler, path, { body: { ...valid, requestId: 42 } })) === 400,
    `${name}: numeric requestId -> 400`
  );
  assert(
    (await status(handler, path, { body: { ...valid, requestId: "a".repeat(129) } })) === 400,
    `${name}: overlong requestId -> 400`
  );
  assert(
    (await status(handler, path, { body: { ...valid, requestId: "bad id;drop" } })) === 400,
    `${name}: requestId with illegal characters -> 400`
  );
  assert(
    (await status(handler, path, { body: { ...valid, requestId: "short" } })) === 400,
    `${name}: too-short requestId -> 400`
  );

  const res = await handler(req(path, { cookie: null, body: valid }));
  const json = (await res.json()) as { error?: string };
  assert(
    res.headers.get("content-type")?.includes("application/json") === true && typeof json.error === "string",
    `${name}: rejections are JSON errors`
  );
}

async function readAll(res: Response): Promise<string> {
  return await res.text();
}

function parseFrames(body: string): AppEvent[] {
  return body
    .split("\n\n")
    .filter((f) => f.startsWith("data: "))
    .map((f) => JSON.parse(f.slice("data: ".length)) as AppEvent);
}

async function testSseResponse() {
  // Headers and framing.
  const res = sseResponse(async (emit) => {
    emit({ type: "thinking" });
    emit({ type: "message", id: 1, text: "hi\nthere" });
    emit({ type: "done", status: "ok" });
  });
  assert(res.status === 200, "sse: 200");
  assert(res.headers.get("content-type") === "text/event-stream; charset=utf-8", "sse: event-stream content type");
  assert(
    res.headers.get("cache-control") === "no-store, no-transform",
    "sse: Cache-Control no-store, no-transform"
  );
  assert(res.headers.get("x-accel-buffering") === "no", "sse: proxy buffering disabled");
  const events = parseFrames(await readAll(res));
  assert(
    events.length === 3 && events[0].type === "thinking" && events[2].type === "done",
    "sse: every emitted event becomes one frame, in order",
    events
  );

  // Frames are readable before the run finishes (not buffered until the end).
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let finished = false;
  const live = sseResponse(async (emit) => {
    emit({ type: "thinking" });
    await gate;
    emit({ type: "done" });
    finished = true;
  });
  const reader = live.body!.getReader();
  const first = await reader.read();
  const firstText = new TextDecoder().decode(first.value);
  assert(
    !finished && firstText === 'data: {"type":"thinking"}\n\n',
    "sse: first frame arrives while the run is still in progress",
    firstText
  );
  release();
  const second = await reader.read();
  assert(new TextDecoder().decode(second.value).includes('"done"'), "sse: later frame follows");
  const end = await reader.read();
  assert(end.done === true, "sse: stream closes when the run resolves");

  // A run that throws ends the stream with an error frame instead of a hung stream.
  const boom = sseResponse(async (emit) => {
    emit({ type: "thinking" });
    throw new Error("secret internal detail");
  });
  const boomBody = await readAll(boom);
  const boomEvents = parseFrames(boomBody);
  assert(
    boomEvents.at(-1)?.type === "error" && !boomBody.includes("secret internal detail"),
    "sse: a throwing run ends with a generic error frame",
    boomEvents
  );

  // Client disconnect: later emits are silent no-ops and the run is not broken.
  let emitAfterCancelThrew = false;
  let runCompleted = false;
  let releaseCancelled!: () => void;
  const cancelGate = new Promise<void>((r) => (releaseCancelled = r));
  const cancelled = sseResponse(async (emit) => {
    emit({ type: "thinking" });
    await cancelGate;
    try {
      emit({ type: "message", id: 1, text: "late" });
      emit({ type: "done" });
    } catch {
      emitAfterCancelThrew = true;
    }
    runCompleted = true;
  });
  const cReader = cancelled.body!.getReader();
  await cReader.read();
  await cReader.cancel();
  releaseCancelled();
  await new Promise((r) => setTimeout(r, 10));
  assert(runCompleted && !emitAfterCancelThrew, "sse: emits after client cancel are silent no-ops");

  await testKeepAlive();
}

async function testKeepAlive() {
  // The run promise is handed to the keep-alive hook (after() in the routes) synchronously,
  // while still inside the request scope, and a cancelled stream does not stop the run.
  const handed: Promise<unknown>[] = [];
  let releaseRun!: () => void;
  const runGate = new Promise<void>((r) => (releaseRun = r));
  const steps: string[] = [];
  const res = sseResponse(
    async (emit) => {
      emit({ type: "thinking" });
      steps.push("finance row written");
      await runGate;
      steps.push("todo written");
      emit({ type: "done" });
    },
    { keepAlive: (p) => handed.push(p) }
  );
  assert(handed.length === 1, "keepAlive: run promise handed over once, before sseResponse returns");
  const reader = res.body!.getReader();
  await reader.read();
  await reader.cancel();
  releaseRun();
  let settled = false;
  await Promise.race([
    handed[0].then(() => (settled = true)),
    new Promise((r) => setTimeout(r, 500)),
  ]);
  assert(
    settled && steps.join(",") === "finance row written,todo written",
    "keepAlive: after the client cancels, the kept-alive run still finishes every step",
    steps
  );

  // The kept-alive promise never rejects, even when the run throws.
  const handedBoom: Promise<unknown>[] = [];
  const boom = sseResponse(
    async () => {
      throw new Error("boom");
    },
    { keepAlive: (p) => handedBoom.push(p) }
  );
  let rejected = false;
  await handedBoom[0].catch(() => (rejected = true));
  await boom.text();
  assert(handedBoom.length === 1 && !rejected, "keepAlive: promise resolves even when the run throws");

  // A keep-alive hook that throws (for example, no request scope) does not break the stream.
  const noScope = sseResponse(
    async (emit) => {
      emit({ type: "done" });
    },
    {
      keepAlive: () => {
        throw new Error("outside a request scope");
      },
    }
  );
  const noScopeEvents = parseFrames(await noScope.text());
  assert(noScopeEvents.at(-1)?.type === "done", "keepAlive: a throwing hook still streams the run", noScopeEvents);
}

function testRequestIdShape() {
  assert(isValidRequestId(REQUEST_ID), "requestId: UUID accepted");
  assert(isValidRequestId("abc_DEF-1234"), "requestId: url-safe token accepted");
  assert(!isValidRequestId(""), "requestId: empty rejected");
  assert(!isValidRequestId("a".repeat(129)), "requestId: 129 chars rejected");
  assert(isValidRequestId("a".repeat(128)), "requestId: 128 chars accepted");
  assert(!isValidRequestId("has space1"), "requestId: whitespace rejected");
  assert(!isValidRequestId("ünïcødé-id"), "requestId: non-ASCII rejected");
  assert(!isValidRequestId(undefined), "requestId: undefined rejected");
}

async function main() {
  const env = process.env as Record<string, string | undefined>;
  const saved = { secret: env.EGO_APP_SECRET, token: env.EGO_APP_TOKEN };
  try {
    console.log("\n  Unit Tests: App Chat & Callback Routes\n");
    env.EGO_APP_SECRET = SECRET;
    env.EGO_APP_TOKEN = TOKEN;

    assert(chatMaxDuration === 120 && callbackMaxDuration === 120, "maxDuration is 120 s on both routes");
    assert(chatRuntime === "nodejs" && callbackRuntime === "nodejs", "both routes run on nodejs");
    assert(MAX_BODY_BYTES >= MAX_INPUT_CHARS * 4, "byte cap fits MAX_INPUT_CHARS of 4-byte UTF-8");

    // Chat route
    const chatPath = "/api/ego/chat";
    const validChat = { text: "hello", requestId: REQUEST_ID };
    await commonRejections("chat", chat, chatPath, validChat);
    assert(
      (await status(chat, chatPath, { body: { ...validChat, text: "a".repeat(MAX_INPUT_CHARS + 1) } })) === 413,
      "chat: text over MAX_INPUT_CHARS -> 413"
    );
    assert(
      (await status(chat, chatPath, { body: { ...validChat, text: "é".repeat(MAX_INPUT_CHARS + 1) } })) === 413,
      "chat: multi-byte text over MAX_INPUT_CHARS -> 413"
    );
    assert((await status(chat, chatPath, { body: { ...validChat, text: "" } })) === 400, "chat: empty text -> 400");
    assert(
      (await status(chat, chatPath, { body: { ...validChat, text: "   \n\t " } })) === 400,
      "chat: whitespace-only text -> 400"
    );
    assert(
      (await status(chat, chatPath, { body: { requestId: REQUEST_ID } })) === 400,
      "chat: missing text -> 400"
    );
    assert(
      (await status(chat, chatPath, { body: { ...validChat, text: 7 } })) === 400,
      "chat: non-string text -> 400"
    );

    // Callback route
    const cbPath = "/api/ego/callback";
    const validCb = { data: "menu:home", messageId: 1_700_000_000_000_000, requestId: REQUEST_ID };
    await commonRejections("callback", callback, cbPath, validCb);
    assert((await status(callback, cbPath, { body: { ...validCb, data: "" } })) === 400, "callback: empty data -> 400");
    assert(
      (await status(callback, cbPath, { body: { messageId: 1, requestId: REQUEST_ID } })) === 400,
      "callback: missing data -> 400"
    );
    assert(
      (await status(callback, cbPath, { body: { ...validCb, data: "x".repeat(65) } })) === 400,
      "callback: data over Telegram's 64-byte limit -> 400"
    );
    assert(
      (await status(callback, cbPath, { body: { ...validCb, data: "é".repeat(33) } })) === 400,
      "callback: data over 64 bytes (multi-byte) -> 400"
    );
    const { messageId: _m, ...noMessageId } = validCb;
    void _m;
    assert((await status(callback, cbPath, { body: noMessageId })) === 400, "callback: missing messageId -> 400");
    for (const bad of [0, -1, 1.5, "12", Number.MAX_SAFE_INTEGER + 1]) {
      assert(
        (await status(callback, cbPath, { body: { ...validCb, messageId: bad } })) === 400,
        `callback: messageId ${JSON.stringify(bad)} -> 400`
      );
    }

    testRequestIdShape();
    await testSseResponse();
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
