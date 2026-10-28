/**
 * Unit Test Suite for Calendar Batch Creation (rate-limit retry, partial results, event tags)
 *
 * Usage:
 *   node --experimental-strip-types --import ./scripts/bench/register.mjs scripts/test-calendar-batch.ts
 */

import {
  applyEventTag,
  createEventsSequentially,
  isRateLimitError,
  retryOnRateLimit,
} from "../lib/calendar-batch";

let totalPassed = 0;
let totalFailed = 0;

function assert(condition: boolean, testName: string) {
  if (condition) {
    console.log(`  ✅ PASS: ${testName}`);
    totalPassed++;
  } else {
    console.error(`  ❌ FAIL: ${testName}`);
    totalFailed++;
  }
}

const noSleep = async () => {};

function rateLimitError() {
  return Object.assign(new Error("Rate Limit Exceeded"), { code: 403 });
}

async function runTests() {
  console.log("\n=======================================================");
  console.log("  Unit Tests: Calendar Batch Creation");
  console.log("=======================================================\n");

  // isRateLimitError
  assert(isRateLimitError(rateLimitError()), "Detects Google 403 'Rate Limit Exceeded'");
  assert(
    isRateLimitError(Object.assign(new Error("Too many"), { code: 429 })),
    "Detects HTTP 429"
  );
  assert(
    isRateLimitError(
      Object.assign(new Error("Forbidden"), {
        code: 403,
        errors: [{ reason: "userRateLimitExceeded" }],
      })
    ),
    "Detects userRateLimitExceeded reason"
  );
  assert(
    !isRateLimitError(Object.assign(new Error("Not Found"), { code: 404 })),
    "Ignores unrelated errors"
  );
  assert(
    !isRateLimitError(Object.assign(new Error("Forbidden"), { code: 403 })),
    "Ignores a plain 403 permission error"
  );

  // retryOnRateLimit
  {
    let calls = 0;
    const value = await retryOnRateLimit(
      async () => {
        calls++;
        if (calls < 3) throw rateLimitError();
        return "ok";
      },
      { sleep: noSleep }
    );
    assert(value === "ok" && calls === 3, "Retries rate-limit errors until success");
  }
  {
    let calls = 0;
    let threw = false;
    try {
      await retryOnRateLimit(
        async () => {
          calls++;
          throw rateLimitError();
        },
        { retries: 2, sleep: noSleep }
      );
    } catch {
      threw = true;
    }
    assert(threw && calls === 3, "Gives up after the retry budget (1 try + 2 retries)");
  }
  {
    let calls = 0;
    let threw = false;
    try {
      await retryOnRateLimit(
        async () => {
          calls++;
          throw Object.assign(new Error("Not Found"), { code: 404 });
        },
        { sleep: noSleep }
      );
    } catch {
      threw = true;
    }
    assert(threw && calls === 1, "Does not retry non-rate-limit errors");
  }
  {
    const delays: number[] = [];
    let calls = 0;
    await retryOnRateLimit(
      async () => {
        calls++;
        if (calls < 4) throw rateLimitError();
        return 1;
      },
      { baseDelayMs: 100, sleep: async (ms) => void delays.push(ms) }
    );
    assert(
      delays.length === 3 && delays[0] < delays[1] && delays[1] < delays[2],
      "Backs off with increasing delays"
    );
  }

  // createEventsSequentially
  {
    let inFlight = 0;
    let maxInFlight = 0;
    const result = await createEventsSequentially(
      [1, 2, 3, 4, 5],
      async (n) => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await Promise.resolve();
        inFlight--;
        return `id-${n}`;
      },
      { sleep: noSleep }
    );
    assert(maxInFlight === 1, "Creates events one at a time");
    assert(
      result.created.length === 5 && !result.failure && result.skipped.length === 0,
      "Returns every created event when nothing fails"
    );
    assert(result.created[0] === "id-1" && result.created[4] === "id-5", "Preserves order");
  }
  {
    const result = await createEventsSequentially(
      [1, 2, 3, 4, 5],
      async (n) => {
        if (n === 3) throw new Error("boom");
        return `id-${n}`;
      },
      { sleep: noSleep }
    );
    assert(
      result.created.length === 2 &&
        result.failure?.item === 3 &&
        result.skipped.length === 2 &&
        result.skipped[0] === 4,
      "Stops at the first hard failure and keeps what was already created"
    );
  }
  {
    const seen = new Map<number, number>();
    const result = await createEventsSequentially(
      [1, 2, 3],
      async (n) => {
        const attempt = (seen.get(n) ?? 0) + 1;
        seen.set(n, attempt);
        if (n === 2 && attempt === 1) throw rateLimitError();
        return `id-${n}`;
      },
      { sleep: noSleep }
    );
    assert(result.created.length === 3 && !result.failure, "Recovers from a transient rate limit");
  }

  // applyEventTag
  assert(
    applyEventTag("Welcome, Worship and Introductions", "HACK 2026") ===
      "HACK 2026 — Welcome, Worship and Introductions",
    "Prefixes the tag onto the event title"
  );
  assert(applyEventTag("Lunch", undefined) === "Lunch", "No tag leaves the title unchanged");
  assert(applyEventTag("Lunch", "   ") === "Lunch", "Blank tag leaves the title unchanged");
  assert(
    applyEventTag("HACK 2026 — Lunch", "HACK 2026") === "HACK 2026 — Lunch",
    "Does not double-apply a tag already in the title"
  );

  console.log(`\n  ${totalPassed} passed, ${totalFailed} failed\n`);
  if (totalFailed > 0) process.exit(1);
}

runTests();
