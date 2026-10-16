import assert from "node:assert/strict";
import {
  SWITCH_THRESHOLD,
  candidatesFor,
  claudeChain,
  classifyError,
  decideMode,
  isExhausted,
  isNearlyOut,
  providerFlags,
  remainingFraction,
  remainingUsd,
  type ProviderStatus,
} from "../lib/ai/mode";
import { costUsd, PERPLEXITY_REQUEST_FEE_USD } from "../lib/ai/pricing";

const sections: Array<{ name: string; run: () => void | Promise<void> }> = [];
function section(name: string, run: () => void | Promise<void>) {
  sections.push({ name, run });
}

const status = (start: number | null, spent: number, depleted = false): ProviderStatus => ({
  startBalanceUsd: start,
  spentUsd: spent,
  depleted,
});
const ALL = { gemini: true, perplexity: true, anthropic: true };
const NONE_DEPLETED = { gemini: false, perplexity: false };

// ---- sections ----

section("remaining balance and fraction", () => {
  assert.equal(remainingUsd(status(25, 5)), 20);
  assert.equal(remainingUsd(status(null, 5)), null);
  assert.equal(remainingFraction(status(100, 25)), 0.75);
  assert.equal(remainingFraction(status(null, 0)), null);
  assert.equal(remainingFraction(status(0, 0)), 0, "a zero balance has nothing left");
  assert.equal(remainingFraction(status(10, 12)), 0, "overspend never goes negative");
});

section("5% boundary: exactly 5.0% remaining is nearly out, 5.1% is not", () => {
  assert.equal(SWITCH_THRESHOLD, 0.05);
  assert.equal(isNearlyOut(status(100, 95)), true);
  assert.equal(isNearlyOut(status(100, 94.9)), false);
  assert.equal(isNearlyOut(status(25, 23.75)), true);
  assert.equal(isNearlyOut(status(100, 0)), false);
});

section("unknown balance never triggers; zero balance and a depleted flag do", () => {
  assert.equal(isNearlyOut(status(null, 999)), false);
  assert.equal(isNearlyOut(status(0, 0)), true);
  assert.equal(isNearlyOut(status(null, 0, true)), true, "a depleted marker counts even with no balance");
});

section("mode needs BOTH providers nearly out", () => {
  const low = status(100, 96);
  const healthy = status(100, 10);
  assert.equal(decideMode(low, low), "claude");
  assert.equal(decideMode(low, healthy), "credits");
  assert.equal(decideMode(healthy, low), "credits");
  assert.equal(decideMode(status(null, 0), low), "credits", "unknown balance blocks the early switch");
  assert.equal(decideMode(status(null, 0, true), status(null, 0, true)), "claude");
});

section("exhausted vs nearly out, and per-provider skip flags (Gemini at $0, Perplexity healthy)", () => {
  assert.equal(isExhausted(status(100, 96)), false);
  assert.equal(isExhausted(status(100, 100)), true);
  assert.equal(isExhausted(status(0, 0)), true);
  assert.equal(isExhausted(status(null, 0)), false);
  assert.equal(isExhausted(status(null, 0, true)), true);

  const geminiOut = status(0, 0);
  const perplexityOk = status(8.94, 0);
  assert.deepEqual(providerFlags(geminiOut, perplexityOk, "classifier", true), {
    gemini: true,
    perplexity: false,
  });
  assert.deepEqual(
    providerFlags(status(100, 98), perplexityOk, "agent", true),
    { gemini: true, perplexity: false },
    "2% left: text jobs already skip Gemini"
  );
  assert.deepEqual(
    providerFlags(status(100, 98), perplexityOk, "audio", true),
    { gemini: false, perplexity: false },
    "voice keeps using Gemini until it is truly exhausted"
  );
  assert.deepEqual(providerFlags(geminiOut, perplexityOk, "audio", true), { gemini: true, perplexity: false });
  assert.deepEqual(
    providerFlags(status(100, 98), status(10, 9.8), "search", false),
    { gemini: false, perplexity: false },
    "no Claude key: only real depletion skips a provider"
  );
  assert.deepEqual(providerFlags(status(null, 0, true), perplexityOk, "agent", false), {
    gemini: true,
    perplexity: false,
  });
});

