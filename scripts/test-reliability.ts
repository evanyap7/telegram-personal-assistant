/**
 * Reliability regression tests: Phase 1 hardening (stale-update detection, error reporting,
 * Telegram timeouts/429 cap, workout "unreadable" context, credential redaction).
 * Route-level tests (webhook, crons) are not here: those modules can't load under this
 * runner (extensionless "next/server", multi-line type imports) until handlers are extracted.
 *
 * Usage:
 *   node --experimental-strip-types --import ./scripts/bench/register.mjs scripts/test-reliability.ts
 */

import assert from "node:assert/strict";
import { describeWorkoutContext } from "../lib/agent/ego-prompt";
import { resolveFailureReply } from "../lib/agent/ego-reply";
import { STALE_PROCESSING_MS, isStaleProcessing } from "../lib/finance";
import {
  REPORT_COOLDOWN_MS,
  formatErrorReport,
  reportError,
  resetReportThrottle,
  shouldReport,
} from "../lib/report-error";
import { redactForPersistence } from "../lib/chat-history";
import { sendTelegramMessage } from "../lib/telegram";

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  ✅ PASS: ${name}`);
    passed++;
  } catch (error) {
    console.error(`  ❌ FAIL: ${name}`);
    console.error(error instanceof Error ? error.message : error);
    failed++;
  }
}

type FetchCall = { url: string; body: string; hasSignal: boolean };

async function withFetch<T>(
  responder: (call: FetchCall, index: number) => Response,
  run: (calls: FetchCall[]) => Promise<T>
): Promise<T> {
  const original = globalThis.fetch;
  const calls: FetchCall[] = [];
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const call: FetchCall = {
      url: String(input),
      body: typeof init?.body === "string" ? init.body : "",
      hasSignal: init?.signal instanceof AbortSignal,
    };
    calls.push(call);
    return responder(call, calls.length - 1);
  }) as typeof fetch;
  try {
    return await run(calls);
  } finally {
    globalThis.fetch = original;
  }
}

const ok = () => new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });

async function main() {
  console.log("\n=======================================================");
  console.log("  Reliability Tests");
  console.log("=======================================================\n");

  process.env.TELEGRAM_BOT_TOKEN = "test-token";
  process.env.TELEGRAM_ALLOWED_USER_ID = "111";
  process.env.TELEGRAM_WEBHOOK_SECRET = "hook-secret";
  process.env.CRON_SECRET = "cron-secret";

  // --- EGO: unreadable workout store must not read as "no session" ---
  await test("describeWorkoutContext(undefined) says the store is unreadable", () => {
    const text = describeWorkoutContext(undefined);
    assert.match(text, /could not be read/);
    assert.doesNotMatch(text, /There is no active workout session/);
  });
  await test("describeWorkoutContext(null) still means no session", () => {
    assert.equal(describeWorkoutContext(null), "There is no active workout session.");
  });
  await test("resolveFailureReply only replies when something already happened", () => {
    assert.equal(resolveFailureReply(false), null);
    assert.ok(resolveFailureReply(true));
  });

  // --- Stale "processing" detection ---
  await test("isStaleProcessing: only old processing rows are stale", () => {
    const now = 1_000_000_000;
    const old = now - STALE_PROCESSING_MS - 1;
    const fresh = now - STALE_PROCESSING_MS + 1;
    assert.equal(isStaleProcessing({ status: "processing", startedAt: old }, now), true);
    assert.equal(isStaleProcessing({ status: "processing", startedAt: fresh }, now), false);
    assert.equal(isStaleProcessing({ status: "completed", startedAt: old }, now), false);
    assert.equal(isStaleProcessing({ status: "failed", startedAt: old }, now), false);
    assert.equal(isStaleProcessing({ status: "processing", startedAt: null }, now), false);
  });

  // --- Error reporting ---
  await test("shouldReport throttles the same event inside the cooldown", () => {
    resetReportThrottle();
    assert.equal(shouldReport("a", 0), true);
    assert.equal(shouldReport("a", REPORT_COOLDOWN_MS - 1), false);
    assert.equal(shouldReport("b", 1), true);
    assert.equal(shouldReport("a", REPORT_COOLDOWN_MS + 1), true);
  });
  await test("formatErrorReport truncates long details", () => {
    const text = formatErrorReport("cron.x", new Error("e".repeat(1000)), "update 5");
    assert.ok(text.includes("cron.x (update 5)"));
    assert.ok(text.length < 400);
  });
  await test("reportError DMs the owner once, then stays quiet", async () => {
    resetReportThrottle();
    await withFetch(ok, async (calls) => {
      await reportError("cron.test", new Error("boom"));
      await reportError("cron.test", new Error("boom again"));
      assert.equal(calls.length, 1);
      assert.match(calls[0].body, /"chat_id":111/);
      assert.match(calls[0].body, /boom/);
    });
  });
  await test("reportError never throws when Telegram is down", async () => {
    resetReportThrottle();
    await withFetch(
      () => new Response("nope", { status: 500 }),
      async () => {
        await reportError("cron.down", new Error("x"));
      }
    );
  });

  // --- Credential hygiene in persisted chat history ---
  await test("redactForPersistence hides credential-looking text only", () => {
    assert.equal(redactForPersistence("my wifi password is hunter2"), "[redacted: possible credential]");
    assert.equal(redactForPersistence("locker PIN 4821"), "[redacted: possible credential]");
    assert.equal(redactForPersistence("lunch was $12"), "lunch was $12");
  });

  // --- Telegram client: timeout + capped 429 waits ---
  await test("Telegram calls carry an abort signal", async () => {
    await withFetch(ok, async (calls) => {
      await sendTelegramMessage(1, "hi");
      assert.equal(calls.length, 1);
      assert.equal(calls[0].hasSignal, true);
    });
  });
  await test("429 with a long retry_after fails fast instead of sleeping", async () => {
    const started = Date.now();
    await withFetch(
      () =>
        new Response(JSON.stringify({ ok: false, parameters: { retry_after: 60 } }), {
          status: 429,
        }),
      async (calls) => {
        await assert.rejects(sendTelegramMessage(1, "hi"), /429/);
        assert.equal(calls.length, 1);
      }
    );
    assert.ok(Date.now() - started < 2000, "must not wait out a 60s retry_after");
  });
  await test("429 with a short retry_after retries once and succeeds", async () => {
    await withFetch(
      (_call, index) =>
        index === 0
          ? new Response(JSON.stringify({ ok: false, parameters: { retry_after: 1 } }), {
              status: 429,
            })
          : ok(),
      async (calls) => {
        await sendTelegramMessage(1, "hi");
        assert.equal(calls.length, 2);
      }
    );
  });

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
