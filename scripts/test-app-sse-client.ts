/**
 * Unit tests for the app's SSE client (lib/app/sse-client.ts). No I/O.
 *
 * Usage:
 *   node --experimental-strip-types --import ./scripts/bench/register.mjs scripts/test-app-sse-client.ts
 */

import { readSse } from "../lib/app/sse-client";
import type { AppEvent } from "../lib/app/events";

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

function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i < chunks.length) controller.enqueue(chunks[i++]);
      else controller.close();
    },
  });
}

async function collect(chunks: Uint8Array[]): Promise<AppEvent[]> {
  const out: AppEvent[] = [];
  await readSse(streamOf(chunks), (e) => out.push(e));
  return out;
}

const enc = new TextEncoder();
const text = (s: string) => [enc.encode(s)];
const frame = (e: AppEvent) => `data: ${JSON.stringify(e)}\n\n`;

async function main() {
  const a: AppEvent = { type: "thinking" };
  const b: AppEvent = { type: "message", id: 5, text: "héllo *world* 🎉" };
  const c: AppEvent = { type: "done", status: "ok" };

  let r = await collect(text(frame(a) + frame(b) + frame(c)));
  assert(JSON.stringify(r) === JSON.stringify([a, b, c]), "multiple frames in one chunk", r);

  // Split at every byte, including inside the multi-byte characters.
  const bytes = enc.encode(frame(a) + frame(b) + frame(c));
  r = await collect(Array.from(bytes, (x) => new Uint8Array([x])));
  assert(JSON.stringify(r) === JSON.stringify([a, b, c]), "one byte per chunk (UTF-8 and frame splits)", r);

  r = await collect(text((frame(a) + frame(b)).replace(/\n/g, "\r\n")));
  assert(JSON.stringify(r) === JSON.stringify([a, b]), "CRLF framing", r);

  r = await collect(text(`: keep-alive\n\n${frame(a)}: comment\ndata: ${JSON.stringify(c)}\n\n`));
  assert(JSON.stringify(r) === JSON.stringify([a, c]), "comment lines and comment-only frames ignored", r);

  r = await collect(text(frame(a) + `data: ${JSON.stringify(c)}`));
  assert(JSON.stringify(r) === JSON.stringify([a, c]), "partial final frame (no blank line) is delivered", r);

  r = await collect(text(`data: {not json\n\n${frame(a)}data: 42\n\ndata: {"nope":1}\n\n`));
  assert(JSON.stringify(r) === JSON.stringify([a]), "malformed and untyped frames skipped", r);

  const err: AppEvent = { type: "error", message: "Something went wrong on my side. Please try again." };
  r = await collect(text(frame(a) + frame(err)));
  assert(r.length === 2 && r[1].type === "error" && (r[1] as { message: string }).message === err.message, "error event delivered", r);

  r = await collect([]);
  assert(r.length === 0, "empty stream yields nothing");

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
