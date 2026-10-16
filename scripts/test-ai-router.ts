import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { CREDITS_USAGE, parseCreditsCommand } from "../lib/ai/commands";
import {
  ALERT_COOLDOWN_MS,
  STATE_TTL_MS,
  createLedger,
  sumSpent,
  type AlertState,
  type BalanceRow,
  type CreditProvider,
  type LedgerStore,
  type UsageRow,
} from "../lib/ai/ledger";
import {
  candidatesFor,
  claudeChain,
  classifyError,
  isMoreSevere,
  remainingFraction,
  remainingUsd,
  warningLevel,
  type BalanceStatus,
  type Provider,
} from "../lib/ai/mode";
import { PERPLEXITY_REQUEST_FEE_USD, costUsd } from "../lib/ai/pricing";
import {
  CLAUDE_MIN_OUTPUT_TOKENS,
  NoModelAvailableError,
  PERPLEXITY_COOLDOWN_MS,
  buildHandle,
  createRouter,
  mergeProviderOptions,
  type RouterDeps,
} from "../lib/ai/router";
import { needsLayoutMigration } from "../lib/ai/sheets-store";
import { NO_WEB_FOOTER, searchSystemPrompt } from "../lib/search";

const sections: Array<{ name: string; run: () => void | Promise<void> }> = [];
function section(name: string, run: () => void | Promise<void>) {
  sections.push({ name, run });
}

const status = (start: number | null, spent: number): BalanceStatus => ({
  startBalanceUsd: start,
  spentUsd: spent,
});
const ALL = { anthropic: true, perplexity: true, gemini: true };

// ---- sections ----

section("remaining balance and fraction", () => {
  assert.equal(remainingUsd(status(25, 5)), 20);
  assert.equal(remainingUsd(status(null, 5)), null);
  assert.equal(remainingFraction(status(100, 25)), 0.75);
  assert.equal(remainingFraction(status(null, 0)), null);
  assert.equal(remainingFraction(status(0, 0)), 0, "a zero balance has nothing left");
  assert.equal(remainingFraction(status(10, 12)), 0, "overspend never goes negative");
});

section("warning levels: exactly 10% and 5% fire, 10.1% and 5.1% do not", () => {
  assert.equal(warningLevel(status(100, 89.9)), 0);
  assert.equal(warningLevel(status(100, 90)), 10);
  assert.equal(warningLevel(status(100, 94.9)), 10);
  assert.equal(warningLevel(status(100, 95)), 5);
  assert.equal(warningLevel(status(100, 100)), 5);
  assert.equal(warningLevel(status(0, 0)), 5, "a zero balance is fully used up");
  assert.equal(warningLevel(status(null, 999)), 0, "an unknown balance never warns");
  assert.equal(isMoreSevere(5, 10), true);
  assert.equal(isMoreSevere(10, 0), true);
  assert.equal(isMoreSevere(10, 10), false);
  assert.equal(isMoreSevere(0, 5), false);
  assert.equal(isMoreSevere(10, 5), false);
});

section("error classification", () => {
  assert.equal(classifyError({ statusCode: 402 }), "depleted");
  assert.equal(
    classifyError({ statusCode: 429, message: "Your prepayment credits are depleted" }),
    "depleted"
  );
  assert.equal(classifyError({ statusCode: 429, message: "insufficient credits on this key" }), "depleted");
  assert.equal(
    classifyError(
      Object.assign(new Error("Your credit balance is too low to access the Anthropic API."), { statusCode: 400 })
    ),
    "depleted"
  );
  assert.equal(
    classifyError({
      statusCode: 429,
      message: "You exceeded your current quota, please check your plan and billing details. Please retry in 21s",
    }),
    "transient",
    "a per-minute quota blip must not look like depletion"
  );
  assert.equal(classifyError({ statusCode: 429, message: "slow down" }), "transient");
  assert.equal(classifyError({ statusCode: 500 }), "transient");
  assert.equal(classifyError({ statusCode: 400, message: "bad request" }), "other");
  assert.equal(classifyError({ statusCode: 401, message: "invalid x-api-key" }), "other");
  assert.equal(classifyError(new Error("fetch failed")), "transient");
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
  assert.deepEqual(ids("audio"), [], "Claude cannot take audio");
  assert.ok(claudeChain("agent").every((c) => c.provider === "anthropic"));
});

