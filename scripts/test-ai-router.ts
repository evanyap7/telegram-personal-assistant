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
import {
  DEPLETED_COOLDOWN_MS,
  STATE_TTL_MS,
  createLedger,
  sumSpent,
  type BalanceRow,
  type CreditProvider,
  type LedgerMeta,
  type LedgerStore,
  type UsageRow,
} from "../lib/ai/ledger";

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

function memoryStore() {
  const balances: Partial<Record<CreditProvider, BalanceRow>> = {};
  const usage: UsageRow[] = [];
  const meta: LedgerMeta = { announcedMode: "credits", depletedUntil: {} };
  const calls = { readUsage: 0, appendUsage: 0 };
  let failAppend = false;
  const store: LedgerStore = {
    readBalances: async () => ({ ...balances }),
    readUsage: async () => {
      calls.readUsage += 1;
      return [...usage];
    },
    readMeta: async () => ({ announcedMode: meta.announcedMode, depletedUntil: { ...meta.depletedUntil } }),
    setBalance: async (p, usd, setAt) => {
      balances[p] = { startBalanceUsd: usd, setAt };
      delete meta.depletedUntil[p];
    },
    setDepletedUntil: async (p, until) => {
      meta.depletedUntil[p] = until;
    },
    writeAnnouncedMode: async (m) => {
      meta.announcedMode = m;
    },
    appendUsage: async (row) => {
      calls.appendUsage += 1;
      if (failAppend) throw new Error("sheets down");
      usage.push(row);
    },
  };
  return { store, balances, usage, meta, calls, failAppends: (v: boolean) => (failAppend = v) };
}

function clock(startIso: string) {
  let t = new Date(startIso).getTime();
  return { now: () => new Date(t), advance: (ms: number) => (t += ms) };
}

const row = (provider: UsageRow["provider"], costUsd: number, timestamp: string): UsageRow => ({
  timestamp,
  provider,
  model: "m",
  inputTokens: 1,
  outputTokens: 1,
  costUsd,
  role: "agent",
});

section("sumSpent counts only the provider's spend since the balance was set", () => {
  const rows = [
    row("gemini", 1, "2026-10-01T00:00:00.000Z"),
    row("gemini", 2, "2026-10-10T00:00:00.000Z"),
    row("perplexity", 5, "2026-10-10T00:00:00.000Z"),
    row("gemini", 4, "2026-10-12T00:00:00.000Z"),
  ];
  assert.equal(sumSpent(rows, "gemini", "2026-10-05T00:00:00.000Z"), 6);
  assert.equal(sumSpent(rows, "gemini", ""), 7);
  assert.equal(sumSpent(rows, "anthropic", ""), 0);
});

section("ledger: unknown balances stay in credits mode with no notice", async () => {
  const m = memoryStore();
  const notes: string[] = [];
  const c = clock("2026-10-16T00:00:00.000Z");
  const ledger = createLedger({ store: m.store, now: c.now, notify: async (t) => void notes.push(t) });
  const state = await ledger.getState();
  assert.equal(state.mode, "credits");
  assert.equal(state.gemini.startBalanceUsd, null);
  assert.equal(notes.length, 0);
});

section("ledger: both providers at 5% switches to claude and announces exactly once", async () => {
  const m = memoryStore();
  const notes: string[] = [];
  const c = clock("2026-10-16T00:00:00.000Z");
  const ledger = createLedger({ store: m.store, now: c.now, notify: async (t) => void notes.push(t) });
  await ledger.setBalance("gemini", 100);
  await ledger.setBalance("perplexity", 10);
  await ledger.recordUsage(row("gemini", 95.5, "2026-10-16T00:00:01.000Z"));
  await ledger.recordUsage(row("perplexity", 9.6, "2026-10-16T00:00:02.000Z"));
  c.advance(STATE_TTL_MS + 1);
  const state = await ledger.getState();
  assert.equal(state.mode, "claude");
  assert.equal(notes.length, 1);
  assert.match(notes[0], /Claude/);
  c.advance(STATE_TTL_MS + 1);
  await ledger.getState();
  assert.equal(notes.length, 1, "no repeat notice while the mode stays the same");
  assert.equal(m.meta.announcedMode, "claude");
});

section("ledger: only one provider low keeps credits mode", async () => {
  const m = memoryStore();
  const c = clock("2026-10-16T00:00:00.000Z");
  const ledger = createLedger({ store: m.store, now: c.now, notify: async () => {} });
  await ledger.setBalance("gemini", 100);
  await ledger.setBalance("perplexity", 10);
  await ledger.recordUsage(row("gemini", 99, "2026-10-16T00:00:01.000Z"));
  c.advance(STATE_TTL_MS + 1);
  assert.equal((await ledger.getState()).mode, "credits");
});