section("error classification", () => {
  assert.equal(classifyError({ statusCode: 402 }), "depleted");
  assert.equal(
    classifyError({ statusCode: 429, message: "Your prepayment credits are depleted" }),
    "depleted"
  );
  assert.equal(classifyError({ statusCode: 429, message: "insufficient credits on this key" }), "depleted");
  assert.equal(classifyError({ statusCode: 403, message: "billing account disabled" }), "depleted");
  assert.equal(
    classifyError({
      statusCode: 429,
      message: "You exceeded your current quota, please check your plan and billing details. Please retry in 21s",
    }),
    "transient",
    "a per-minute quota blip must not look like depletion"
  );
  assert.equal(
    classifyError({ statusCode: 429, message: "Quota exceeded for metric requests per minute" }),
    "transient"
  );
  assert.equal(classifyError({ statusCode: 429, message: "slow down" }), "transient");
  assert.equal(classifyError({ statusCode: 500 }), "transient");
  assert.equal(classifyError({ statusCode: 400, message: "bad request" }), "other");
  assert.equal(classifyError({ statusCode: 401, message: "invalid api key" }), "other");
  assert.equal(classifyError(new Error("fetch failed")), "transient");
  assert.equal(classifyError(new Error("Perplexity: insufficient credits")), "depleted");
  assert.equal(
    classifyError({
      message: "Failed after 3 attempts",
      lastError: { statusCode: 429, message: "Your prepayment credits are depleted" },
    }),
    "depleted",
    "wrapped retry errors are unwrapped"
  );
  assert.equal(classifyError(undefined), "other");
});

section("Claude tier chains follow Haiku, Sonnet, Opus by job", () => {
  const ids = (role: Parameters<typeof claudeChain>[0]) => claudeChain(role).map((c) => c.modelId);
  assert.deepEqual(ids("classifier"), ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"]);
  assert.deepEqual(ids("parse"), ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"]);
  assert.deepEqual(ids("agent"), ["claude-sonnet-5-5", "claude-opus-5-5"]);
  assert.deepEqual(ids("vision"), ["claude-sonnet-5-5", "claude-opus-5-5"]);
  assert.deepEqual(ids("search"), ["claude-sonnet-5-5", "claude-opus-5-5"]);
  assert.deepEqual(ids("audio"), []);
  assert.ok(claudeChain("agent").every((c) => c.provider === "anthropic"));
});

section("candidates: credits mode uses Gemini/Perplexity first and Claude as the tail", () => {
  const classifier = candidatesFor("classifier", "credits", NONE_DEPLETED, ALL).map((c) => c.modelId);
  assert.deepEqual(classifier, [
    "gemini-flash-lite-latest",
    "gemini-3.6-flash",
    "claude-haiku-5-5",
    "claude-sonnet-5-5",
    "claude-opus-5-5",
  ]);
  const search = candidatesFor("search", "credits", NONE_DEPLETED, ALL).map((c) => c.modelId);
  assert.deepEqual(search, ["sonar", "gemini-3.6-flash", "claude-sonnet-5-5", "claude-opus-5-5"]);
});

section("candidates: claude mode skips Gemini/Perplexity except for audio", () => {
  const agent = candidatesFor("agent", "claude", NONE_DEPLETED, ALL).map((c) => c.modelId);
  assert.deepEqual(agent, ["claude-sonnet-5-5", "claude-opus-5-5"]);
  const audio = candidatesFor("audio", "claude", NONE_DEPLETED, ALL).map((c) => c.modelId);
  assert.deepEqual(audio, ["gemini-3.6-flash"]);
});

section("candidates: a skipped provider is dropped; missing keys are filtered", () => {
  const search = candidatesFor("search", "credits", { gemini: false, perplexity: true }, ALL).map((c) => c.modelId);
  assert.deepEqual(search, ["gemini-3.6-flash", "claude-sonnet-5-5", "claude-opus-5-5"]);
  const noClaudeKey = candidatesFor("agent", "credits", NONE_DEPLETED, { ...ALL, anthropic: false }).map(
    (c) => c.modelId
  );
  assert.deepEqual(noClaudeKey, ["gemini-3.6-flash"], "no Claude key means no Claude candidates");
  const audioDepleted = candidatesFor("audio", "credits", { gemini: true, perplexity: false }, ALL);
  assert.deepEqual(audioDepleted, [], "audio has no fallback when Gemini is out");
  const noClaudeInClaudeMode = candidatesFor("agent", "claude", NONE_DEPLETED, { ...ALL, anthropic: false });
  assert.ok(noClaudeInClaudeMode.length > 0, "claude mode without a key falls back to the primaries");
});

section("pricing", () => {
  assert.equal(costUsd("claude-haiku-5-5", 1_000_000, 1_000_000), 0.6);
  assert.equal(costUsd("claude-sonnet-5-5", 1_000_000, 0), 2);
  assert.equal(costUsd("claude-opus-5-5", 0, 1_000_000), 20);
  assert.equal(costUsd("gemini-3.6-flash", 1_000_000, 1_000_000), 4.5);
  assert.equal(costUsd("sonar", 0, 0), PERPLEXITY_REQUEST_FEE_USD, "Sonar adds its per-request fee");
  assert.ok(costUsd("some-future-model", 1_000_000, 1_000_000) > 0, "unknown models use a conservative price");
  assert.equal(costUsd("claude-haiku-5-5", 0, 0), 0);
});

// ---- runner ----
async function main() {
  console.log("\n  🧠 AI Router Tests\n");
  for (const s of sections) {
    await s.run();
    console.log(`  ✅ ${s.name}`);
  }
  console.log("\n  🎉 All AI router tests passed!\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