section("candidates: Claude for text, Perplexity first for search, Gemini only for audio", () => {
  const ids = (role: Parameters<typeof claudeChain>[0], perplexityDown = false, available = ALL) =>
    candidatesFor(role, available, perplexityDown).map((c) => c.modelId);
  assert.deepEqual(ids("classifier"), ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"]);
  assert.deepEqual(ids("agent"), ["claude-sonnet-5-5", "claude-opus-5-5"]);
  assert.deepEqual(ids("search"), ["sonar", "claude-sonnet-5-5", "claude-opus-5-5"]);
  assert.deepEqual(ids("search", true), ["claude-sonnet-5-5", "claude-opus-5-5"], "breaker open");
  assert.deepEqual(ids("search", false, { ...ALL, perplexity: false }), ["claude-sonnet-5-5", "claude-opus-5-5"]);
  assert.deepEqual(ids("classifier", false, { ...ALL, anthropic: false }), [], "no Claude key, no candidates");
  assert.deepEqual(ids("search", false, { ...ALL, anthropic: false }), ["sonar"], "search can still reach Perplexity");
  assert.deepEqual(ids("audio"), ["gemini-3.6-flash"]);
  assert.deepEqual(ids("audio", false, { ...ALL, gemini: false }), [], "audio never falls to Claude");
  for (const role of ["classifier", "parse", "agent", "vision", "search"] as const) {
    assert.ok(!ids(role).some((id) => id.startsWith("gemini")), `${role} must not use Gemini`);
  }
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
  const alerts: Record<CreditProvider, AlertState> = {
    anthropic: { warnedLevel: 0 },
    perplexity: { warnedLevel: 0 },
  };
  const calls = { readUsage: 0, appendUsage: 0 };
  let failAppend = false;
  const store: LedgerStore = {
    readBalances: async () => ({ ...balances }),
    readUsage: async () => {
      calls.readUsage += 1;
      return [...usage];
    },
    readAlertState: async () => ({
      anthropic: { ...alerts.anthropic },
      perplexity: { ...alerts.perplexity },
    }),
    setBalance: async (p, usd, setAt) => {
      balances[p] = { startBalanceUsd: usd, setAt };
      alerts[p] = { warnedLevel: 0 };
    },
    setWarnedLevel: async (p, level) => {
      alerts[p].warnedLevel = level;
    },
    setAlertedAt: async (p, iso) => {
      alerts[p].alertedAt = iso;
    },
    appendUsage: async (row) => {
      calls.appendUsage += 1;
      if (failAppend) throw new Error("sheets down");
      usage.push(row);
    },
  };
  return { store, balances, usage, alerts, calls, failAppends: (v: boolean) => (failAppend = v) };
}

function clock(startIso: string) {
  let t = new Date(startIso).getTime();
  return {
    now: () => new Date(t),
    advance: (ms: number) => (t += ms),
    iso: () => new Date(t).toISOString(),
  };
}

const row = (provider: UsageRow["provider"], cost: number, timestamp: string): UsageRow => ({
  timestamp,
  provider,
  model: "m",
  inputTokens: 1,
  outputTokens: 1,
  costUsd: cost,
  role: "agent",
});

function ledgerHarness() {
  const m = memoryStore();
  const c = clock("2026-10-17T00:00:00.000Z");
  const notes: string[] = [];
  const ledger = createLedger({ store: m.store, now: c.now, notify: async (t) => void notes.push(t) });
  return { m, c, notes, ledger };
}

section("sumSpent counts only the provider's spend since the balance was set", () => {
  const rows = [
    row("anthropic", 1, "2026-10-01T00:00:00.000Z"),
    row("anthropic", 2, "2026-10-10T00:00:00.000Z"),
    row("perplexity", 5, "2026-10-10T00:00:00.000Z"),
    row("anthropic", 4, "2026-10-12T00:00:00.000Z"),
  ];
  assert.equal(sumSpent(rows, "anthropic", "2026-10-05T00:00:00.000Z"), 6);
  assert.equal(sumSpent(rows, "anthropic", ""), 7);
  assert.equal(sumSpent(rows, "gemini", ""), 0);
});

section("ledger: an unknown balance never warns", async () => {
  const h = ledgerHarness();
  await h.ledger.recordUsage(row("anthropic", 50, h.c.iso()));
  await h.ledger.checkWarnings();
  assert.equal(h.notes.length, 0);
});

section("ledger: 10% then 5% each warn exactly once", async () => {
  const h = ledgerHarness();
  await h.ledger.setBalance("anthropic", 100);
  h.c.advance(1000);
  await h.ledger.recordUsage(row("anthropic", 91, h.c.iso()));
  h.c.advance(STATE_TTL_MS + 1);
  await h.ledger.checkWarnings();
  assert.equal(h.notes.length, 1);
  assert.match(h.notes[0], /Claude/);
  assert.match(h.notes[0], /10%/);
  h.c.advance(STATE_TTL_MS + 1);
  await h.ledger.checkWarnings();
  assert.equal(h.notes.length, 1, "the 10% level does not repeat");

  h.c.advance(1000);
  await h.ledger.recordUsage(row("anthropic", 5, h.c.iso()));
  h.c.advance(STATE_TTL_MS + 1);
  await h.ledger.checkWarnings();
  assert.equal(h.notes.length, 2);
  assert.match(h.notes[1], /5%/);
  h.c.advance(STATE_TTL_MS + 1);
  await h.ledger.checkWarnings();
  assert.equal(h.notes.length, 2, "the 5% level does not repeat");
});

section("ledger: jumping straight to 3% sends only the 5% warning", async () => {
  const h = ledgerHarness();
  await h.ledger.setBalance("perplexity", 10);
  h.c.advance(1000);
  await h.ledger.recordUsage(row("perplexity", 9.7, h.c.iso()));
  h.c.advance(STATE_TTL_MS + 1);
  await h.ledger.checkWarnings();
  assert.equal(h.notes.length, 1);
  assert.match(h.notes[0], /Perplexity/);
  assert.match(h.notes[0], /5%/);
});

section("ledger: setting a balance re-arms both warnings", async () => {
  const h = ledgerHarness();
  await h.ledger.setBalance("anthropic", 100);
  h.c.advance(1000);
  await h.ledger.recordUsage(row("anthropic", 96, h.c.iso()));
  h.c.advance(STATE_TTL_MS + 1);
  await h.ledger.checkWarnings();
  assert.equal(h.notes.length, 1);

  h.c.advance(1000);
  await h.ledger.setBalance("anthropic", 50);
  assert.equal(h.notes.length, 1, "a healthy new balance sends nothing");
  h.c.advance(1000);
  await h.ledger.recordUsage(row("anthropic", 46, h.c.iso()));
  h.c.advance(STATE_TTL_MS + 1);
  await h.ledger.checkWarnings();
  assert.equal(h.notes.length, 2, "8% left warns again after the re-set");
  assert.match(h.notes[1], /10%/);
});

section("ledger: setting a balance of zero warns immediately", async () => {
  const h = ledgerHarness();
  await h.ledger.setBalance("perplexity", 0);
  assert.equal(h.notes.length, 1);
  assert.match(h.notes[0], /5%/);
});

section("ledger: a depletion alert is rate-limited to one per 30 minutes", async () => {
  const h = ledgerHarness();
  await h.ledger.alertDepleted("anthropic");
  assert.equal(h.notes.length, 1);
  assert.match(h.notes[0], /Claude/);
  assert.match(h.notes[0], /\/credits set claude/);
  h.c.advance(ALERT_COOLDOWN_MS - 1000);
  await h.ledger.alertDepleted("anthropic");
  assert.equal(h.notes.length, 1, "still inside the cool-down");
  h.c.advance(2000);
  await h.ledger.alertDepleted("anthropic");
  assert.equal(h.notes.length, 2);
  await h.ledger.alertDepleted("perplexity");
  assert.equal(h.notes.length, 3, "each provider has its own cool-down");
  assert.match(h.notes[2], /Perplexity/);
});

section("ledger: state is cached for a minute", async () => {
  const h = ledgerHarness();
  await h.ledger.checkWarnings();
  await h.ledger.checkWarnings();
  assert.equal(h.m.calls.readUsage, 1);
  h.c.advance(STATE_TTL_MS + 1);
  await h.ledger.checkWarnings();
  assert.equal(h.m.calls.readUsage, 2);
});

section("ledger: a failing usage write never throws", async () => {
  const h = ledgerHarness();
  h.m.failAppends(true);
  await h.ledger.recordUsage(row("anthropic", 1, h.c.iso()));
  assert.equal(h.m.calls.appendUsage, 1);
});

section("ledger: /credits text shows percent left, unset hints and the footer", async () => {
  const h = ledgerHarness();
  await h.ledger.setBalance("anthropic", 100);
  h.c.advance(1000);
  await h.ledger.recordUsage(row("anthropic", 25, h.c.iso()));
  h.c.advance(STATE_TTL_MS + 1);
  const text = await h.ledger.describe();
  assert.match(text, /Claude: about \$75\.00 left of \$100\.00 \(75\.0%\)/);
  assert.match(text, /Perplexity: balance not set/);
  assert.match(text, /\/credits set perplexity/);
  assert.match(text, /10% and 5%/);
});

section("sheet layout: the old Gemini layout is migrated, the new one is kept", () => {
  assert.equal(needsLayoutMigration("gemini"), true);
  assert.equal(needsLayoutMigration(undefined), true);
  assert.equal(needsLayoutMigration(""), true);
  assert.equal(needsLayoutMigration("anthropic"), false);
});

function routerHarness(o: {
  failOn?: Record<string, unknown>;
  available?: Partial<Record<Provider, boolean>>;
  ledgerFails?: boolean;
} = {}) {
  const generated: Array<Record<string, unknown>> = [];
  const used: UsageRow[] = [];
  const alerts: string[] = [];
  const clockMs = { t: 1_000_000 };
  let warningChecks = 0;
  const deps: RouterDeps = {
    ledger: {
      recordUsage: async (r) => {
        if (o.ledgerFails) throw new Error("sheets down");
        used.push(r);
      },
      checkWarnings: async () => {
        warningChecks += 1;
        if (o.ledgerFails) throw new Error("sheets down");
      },
      alertDepleted: async (p) => void alerts.push(p),
    },
    available: () => ({ anthropic: true, perplexity: true, gemini: true, ...(o.available ?? {}) }),
    makeModel: (c) => ({ specificationVersion: "test", provider: c.provider, modelId: c.modelId }) as never,
    generate: (async (params: Record<string, unknown>) => {
      generated.push(params);
      const modelId = (params.model as { modelId: string }).modelId;
      const failure = o.failOn?.[modelId];
      if (failure) throw failure;
      return { text: `ok from ${modelId}`, usage: { inputTokens: 1000, outputTokens: 500 } };
    }) as never,
    now: () => clockMs.t,
  };
  return { router: createRouter(deps), generated, used, alerts, clockMs, checks: () => warningChecks };
}

const modelOf = (p: Record<string, unknown>) => (p.model as { modelId: string }).modelId;
const perplexityOut = Object.assign(new Error("insufficient credits"), { statusCode: 429 });
const claudeOut = Object.assign(new Error("Your credit balance is too low to access the Anthropic API."), {
  statusCode: 400,
});

section("router: classifier uses Haiku, strips temperature, floors tokens, sets low effort", async () => {
  const h = routerHarness();
  const { handle } = await h.router.generateTextRouted("classifier", {
    prompt: "hi",
    temperature: 0,
    maxOutputTokens: 20,
  });
  assert.equal(handle.modelId, "claude-haiku-5-5");
  const params = h.generated[0];
  assert.equal("temperature" in params, false, "Claude models reject non-default sampling");
  assert.equal(params.maxOutputTokens, CLAUDE_MIN_OUTPUT_TOKENS, "always-on thinking needs headroom");
  assert.equal((params.providerOptions as { anthropic: { effort: string } }).anthropic.effort, "low");
});

section("router: agent role starts at Sonnet without forced effort", async () => {
  const h = routerHarness();
  const { handle } = await h.router.generateTextRouted("agent", { prompt: "hi" });
  assert.equal(handle.modelId, "claude-sonnet-5-5");
  assert.equal(h.generated[0].providerOptions, undefined);
});

section("router: search goes to Perplexity first and keeps its temperature", async () => {
  const h = routerHarness();
  const { handle } = await h.router.generateTextRouted("search", {
    prompt: "q",
    temperature: 0.2,
    maxOutputTokens: 500,
  });
  assert.equal(handle.modelId, "sonar");
  assert.equal(h.generated[0].temperature, 0.2);
  assert.equal(h.generated[0].maxOutputTokens, 500);
});

section("router: audio uses Gemini only, keeps temperature, and is logged as Gemini", async () => {
  const h = routerHarness();
  const { handle } = await h.router.generateTextRouted("audio", {
    prompt: "x",
    temperature: 0,
    maxOutputTokens: 500,
  });
  assert.equal(handle.modelId, "gemini-3.6-flash");
  assert.equal(h.generated[0].temperature, 0);
  assert.equal(h.generated[0].maxOutputTokens, 500);
  assert.equal(h.used[0].provider, "gemini");
  assert.equal(h.used[0].role, "audio");
});

section("router: when Gemini fails, audio fails loudly instead of going to Claude (no alert for Gemini)", async () => {
  const h = routerHarness({ failOn: { "gemini-3.6-flash": perplexityOut } });
  await assert.rejects(() => h.router.generateTextRouted("audio", { prompt: "x" }), /credits/);
  assert.deepEqual(h.generated.map(modelOf), ["gemini-3.6-flash"], "Claude is never tried for audio");
  assert.deepEqual(h.alerts, [], "Gemini credits are not tracked, so no alert");

  const noKey = routerHarness({ available: { gemini: false } });
  await assert.rejects(
    () => noKey.router.generateTextRouted("audio", { prompt: "x" }),
    (err: unknown) => err instanceof NoModelAvailableError
  );
});

section("router: Perplexity depletion falls to Claude, alerts once, and opens a 30-minute breaker", async () => {
  const h = routerHarness({ failOn: { sonar: perplexityOut } });
  const first = await h.router.generateTextRouted("search", { prompt: "q" });
  assert.equal(first.handle.modelId, "claude-sonnet-5-5");
  assert.deepEqual(h.alerts, ["perplexity"]);
  assert.deepEqual(h.generated.map(modelOf), ["sonar", "claude-sonnet-5-5"]);

  await h.router.generateTextRouted("search", { prompt: "q2" });
  assert.deepEqual(
    h.generated.map(modelOf),
    ["sonar", "claude-sonnet-5-5", "claude-sonnet-5-5"],
    "no second call to Perplexity while the breaker is open"
  );

  h.clockMs.t += PERPLEXITY_COOLDOWN_MS + 1;
  await h.router.generateTextRouted("search", { prompt: "q3" });
  assert.equal(modelOf(h.generated[3]), "sonar", "Perplexity is probed again after the cool-down");
});

section("router: a transient Perplexity error falls to Claude without opening the breaker", async () => {
  const h = routerHarness({ failOn: { sonar: { statusCode: 500 } } });
  const first = await h.router.generateTextRouted("search", { prompt: "q" });
  assert.equal(first.handle.modelId, "claude-sonnet-5-5");
  assert.deepEqual(h.alerts, []);
  await h.router.generateTextRouted("search", { prompt: "q2" });
  assert.equal(modelOf(h.generated[2]), "sonar", "Perplexity is tried again right away");
});

section("router: Claude tiers escalate Haiku to Sonnet to Opus, then the last error is thrown", async () => {
  const boom = Object.assign(new Error("bad"), { statusCode: 400 });
  const h = routerHarness({ failOn: { "claude-haiku-5-5": boom, "claude-sonnet-5-5": boom } });
  const { handle } = await h.router.generateTextRouted("classifier", { prompt: "hi" });
  assert.equal(handle.modelId, "claude-opus-5-5");

  const all = routerHarness({
    failOn: { "claude-haiku-5-5": boom, "claude-sonnet-5-5": boom, "claude-opus-5-5": boom },
  });
  await assert.rejects(() => all.router.generateTextRouted("classifier", { prompt: "hi" }), /bad/);
});

section("router: Claude out of credit alerts the user, stops escalating and throws", async () => {
  const h = routerHarness({ failOn: { "claude-haiku-5-5": claudeOut } });
  await assert.rejects(
    () => h.router.generateTextRouted("classifier", { prompt: "hi" }),
    /credit balance is too low/
  );
  assert.deepEqual(h.alerts, ["anthropic"]);
  assert.deepEqual(h.generated.map(modelOf), ["claude-haiku-5-5"], "Sonnet and Opus are not tried");
});

section("router: no retry once canRetry says a tool already ran", async () => {
  const h = routerHarness({ failOn: { "claude-sonnet-5-5": { statusCode: 500 } } });
  await assert.rejects(
    () =>
      h.router.withModelFallback("agent", async (handle) => h.router.runText(handle, { prompt: "hi" }), {
        canRetry: () => false,
      }),
    (err: unknown) => (err as { statusCode?: number }).statusCode === 500
  );
  assert.equal(h.generated.length, 1, "no second model was tried");
});

section("router: no Claude key means no model for Claude roles", async () => {
  const h = routerHarness({ available: { anthropic: false } });
  await assert.rejects(
    () => h.router.generateTextRouted("classifier", { prompt: "hi" }),
    (err: unknown) => err instanceof NoModelAvailableError
  );
  const search = await h.router.generateTextRouted("search", { prompt: "q" });
  assert.equal(search.handle.modelId, "sonar");
});

section("router: records usage with the computed cost and checks warnings after each call", async () => {
  const h = routerHarness();
  await h.router.generateTextRouted("agent", { prompt: "hi" });
  assert.equal(h.used.length, 1);
  assert.equal(h.used[0].provider, "anthropic");
  assert.equal(h.used[0].model, "claude-sonnet-5-5");
  assert.equal(h.used[0].inputTokens, 1000);
  assert.equal(h.used[0].outputTokens, 500);
  assert.ok(Math.abs(h.used[0].costUsd - (1000 / 1e6) * 2 - (500 / 1e6) * 10) < 1e-12);
  assert.equal(h.used[0].role, "agent");
  assert.equal(h.checks(), 1);
});

section("router: ledger failures never break a model call", async () => {
  const h = routerHarness({ ledgerFails: true });
  const { result } = await h.router.generateTextRouted("agent", { prompt: "hi" });
  assert.equal((result as { text: string }).text, "ok from claude-sonnet-5-5");
});

section("handle and provider-option helpers", () => {
  const claudeHandle = buildHandle({ provider: "anthropic", modelId: "claude-haiku-5-5" }, "parse", () => ({}) as never);
  assert.deepEqual(claudeHandle.sampling(0), {});
  assert.equal(claudeHandle.isClaude, true);
  const sonarHandle = buildHandle({ provider: "perplexity", modelId: "sonar" }, "search", () => ({}) as never);
  assert.deepEqual(sonarHandle.sampling(0.2), { temperature: 0.2 });
  assert.equal(sonarHandle.providerOptions, undefined);
  assert.deepEqual(mergeProviderOptions({ anthropic: { a: 1 } }, { anthropic: { b: 2 }, other: { c: 3 } }), {
    anthropic: { a: 1, b: 2 },
    other: { c: 3 },
  });
  assert.equal(mergeProviderOptions(undefined, undefined), undefined);
});

section("/credits parsing: Claude and Perplexity only", () => {
  assert.equal(parseCreditsCommand("hello"), null);
  assert.equal(parseCreditsCommand("/creditsx"), null);
  assert.equal(parseCreditsCommand("/todo"), null);
  assert.deepEqual(parseCreditsCommand("/credits"), { kind: "show" });
  assert.deepEqual(parseCreditsCommand("/credits@ego_bot"), { kind: "show" });
  assert.deepEqual(parseCreditsCommand("/credits set claude 20"), {
    kind: "set",
    provider: "anthropic",
    amountUsd: 20,
  });
  assert.deepEqual(parseCreditsCommand("/credits set Anthropic $12.5"), {
    kind: "set",
    provider: "anthropic",
    amountUsd: 12.5,
  });
  assert.deepEqual(parseCreditsCommand("/credits set perplexity 8.94"), {
    kind: "set",
    provider: "perplexity",
    amountUsd: 8.94,
  });
  assert.deepEqual(parseCreditsCommand("/credits set claude 0"), {
    kind: "set",
    provider: "anthropic",
    amountUsd: 0,
  });
  for (const bad of [
    "/credits set",
    "/credits set claude",
    "/credits set claude abc",
    "/credits set claude -5",
    "/credits set gemini 5",
    "/credits nonsense",
  ]) {
    assert.deepEqual(parseCreditsCommand(bad), { kind: "usage_error", message: CREDITS_USAGE }, bad);
  }
});

section("search prompts: Perplexity answers with the web, Claude says it cannot browse", () => {
  assert.match(searchSystemPrompt("perplexity"), /3-4 sentences/);
  assert.match(searchSystemPrompt("anthropic"), /cannot browse/i);
  assert.match(NO_WEB_FOOTER, /no live web data/i);
});

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx|mjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

section("no file outside the router picks a Claude, Perplexity or Gemini model directly", () => {
  const root = process.cwd();
  const offenders: string[] = [];
  for (const dir of ["app", "lib"]) {
    for (const file of sourceFiles(path.join(root, dir))) {
      const rel = path.relative(root, file);
      if (rel === "lib/ai/router.ts") continue;
      if (/\b(anthropic|perplexity|google)\(\s*["'`]/.test(fs.readFileSync(file, "utf8"))) offenders.push(rel);
    }
  }
  assert.deepEqual(offenders, [], "route model calls through lib/ai/router");
});

/**
 * Gemini is kept for exactly one job, voice-note transcription, which Claude cannot do.
 * scripts/ai-live-check.ts only sets `gemini: false` because the provider type needs the key.
 */
const GEMINI_ALLOWED_IN = [
  "lib/voice-transcribe.ts",
  "lib/ai/mode.ts",
  "lib/ai/pricing.ts",
  "lib/ai/router.ts",
  "scripts/ai-live-check.ts",
];

section("Gemini appears only in the voice and routing files", () => {
  const root = process.cwd();
  const self = path.join(root, "scripts/test-ai-router.ts");
  const targets = ["app", "lib", "scripts"].flatMap((dir) => sourceFiles(path.join(root, dir)));
  const offenders = targets
    .filter((f) => f !== self)
    .filter((f) => !GEMINI_ALLOWED_IN.includes(path.relative(root, f)))
    .filter((f) => /gemini|@ai-sdk\/google|GOOGLE_GENERATIVE_AI/i.test(fs.readFileSync(f, "utf8")))
    .map((f) => path.relative(root, f));
  assert.deepEqual(offenders, [], "Gemini is only for voice transcription; everything else uses Claude");
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