section("ledger: a Gemini balance of zero is reported while Perplexity stays healthy", async () => {
  const m = memoryStore();
  const c = clock("2026-10-16T00:00:00.000Z");
  const ledger = createLedger({ store: m.store, now: c.now, notify: async () => {} });
  await ledger.setBalance("gemini", 0);
  await ledger.setBalance("perplexity", 8.94);
  const state = await ledger.getState();
  assert.equal(state.mode, "credits");
  assert.equal(state.gemini.startBalanceUsd, 0);
  assert.equal(state.perplexity.startBalanceUsd, 8.94);
});

section("ledger: a top-up restarts counting and switches back with one notice", async () => {
  const m = memoryStore();
  const notes: string[] = [];
  const c = clock("2026-10-16T00:00:00.000Z");
  const ledger = createLedger({ store: m.store, now: c.now, notify: async (t) => void notes.push(t) });
  await ledger.setBalance("gemini", 100);
  await ledger.setBalance("perplexity", 10);
  await ledger.recordUsage(row("gemini", 98, "2026-10-16T00:00:01.000Z"));
  await ledger.recordUsage(row("perplexity", 9.9, "2026-10-16T00:00:02.000Z"));
  c.advance(STATE_TTL_MS + 1);
  assert.equal((await ledger.getState()).mode, "claude");
  c.advance(1000);
  await ledger.setBalance("gemini", 50);
  const after = await ledger.getState();
  assert.equal(after.gemini.spentUsd, 0, "spend before the new balance does not count");
  assert.equal(after.mode, "credits");
  assert.equal(notes.length, 2);
  assert.match(notes[1], /topped up|back on Gemini/i);
});

section("ledger: depletion marker notifies once, lasts 30 minutes, then lapses", async () => {
  const m = memoryStore();
  const notes: string[] = [];
  const c = clock("2026-10-16T00:00:00.000Z");
  const ledger = createLedger({ store: m.store, now: c.now, notify: async (t) => void notes.push(t) });
  await ledger.markDepleted("gemini");
  assert.equal(notes.length, 1);
  assert.match(notes[0], /Gemini/);
  assert.equal((await ledger.getState()).gemini.depleted, true);
  await ledger.markDepleted("gemini");
  assert.equal(notes.length, 1, "already marked, so no second notice");
  c.advance(DEPLETED_COOLDOWN_MS + 1000);
  assert.equal((await ledger.getState()).gemini.depleted, false);
});

section("ledger: state is cached for a minute", async () => {
  const m = memoryStore();
  const c = clock("2026-10-16T00:00:00.000Z");
  const ledger = createLedger({ store: m.store, now: c.now, notify: async () => {} });
  await ledger.getState();
  await ledger.getState();
  assert.equal(m.calls.readUsage, 1);
  c.advance(STATE_TTL_MS + 1);
  await ledger.getState();
  assert.equal(m.calls.readUsage, 2);
});

section("ledger: a failing usage write never throws", async () => {
  const m = memoryStore();
  const c = clock("2026-10-16T00:00:00.000Z");
  const ledger = createLedger({ store: m.store, now: c.now, notify: async () => {} });
  m.failAppends(true);
  await ledger.recordUsage(row("gemini", 1, "2026-10-16T00:00:01.000Z"));
  assert.equal(m.calls.appendUsage, 1);
});

section("ledger: /credits text shows percent left, unset hints and Claude spend", async () => {
  const m = memoryStore();
  const c = clock("2026-10-16T00:00:00.000Z");
  const ledger = createLedger({ store: m.store, now: c.now, notify: async () => {} });
  await ledger.setBalance("gemini", 100);
  await ledger.recordUsage(row("gemini", 25, "2026-10-16T00:00:01.000Z"));
  await ledger.recordUsage(row("anthropic", 1.5, "2026-10-16T00:00:02.000Z"));
  c.advance(STATE_TTL_MS + 1);
  const text = await ledger.describe();
  assert.match(text, /Gemini: about \$75\.00 left of \$100\.00 \(75\.0%\)/);
  assert.match(text, /Perplexity: balance not set/);
  assert.match(text, /\/credits set perplexity/);
  assert.match(text, /Claude spend so far: \$1\.50/);
  assert.match(text, /5%/);
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
