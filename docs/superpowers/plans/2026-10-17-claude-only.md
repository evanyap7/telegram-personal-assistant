# Claude-Only EGO Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove Gemini completely. Every model call runs on Claude (Haiku, then Sonnet, then Opus); Perplexity stays for web search; OpenAI speech-to-text replaces Gemini for voice notes; a slimmed `/credits` warns at 10% and 5% left for Claude and Perplexity.

**Architecture:** `lib/ai/` shrinks to a Claude tier router: `mode.ts` (pure: tier chains, candidates, error classification, warning levels), `pricing.ts`, `ledger.ts` (+ `sheets-store.ts`: balances, usage log, low-balance warnings, depletion alerts), `router.ts` (fallback across Claude tiers, Perplexity search with a 30-minute breaker, usage recording), `transcribe.ts` (OpenAI speech-to-text), `commands.ts` (`/credits`). All call sites already use the router; this plan changes its internals, replaces the voice path, and removes every Gemini reference.

**Tech Stack:** Next.js 16, TypeScript, Vercel AI SDK v7 (`ai`, including `transcribe`), `@ai-sdk/anthropic`, `@ai-sdk/perplexity`, `@ai-sdk/openai` (new), Google Sheets API (existing), Node `--experimental-strip-types` tests.

**Spec:** `docs/superpowers/specs/2026-10-16-claude-only-design.md`

## Global Constraints

- Work happens directly on `main` (user decision). Commits are conventional and carry NO `Co-Authored-By` trailer. `main` is already 7 commits ahead of `origin/main` with the earlier router work; do NOT push, merge elsewhere or deploy unless the user asks.
- Claude model IDs are exactly `claude-haiku-5-5`, `claude-sonnet-5-5`, `claude-opus-5-5`. Never send `temperature` to Claude; floor `maxOutputTokens` at 4096 (already verified live on 2026-10-17).
- Warning levels are 10% and 5% of the balance remaining, one Telegram message per level until the balance is re-set.
- Never print, log or commit any API key. Do not edit `.env.local` (the user manages secrets and removes `GOOGLE_GENERATIVE_AI_API_KEY` themselves). `ANTHROPIC_API_KEY` and `PERPLEXITY_API_KEY` are valid; `OPENAI_API_KEY` does not exist yet, so any live speech-to-text step is blocked until the user adds it.
- Tests run with `node --experimental-strip-types`: type-only imports MUST use `import type`, no enums, no constructor parameter properties. Inside `lib/ai/`, import siblings relatively.
- `@ai-sdk/anthropic` and `@ai-sdk/openai` bundle newer copies of `@ai-sdk/provider` than the other packages, so their model objects need an `as never` / `as unknown as LanguageModel` cast (same v4 spec at runtime; proven live for Anthropic).
- Live runs go through the real router, whose default ledger writes usage rows to the user's real spreadsheet. That is accepted (accurate cost records), but never write test balances to it.
- Test commands run from the repo root (`/Users/evanyap7/telegram-personal-assistant`).

## AMENDMENT (user, 2026-10-17): voice stays on Google (Gemini audio)

The user chose to keep Google for voice-note transcription ("stick to google for TTS"). Effects, which override the task text below wherever they conflict:

- **Task 2 is removed.** No OpenAI, no `@ai-sdk/openai`, no `lib/ai/transcribe.ts`, no `scripts/stt-live-check.ts`, no `check:stt-live`, no `OPENAI_API_KEY`. `lib/voice-transcribe.ts` keeps its current Gemini audio path through the router's `audio` role.
- **Gemini is removed from every TEXT job but kept for audio only.** `@ai-sdk/google` and `GOOGLE_GENERATIVE_AI_API_KEY` stay.
- **Task 1 deltas:** `Provider` is `"anthropic" | "perplexity" | "gemini"` (no `openai`); `Role` gains `"audio"`; `claudeChain("audio")` is `[]`; `candidatesFor("audio", ...)` returns `[{ provider: "gemini", modelId: "gemini-3.6-flash" }]` when the Gemini key exists, else `[]`, and never includes Claude; `pricing.ts` keeps a `gemini-3.6-flash` price ($0.75 / $3.75) and drops the transcription constants; `router.ts` keeps the `google` import for the `gemini` case in `makeModel`, and `available()` reports `gemini` from `GOOGLE_GENERATIVE_AI_API_KEY`; a Gemini depletion error only skips Gemini (no ledger alert, no credit tracking for Gemini). Tests gain audio cases (Gemini only, never Claude, temperature kept, no alert) and the `ALL` fixture uses `{ anthropic, perplexity, gemini }`.
- **Task 3 deltas:** the guard test allows Gemini references only in `lib/voice-transcribe.ts`, `lib/ai/mode.ts`, `lib/ai/pricing.ts` and `lib/ai/router.ts`, and does not scan `package.json` or `README.md`; `package.json` keeps `@ai-sdk/google` (skip Step 6); the landing-page copy keeps voice wording accurate (Gemini only for audio).
- **Task 4 deltas:** README says voice notes use Google (Gemini) transcription and lists `GOOGLE_GENERATIVE_AI_API_KEY` as voice-only; skip the speech-to-text live check (the voice code path is unchanged).
- **Heads-up for the user:** Gemini's dashboard shows a $0 prepaid balance. If voice transcription stops working, that is why; EGO replies "Voice notes are unavailable right now. Please type your message."

## Review Focus

- **Claude out of credit (no fallback exists):** the user must get an urgent alert (rate-limited to one per 30 minutes) and the call must fail loudly, not silently. (Task 1)
- **Warning levels:** exactly 10.0% and 5.0% remaining fire, 10.1% and 5.1% do not; each level fires once; jumping from 50% to 3% sends only the 5% message; `/credits set` re-arms both; zero or unknown balances behave sanely. (Task 1)
- **Perplexity out of credit:** search keeps working through Claude (with the "no live web data" footer) and does not hammer Perplexity for 30 minutes. (Task 1)
- **Voice with a missing or depleted OpenAI key:** the user sees "Voice notes are unavailable right now", never a crash or a double reply; transcript text is trimmed and de-quoted; cost is logged. (Task 2)
- **Existing `AICredits` sheet in the user's spreadsheet has the OLD layout** (rows `gemini`, `perplexity`, `meta`): the store must migrate it instead of misreading it. (Task 1, `needsLayoutMigration`; confirmed manually in Task 4)

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/ai/pricing.ts` (rewrite) | Claude, Sonar and transcription prices; `costUsd`, `transcriptionCostUsd` |
| `lib/ai/mode.ts` (rewrite) | Types, warning levels, error classification, tier chains, candidate selection |
| `lib/ai/ledger.ts` (rewrite) | Balances, usage, warnings, depletion alerts, `/credits` text |
| `lib/ai/sheets-store.ts` (rewrite) | Sheets storage with old-layout migration |
| `lib/ai/router.ts` (rewrite) | Claude tier fallback, Perplexity breaker, usage recording, default wiring |
| `lib/ai/commands.ts` (rewrite) | `/credits`, `/credits set claude|perplexity <usd>` |
| `lib/ai/transcribe.ts` (create) | OpenAI speech-to-text with usage logging |
| `lib/voice-transcribe.ts` (rewrite) | Voice note flow using the transcription module |
| `lib/search.ts` (modify) | Drop the Gemini branch |
| `lib/assistant-intent.ts`, `lib/image-intent.ts`, `lib/paylah-sync.ts` (modify) | Remove Gemini env checks and wording |
| `app/api/telegram/route.ts` (modify) | Pass voice duration |
| `app/page.tsx`, `scripts/setup-sheet-dashboard.mjs` (modify) | Remove Gemini wording |
| `scripts/test-ai-router.ts` (rewrite), `scripts/test-ego.ts` (modify) | Tests |
| `scripts/eval-ego.ts`, `scripts/test-intents.ts`, `scripts/ai-live-check.ts`, `scripts/stt-live-check.ts` (create), `scripts/bench/*` (modify) | Claude-only tooling |
| `package.json`, `README.md` (modify) | Dependencies and docs |

---

### Task 1: Slim the AI core to Claude tiers, warnings and Perplexity search

**Files:**
- Rewrite: `lib/ai/pricing.ts`, `lib/ai/mode.ts`, `lib/ai/ledger.ts`, `lib/ai/sheets-store.ts`, `lib/ai/router.ts`, `lib/ai/commands.ts`, `scripts/test-ai-router.ts`
- Modify: `lib/search.ts`

**Interfaces (produced):**
- `mode.ts`: `type Provider = "anthropic" | "perplexity" | "openai"`; `type Role = "classifier" | "parse" | "agent" | "vision" | "search"`; `type ErrorKind`; `interface BalanceStatus { startBalanceUsd: number | null; spentUsd: number }`; `interface Candidate { provider; modelId }`; `type WarningLevel = 0 | 10 | 5`; `isMoreSevere(a, b)`; `remainingUsd(s)`; `remainingFraction(s)`; `warningLevel(s)`; `classifyError(e)`; `claudeChain(role)`; `candidatesFor(role, available, perplexityDown)`.
- `pricing.ts`: `PRICING_AS_OF`, `PRICING_PER_MILLION_TOKENS_USD`, `PERPLEXITY_REQUEST_FEE_USD`, `TRANSCRIBE_MODEL_ID = "gpt-4o-mini-transcribe"`, `TRANSCRIPTION_PRICE_PER_MINUTE_USD = 0.003`, `costUsd(modelId, inputTokens, outputTokens)`, `transcriptionCostUsd(seconds)`.
- `ledger.ts`: `CreditProvider = "anthropic" | "perplexity"`; `UsageRow`, `BalanceRow`, `AlertState { warnedLevel: WarningLevel; alertedAt?: string }`; `LedgerStore` (`readBalances`, `readUsage`, `readAlertState`, `setBalance`, `setWarnedLevel`, `setAlertedAt`, `appendUsage`); `Ledger` (`recordUsage`, `checkWarnings`, `alertDepleted`, `setBalance`, `describe`); `createLedger({ store, now, notify })`; `sumSpent`; `STATE_TTL_MS`, `ALERT_COOLDOWN_MS`; `warningMessage`, `depletedMessage`.
- `sheets-store.ts`: `createSheetsLedgerStore()`, `needsLayoutMigration(a2: string | undefined): boolean`.
- `router.ts`: `CLAUDE_MIN_OUTPUT_TOKENS`, `PERPLEXITY_COOLDOWN_MS`, `ModelHandle`, `NoModelAvailableError`, `buildHandle`, `mergeProviderOptions`, `RouterDeps` (`ledger: Pick<Ledger, "recordUsage" | "checkWarnings" | "alertDepleted">`, `available()`, `makeModel()`, `generate`, optional `now(): number`), `createRouter(deps)` returning `{ withModelFallback, runText, generateTextRouted, recordModelUsage }`, plus the default singletons and `aiLedger`.
- `commands.ts`: `parseCreditsCommand`, `handleCreditsCommand`, `CREDITS_USAGE`.

- [ ] **Step 1: Rewrite the test file (this is the RED step)**

Read `scripts/test-ai-router.ts` first, then replace its entire contents with:

```ts
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
import {
  PERPLEXITY_REQUEST_FEE_USD,
  TRANSCRIPTION_PRICE_PER_MINUTE_USD,
  costUsd,
  transcriptionCostUsd,
} from "../lib/ai/pricing";
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
const ALL = { anthropic: true, perplexity: true, openai: true };

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
  assert.ok(claudeChain("agent").every((c) => c.provider === "anthropic"));
});

section("candidates: Claude for everything, Perplexity first for search only", () => {
  const ids = (role: Parameters<typeof claudeChain>[0], perplexityDown = false, available = ALL) =>
    candidatesFor(role, available, perplexityDown).map((c) => c.modelId);
  assert.deepEqual(ids("classifier"), ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"]);
  assert.deepEqual(ids("agent"), ["claude-sonnet-5-5", "claude-opus-5-5"]);
  assert.deepEqual(ids("search"), ["sonar", "claude-sonnet-5-5", "claude-opus-5-5"]);
  assert.deepEqual(ids("search", true), ["claude-sonnet-5-5", "claude-opus-5-5"], "breaker open");
  assert.deepEqual(ids("search", false, { ...ALL, perplexity: false }), ["claude-sonnet-5-5", "claude-opus-5-5"]);
  assert.deepEqual(ids("classifier", false, { ...ALL, anthropic: false }), [], "no Claude key, no candidates");
  assert.deepEqual(ids("search", false, { ...ALL, anthropic: false }), ["sonar"], "search can still reach Perplexity");
});

section("pricing", () => {
  assert.equal(costUsd("claude-haiku-5-5", 1_000_000, 1_000_000), 0.6);
  assert.equal(costUsd("claude-sonnet-5-5", 1_000_000, 0), 2);
  assert.equal(costUsd("claude-opus-5-5", 0, 1_000_000), 20);
  assert.equal(costUsd("sonar", 0, 0), PERPLEXITY_REQUEST_FEE_USD, "Sonar adds its per-request fee");
  assert.ok(costUsd("some-future-model", 1_000_000, 1_000_000) > 0, "unknown models use a conservative price");
  assert.equal(costUsd("claude-haiku-5-5", 0, 0), 0);
  assert.equal(transcriptionCostUsd(60), TRANSCRIPTION_PRICE_PER_MINUTE_USD);
  assert.equal(transcriptionCostUsd(0), 0);
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
  assert.equal(sumSpent(rows, "openai", ""), 0);
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
    available: () => ({ anthropic: true, perplexity: true, openai: true, ...(o.available ?? {}) }),
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
const perplexityOut = { statusCode: 429, message: "insufficient credits" };
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

section("no file outside the router picks a Claude or Perplexity model directly", () => {
  const root = process.cwd();
  const offenders: string[] = [];
  for (const dir of ["app", "lib"]) {
    for (const file of sourceFiles(path.join(root, dir))) {
      const rel = path.relative(root, file);
      if (rel === "lib/ai/router.ts") continue;
      if (/\b(anthropic|perplexity)\(\s*["'`]/.test(fs.readFileSync(file, "utf8"))) offenders.push(rel);
    }
  }
  assert.deepEqual(offenders, [], "route model calls through lib/ai/router");
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:ai-router`
Expected: FAIL: `SyntaxError ... does not provide an export named ...` (the old modules do not export the new names, e.g. `warningLevel`).

- [ ] **Step 3: Rewrite `lib/ai/pricing.ts`**

Read the file, then replace its contents with:

```ts
/**
 * USD per 1M tokens. These are ESTIMATES used to track credit spend; the vendor
 * dashboards are the source of truth.
 *  - Claude: Claude API model table, checked 2026-10-17 (Haiku 5.5 is $0.10/$0.50 for
 *    prompts up to 100K tokens).
 *  - Sonar: Perplexity pricing, checked 2026-09-12 (see scripts/bench/util.ts).
 */
export const PRICING_AS_OF = "2026-10-17";

export const PRICING_PER_MILLION_TOKENS_USD: Record<string, { input: number; output: number }> = {
  sonar: { input: 1.0, output: 1.0 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "claude-sonnet-5-5": { input: 2.0, output: 10.0 },
  "claude-opus-5-5": { input: 4.0, output: 20.0 },
};

/**
 * Perplexity bills a per-request search fee ($5-12 per 1,000 requests). The top of the
 * range is used so the estimate errs toward warning early rather than late.
 */
export const PERPLEXITY_REQUEST_FEE_USD = 0.012;

/** OpenAI speech-to-text: about $0.003 per minute (2026 price comparisons). */
export const TRANSCRIBE_MODEL_ID = "gpt-4o-mini-transcribe";
export const TRANSCRIPTION_PRICE_PER_MINUTE_USD = 0.003;

/** Used for a model with no entry: deliberately expensive so spend is never under-counted. */
const CONSERVATIVE_DEFAULT = { input: 2.0, output: 10.0 };

export function costUsd(modelId: string, inputTokens: number, outputTokens: number): number {
  const price = PRICING_PER_MILLION_TOKENS_USD[modelId] ?? CONSERVATIVE_DEFAULT;
  const tokens = (inputTokens / 1_000_000) * price.input + (outputTokens / 1_000_000) * price.output;
  return modelId === "sonar" ? tokens + PERPLEXITY_REQUEST_FEE_USD : tokens;
}

export function transcriptionCostUsd(seconds: number): number {
  return (Math.max(0, seconds) / 60) * TRANSCRIPTION_PRICE_PER_MINUTE_USD;
}
```

- [ ] **Step 4: Rewrite `lib/ai/mode.ts`**

Read the file, then replace its contents with:

```ts
export type Provider = "anthropic" | "perplexity" | "openai";
export type Role = "classifier" | "parse" | "agent" | "vision" | "search";
export type ErrorKind = "depleted" | "transient" | "other";

export interface BalanceStatus {
  /** What the user said the dashboard balance was when they last ran /credits set; null if never set. */
  startBalanceUsd: number | null;
  /** Estimated spend since that balance was set. */
  spentUsd: number;
}

export interface Candidate {
  provider: Provider;
  modelId: string;
}

/** 0 = no warning yet; 10 = at most 10% left; 5 = at most 5% left. */
export type WarningLevel = 0 | 10 | 5;

const SEVERITY: Record<WarningLevel, number> = { 0: 0, 10: 1, 5: 2 };

export function isMoreSevere(a: WarningLevel, b: WarningLevel): boolean {
  return SEVERITY[a] > SEVERITY[b];
}

export function remainingUsd(s: BalanceStatus): number | null {
  return s.startBalanceUsd === null ? null : s.startBalanceUsd - s.spentUsd;
}

export function remainingFraction(s: BalanceStatus): number | null {
  if (s.startBalanceUsd === null) return null;
  if (s.startBalanceUsd <= 0) return 0;
  return Math.max(0, (s.startBalanceUsd - s.spentUsd) / s.startBalanceUsd);
}

/** The most severe warning level reached. An unknown balance never warns. */
export function warningLevel(s: BalanceStatus): WarningLevel {
  const fraction = remainingFraction(s);
  if (fraction === null) return 0;
  if (fraction <= 0.05 + 1e-9) return 5;
  if (fraction <= 0.1 + 1e-9) return 10;
  return 0;
}

// ---- error classification ----

type ErrorLike = {
  statusCode?: number;
  status?: number;
  message?: string;
  responseBody?: unknown;
  lastError?: unknown;
  cause?: unknown;
};

/** Walks AI SDK RetryError / cause chains, keeping the innermost status code and all message text. */
function inspect(error: unknown): { status: number | undefined; text: string } {
  let status: number | undefined;
  const parts: string[] = [];
  if (typeof error === "string") parts.push(error);
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth++) {
    const e = current as ErrorLike;
    status = e.statusCode ?? e.status ?? status;
    if (e.message) parts.push(String(e.message));
    if (e.responseBody) parts.push(String(e.responseBody));
    current = e.lastError ?? e.cause;
  }
  return { status, text: parts.join(" ") };
}

const DEPLETED_PHRASES =
  /prepayment credits are depleted|insufficient (credits|quota|funds|balance)|out of credits|credit balance is too low|billing (account )?(is )?(not active|disabled)|payment required/i;
const CREDIT_WORDS = /credit|prepayment|quota|billing|insufficient|exhausted/i;
const RATE_LIMIT_WORDS = /per[- ]?(minute|second)|requests? per|rate[- ]?limit|retry in|too many requests/i;
const NETWORK_WORDS = /econnreset|etimedout|fetch failed|network|timeout|socket/i;

export function classifyError(error: unknown): ErrorKind {
  const { status, text } = inspect(error);
  if (status === 402) return "depleted";
  if (DEPLETED_PHRASES.test(text)) return "depleted";
  if (
    (status === 429 || status === 403 || status === 401) &&
    CREDIT_WORDS.test(text) &&
    !RATE_LIMIT_WORDS.test(text)
  ) {
    return "depleted";
  }
  if (status === 429 || status === 408 || (status !== undefined && status >= 500)) return "transient";
  if (status === undefined && NETWORK_WORDS.test(text)) return "transient";
  return "other";
}

// ---- candidate selection ----

const claude = (modelId: string): Candidate => ({ provider: "anthropic", modelId });

const HAIKU = "claude-haiku-5-5";
const SONNET = "claude-sonnet-5-5";
const OPUS = "claude-opus-5-5";

export function claudeChain(role: Role): Candidate[] {
  switch (role) {
    case "classifier":
    case "parse":
      return [claude(HAIKU), claude(SONNET), claude(OPUS)];
    case "agent":
    case "vision":
    case "search":
      return [claude(SONNET), claude(OPUS)];
  }
}

/**
 * Ordered models to try for a role: Claude's tier chain, with Perplexity Sonar first for
 * search unless its breaker is open or its key is missing.
 */
export function candidatesFor(
  role: Role,
  available: Record<Provider, boolean>,
  perplexityDown: boolean
): Candidate[] {
  const claudeCandidates = available.anthropic ? claudeChain(role) : [];
  const web: Candidate[] =
    role === "search" && available.perplexity && !perplexityDown
      ? [{ provider: "perplexity", modelId: "sonar" }]
      : [];
  return [...web, ...claudeCandidates];
}
```

- [ ] **Step 5: Rewrite `lib/ai/ledger.ts`**

Read the file, then replace its contents with:

```ts
import {
  isMoreSevere,
  remainingFraction,
  remainingUsd,
  warningLevel,
  type BalanceStatus,
  type Provider,
  type WarningLevel,
} from "./mode";
import { PRICING_AS_OF } from "./pricing";

/** Providers whose credit balance EGO tracks and warns about. */
export type CreditProvider = "anthropic" | "perplexity";
export const CREDIT_PROVIDERS: CreditProvider[] = ["anthropic", "perplexity"];

export interface UsageRow {
  timestamp: string;
  provider: Provider;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  role: string;
}

export interface BalanceRow {
  startBalanceUsd: number;
  setAt: string;
}

export interface AlertState {
  warnedLevel: WarningLevel;
  /** When the last real-depletion alert was sent (ISO). */
  alertedAt?: string;
}

export interface LedgerStore {
  readBalances(): Promise<Partial<Record<CreditProvider, BalanceRow>>>;
  readUsage(): Promise<UsageRow[]>;
  readAlertState(): Promise<Record<CreditProvider, AlertState>>;
  /** Sets a new balance and re-arms the warnings (warnedLevel back to 0, alertedAt cleared). */
  setBalance(provider: CreditProvider, usd: number, setAtIso: string): Promise<void>;
  setWarnedLevel(provider: CreditProvider, level: WarningLevel): Promise<void>;
  setAlertedAt(provider: CreditProvider, iso: string): Promise<void>;
  appendUsage(row: UsageRow): Promise<void>;
}

export interface Ledger {
  recordUsage(row: UsageRow): Promise<void>;
  /** Sends a Telegram warning when a balance first reaches 10% or 5% left. */
  checkWarnings(): Promise<void>;
  /** Urgent alert after a real "credits depleted" error; at most one per 30 minutes per provider. */
  alertDepleted(provider: CreditProvider): Promise<void>;
  setBalance(provider: CreditProvider, usd: number): Promise<void>;
  describe(): Promise<string>;
}

export const STATE_TTL_MS = 60_000;
export const ALERT_COOLDOWN_MS = 30 * 60_000;

const NAME: Record<CreditProvider, string> = { anthropic: "Claude", perplexity: "Perplexity" };
const COMMAND_NAME: Record<CreditProvider, string> = { anthropic: "claude", perplexity: "perplexity" };

/** Sum of recorded cost for one provider at or after `sinceIso` ("" means all time). ISO strings compare lexicographically. */
export function sumSpent(rows: UsageRow[], provider: Provider, sinceIso: string): number {
  let total = 0;
  for (const r of rows) {
    if (r.provider === provider && r.timestamp >= sinceIso) total += r.costUsd;
  }
  return total;
}

export function warningMessage(provider: CreditProvider, level: WarningLevel, status: BalanceStatus): string {
  const left = remainingUsd(status);
  const dollars = left === null ? "" : ` (about $${Math.max(0, left).toFixed(2)})`;
  return `⚠️ ${NAME[provider]} credits are down to ${level}% or less${dollars}. Top up soon, then send /credits set ${COMMAND_NAME[provider]} <new balance> so EGO keeps counting from the right number.`;
}

export function depletedMessage(provider: CreditProvider): string {
  if (provider === "anthropic") {
    return "🚨 Claude says its credits are used up, so EGO cannot answer right now. Top up in the Anthropic console, then send /credits set claude <new balance>.";
  }
  return "⚠️ Perplexity says its credits are used up. EGO will answer web questions from Claude's own knowledge until you top up. After topping up, send /credits set perplexity <new balance>.";
}

export function createLedger(deps: {
  store: LedgerStore;
  now: () => Date;
  notify: (text: string) => Promise<void>;
}): Ledger {
  const { store, now, notify } = deps;
  let cache: { at: number; statuses: Record<CreditProvider, BalanceStatus> } | null = null;

  async function loadStatuses(): Promise<Record<CreditProvider, BalanceStatus>> {
    const nowMs = now().getTime();
    if (cache && nowMs - cache.at < STATE_TTL_MS) return cache.statuses;
    const [balances, usage] = await Promise.all([store.readBalances(), store.readUsage()]);
    const statuses = {} as Record<CreditProvider, BalanceStatus>;
    for (const provider of CREDIT_PROVIDERS) {
      const balance = balances[provider];
      statuses[provider] = {
        startBalanceUsd: balance ? balance.startBalanceUsd : null,
        spentUsd: balance ? sumSpent(usage, provider, balance.setAt) : 0,
      };
    }
    cache = { at: nowMs, statuses };
    return statuses;
  }

  async function checkWarnings(): Promise<void> {
    const statuses = await loadStatuses();
    const alertState = await store.readAlertState();
    for (const provider of CREDIT_PROVIDERS) {
      const level = warningLevel(statuses[provider]);
      if (isMoreSevere(level, alertState[provider].warnedLevel)) {
        // Claim the level before notifying so a second instance is less likely to repeat it.
        await store.setWarnedLevel(provider, level);
        await notify(warningMessage(provider, level, statuses[provider])).catch(() => {});
      }
    }
  }

  async function alertDepleted(provider: CreditProvider): Promise<void> {
    const state = await store.readAlertState();
    const last = state[provider].alertedAt;
    if (last && new Date(last).getTime() + ALERT_COOLDOWN_MS > now().getTime()) return;
    await store.setAlertedAt(provider, now().toISOString());
    await notify(depletedMessage(provider)).catch(() => {});
  }

  async function recordUsage(row: UsageRow): Promise<void> {
    try {
      await store.appendUsage(row);
    } catch (error) {
      console.warn("Could not record AI usage:", error);
    }
  }

  async function setBalance(provider: CreditProvider, usd: number): Promise<void> {
    await store.setBalance(provider, usd, now().toISOString());
    cache = null;
    await checkWarnings();
  }

  async function describe(): Promise<string> {
    const statuses = await loadStatuses();
    const line = (provider: CreditProvider) => {
      const s = statuses[provider];
      const left = remainingUsd(s);
      const fraction = remainingFraction(s);
      if (left === null || fraction === null || s.startBalanceUsd === null) {
        return `• ${NAME[provider]}: balance not set (send /credits set ${COMMAND_NAME[provider]} <dashboard balance>)`;
      }
      return `• ${NAME[provider]}: about $${Math.max(0, left).toFixed(2)} left of $${s.startBalanceUsd.toFixed(2)} (${(
        fraction * 100
      ).toFixed(1)}%)`;
    };
    return [
      "🧠 AI credits (estimates from tracked usage)",
      line("anthropic"),
      line("perplexity"),
      `EGO warns you at 10% and 5% left. Prices assumed as of ${PRICING_AS_OF}.`,
    ].join("\n");
  }

  return { recordUsage, checkWarnings, alertDepleted, setBalance, describe };
}
```

- [ ] **Step 6: Rewrite `lib/ai/sheets-store.ts`**

Read the file, then replace its contents with:

```ts
import { getSheetsClient } from "../google";
import type { AlertState, BalanceRow, CreditProvider, LedgerStore, UsageRow } from "./ledger";
import type { Provider, WarningLevel } from "./mode";

const CREDITS_SHEET = "AICredits";
const USAGE_SHEET = "AIUsage";
// AICredits rows: 2 = anthropic, 3 = perplexity. Columns: provider | startBalanceUsd | setAt | warnedLevel | alertedAt
const ROW: Record<CreditProvider, number> = { anthropic: 2, perplexity: 3 };

const CREDITS_VALUES = [
  ["provider", "startBalanceUsd", "setAt", "warnedLevel", "alertedAt"],
  ["anthropic", "", "", "0", ""],
  ["perplexity", "", "", "0", ""],
  ["", "", "", "", ""],
];

/** The first version of this sheet had rows gemini / perplexity / meta; row 2 is the tell. */
export function needsLayoutMigration(a2: string | undefined): boolean {
  return a2 !== "anthropic";
}

function spreadsheetId(): string {
  const id = process.env.GOOGLE_SHEET_ID;
  if (!id) throw new Error("GOOGLE_SHEET_ID is missing.");
  return id;
}

let ensured = false;

async function ensureSheets(): Promise<void> {
  if (ensured) return;
  const sheets = getSheetsClient();
  const id = spreadsheetId();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: id });
  const titles = (meta.data.sheets || []).map((s) => s.properties?.title);

  if (!titles.includes(CREDITS_SHEET)) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: id,
      requestBody: { requests: [{ addSheet: { properties: { title: CREDITS_SHEET } } }] },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: id,
      range: `${CREDITS_SHEET}!A1:E4`,
      valueInputOption: "RAW",
      requestBody: { values: CREDITS_VALUES },
    });
  } else {
    const head = await sheets.spreadsheets.values.get({
      spreadsheetId: id,
      range: `${CREDITS_SHEET}!A2:A2`,
    });
    if (needsLayoutMigration(head.data.values?.[0]?.[0])) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: id,
        range: `${CREDITS_SHEET}!A1:E4`,
        valueInputOption: "RAW",
        requestBody: { values: CREDITS_VALUES },
      });
    }
  }

  if (!titles.includes(USAGE_SHEET)) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: id,
      requestBody: { requests: [{ addSheet: { properties: { title: USAGE_SHEET } } }] },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: id,
      range: `${USAGE_SHEET}!A1:G1`,
      valueInputOption: "RAW",
      requestBody: {
        values: [["timestamp", "provider", "model", "inputTokens", "outputTokens", "costUsd", "role"]],
      },
    });
  }
  ensured = true;
}

async function readCredits(): Promise<string[][]> {
  await ensureSheets();
  const res = await getSheetsClient().spreadsheets.values.get({
    spreadsheetId: spreadsheetId(),
    range: `${CREDITS_SHEET}!A2:E3`,
  });
  return (res.data.values ?? []) as string[][];
}

function toLevel(raw: string | undefined): WarningLevel {
  const n = parseInt(raw ?? "", 10);
  return n === 5 ? 5 : n === 10 ? 10 : 0;
}

export function createSheetsLedgerStore(): LedgerStore {
  return {
    async readBalances() {
      const rows = await readCredits();
      const out: Partial<Record<CreditProvider, BalanceRow>> = {};
      (["anthropic", "perplexity"] as const).forEach((provider, i) => {
        const r = rows[i] ?? [];
        const balance = parseFloat(r[1] ?? "");
        if (Number.isFinite(balance) && r[2]) out[provider] = { startBalanceUsd: balance, setAt: r[2] };
      });
      return out;
    },

    async readUsage() {
      await ensureSheets();
      const res = await getSheetsClient().spreadsheets.values.get({
        spreadsheetId: spreadsheetId(),
        range: `${USAGE_SHEET}!A2:G`,
      });
      return ((res.data.values ?? []) as string[][]).map(
        (r): UsageRow => ({
          timestamp: r[0] ?? "",
          provider: (r[1] ?? "anthropic") as Provider,
          model: r[2] ?? "",
          inputTokens: Number(r[3]) || 0,
          outputTokens: Number(r[4]) || 0,
          costUsd: Number(r[5]) || 0,
          role: r[6] ?? "",
        })
      );
    },

    async readAlertState() {
      const rows = await readCredits();
      const state = (i: number): AlertState => ({
        warnedLevel: toLevel(rows[i]?.[3]),
        alertedAt: rows[i]?.[4] || undefined,
      });
      return { anthropic: state(0), perplexity: state(1) };
    },

    async setBalance(provider, usd, setAtIso) {
      await ensureSheets();
      await getSheetsClient().spreadsheets.values.update({
        spreadsheetId: spreadsheetId(),
        range: `${CREDITS_SHEET}!B${ROW[provider]}:E${ROW[provider]}`,
        valueInputOption: "RAW",
        requestBody: { values: [[usd, setAtIso, "0", ""]] },
      });
    },

    async setWarnedLevel(provider, level) {
      await ensureSheets();
      await getSheetsClient().spreadsheets.values.update({
        spreadsheetId: spreadsheetId(),
        range: `${CREDITS_SHEET}!D${ROW[provider]}`,
        valueInputOption: "RAW",
        requestBody: { values: [[String(level)]] },
      });
    },

    async setAlertedAt(provider, iso) {
      await ensureSheets();
      await getSheetsClient().spreadsheets.values.update({
        spreadsheetId: spreadsheetId(),
        range: `${CREDITS_SHEET}!E${ROW[provider]}`,
        valueInputOption: "RAW",
        requestBody: { values: [[iso]] },
      });
    },

    async appendUsage(row) {
      await ensureSheets();
      await getSheetsClient().spreadsheets.values.append({
        spreadsheetId: spreadsheetId(),
        range: `${USAGE_SHEET}!A:G`,
        valueInputOption: "RAW",
        requestBody: {
          values: [[row.timestamp, row.provider, row.model, row.inputTokens, row.outputTokens, row.costUsd, row.role]],
        },
      });
    },
  };
}
```

- [ ] **Step 7: Rewrite `lib/ai/router.ts`**

Read the file, then replace its contents with:

```ts
import { anthropic } from "@ai-sdk/anthropic";
import { perplexity } from "@ai-sdk/perplexity";
import { generateText, type LanguageModel } from "ai";
import { sendTelegramMessage } from "../telegram";
import { createLedger, type Ledger } from "./ledger";
import { candidatesFor, classifyError, type Candidate, type Provider, type Role } from "./mode";
import { costUsd } from "./pricing";
import { createSheetsLedgerStore } from "./sheets-store";

type GenerateTextParams = Parameters<typeof generateText>[0];
export type RoutedParams = Omit<GenerateTextParams, "model">;
/** Derived from the AI SDK so provider option values stay JSON-compatible. */
type ProviderOptions = NonNullable<GenerateTextParams["providerOptions"]>;

/** Claude 5.5 models think by default, and thinking counts toward max tokens, so tiny limits cut answers off. */
export const CLAUDE_MIN_OUTPUT_TOKENS = 4096;
/** After Perplexity reports its credits depleted, search skips it for this long. */
export const PERPLEXITY_COOLDOWN_MS = 30 * 60_000;
const BOOKKEEPING_TIMEOUT_MS = 2000;

export interface ModelHandle {
  model: LanguageModel;
  provider: Provider;
  modelId: string;
  role: Role;
  isClaude: boolean;
  providerOptions?: ProviderOptions;
  /** Sampling settings that are safe for this model (Claude 5.5 rejects non-default temperature). */
  sampling(temperature: number): { temperature?: number };
}

export class NoModelAvailableError extends Error {
  role: Role;
  constructor(role: Role) {
    super(`No AI model is available for "${role}" right now.`);
    this.name = "NoModelAvailableError";
    this.role = role;
  }
}

export function buildHandle(
  c: Candidate,
  role: Role,
  makeModel: (c: Candidate) => LanguageModel
): ModelHandle {
  const isClaude = c.provider === "anthropic";
  return {
    model: makeModel(c),
    provider: c.provider,
    modelId: c.modelId,
    role,
    isClaude,
    providerOptions:
      isClaude && (role === "classifier" || role === "parse") ? { anthropic: { effort: "low" } } : undefined,
    sampling: (temperature) => (isClaude ? {} : { temperature }),
  };
}

export function mergeProviderOptions(
  a: ProviderOptions | undefined,
  b: ProviderOptions | undefined
): ProviderOptions | undefined {
  if (!a && !b) return undefined;
  const out: ProviderOptions = { ...(a ?? {}) };
  for (const [key, value] of Object.entries(b ?? {})) {
    out[key] = { ...(out[key] ?? {}), ...value };
  }
  return out;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export interface RouterDeps {
  ledger: Pick<Ledger, "recordUsage" | "checkWarnings" | "alertDepleted">;
  available(): Record<Provider, boolean>;
  makeModel(c: Candidate): LanguageModel;
  generate: typeof generateText;
  /** Milliseconds clock for the Perplexity breaker; defaults to Date.now. */
  now?: () => number;
}

export function createRouter(deps: RouterDeps) {
  const clock = deps.now ?? (() => Date.now());
  let perplexityDownUntil = 0;

  async function recordModelUsage(
    handle: ModelHandle,
    usage: { inputTokens?: number; outputTokens?: number } | undefined
  ): Promise<void> {
    const inputTokens = usage?.inputTokens ?? 0;
    const outputTokens = usage?.outputTokens ?? 0;
    await withTimeout(
      deps.ledger.recordUsage({
        timestamp: new Date().toISOString(),
        provider: handle.provider,
        model: handle.modelId,
        inputTokens,
        outputTokens,
        costUsd: costUsd(handle.modelId, inputTokens, outputTokens),
        role: handle.role,
      }),
      BOOKKEEPING_TIMEOUT_MS
    ).catch(() => {});
    await withTimeout(deps.ledger.checkWarnings(), BOOKKEEPING_TIMEOUT_MS).catch(() => {});
  }

  /** One text generation on one model, with Claude-safe parameters, then usage recording. */
  async function runText(handle: ModelHandle, params: RoutedParams) {
    const { temperature, maxOutputTokens, providerOptions, ...rest } = params as Record<string, unknown> & {
      temperature?: number;
      maxOutputTokens?: number;
      providerOptions?: ProviderOptions;
    };
    const call: Record<string, unknown> = { ...rest, model: handle.model };
    if (temperature !== undefined) Object.assign(call, handle.sampling(temperature));
    if (handle.isClaude) {
      call.maxOutputTokens = Math.max(maxOutputTokens ?? 0, CLAUDE_MIN_OUTPUT_TOKENS);
    } else if (maxOutputTokens !== undefined) {
      call.maxOutputTokens = maxOutputTokens;
    }
    const merged = mergeProviderOptions(providerOptions, handle.providerOptions);
    if (merged) call.providerOptions = merged;

    const result = await deps.generate(call as GenerateTextParams);
    await recordModelUsage(handle, result.usage);
    return result;
  }

  /**
   * Runs `attempt` on each candidate model for the role until one succeeds. A "credits
   * depleted" error alerts the user and skips that provider's remaining models; Perplexity
   * also opens a 30-minute breaker. `canRetry` lets callers forbid a retry once side effects
   * happened (agents that already ran a tool).
   */
  async function withModelFallback<T>(
    role: Role,
    attempt: (handle: ModelHandle) => Promise<T>,
    opts: { canRetry?: () => boolean } = {}
  ): Promise<{ result: T; handle: ModelHandle }> {
    const candidates = candidatesFor(role, deps.available(), clock() < perplexityDownUntil);
    if (candidates.length === 0) throw new NoModelAvailableError(role);

    const skipped = new Set<Provider>();
    let lastError: unknown;
    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];
      if (skipped.has(candidate.provider)) continue;
      const handle = buildHandle(candidate, role, deps.makeModel);
      try {
        return { result: await attempt(handle), handle };
      } catch (error) {
        lastError = error;
        if (classifyError(error) === "depleted") {
          skipped.add(candidate.provider);
          if (candidate.provider === "perplexity") {
            perplexityDownUntil = clock() + PERPLEXITY_COOLDOWN_MS;
            await deps.ledger.alertDepleted("perplexity").catch(() => {});
          } else if (candidate.provider === "anthropic") {
            await deps.ledger.alertDepleted("anthropic").catch(() => {});
          }
        }
        const hasNext = candidates.slice(i + 1).some((next) => !skipped.has(next.provider));
        if (!hasNext || (opts.canRetry && !opts.canRetry())) throw error;
        console.warn(`AI call failed on ${candidate.provider}/${candidate.modelId} (${role}); trying the next model:`, error);
      }
    }
    throw lastError;
  }

  async function generateTextRouted(
    role: Role,
    params: RoutedParams,
    opts: { canRetry?: () => boolean } = {}
  ) {
    return withModelFallback(role, (handle) => runText(handle, params), opts);
  }

  return { withModelFallback, runText, generateTextRouted, recordModelUsage };
}

// ---- default wiring ----

function makeModel(c: Candidate): LanguageModel {
  switch (c.provider) {
    case "perplexity":
      return perplexity(c.modelId);
    case "anthropic":
      // @ai-sdk/anthropic bundles a newer copy of @ai-sdk/provider than the other AI SDK
      // packages. Same v4 spec at runtime; only the nominal types differ.
      return anthropic(c.modelId) as unknown as LanguageModel;
    case "openai":
      throw new Error("OpenAI is used for speech-to-text only; see lib/ai/transcribe.ts.");
  }
}

async function notifyAllowedUser(text: string): Promise<void> {
  const chatId = Number(process.env.TELEGRAM_ALLOWED_USER_ID);
  if (chatId) await sendTelegramMessage(chatId, text, undefined, null);
}

export const aiLedger: Ledger = createLedger({
  store: createSheetsLedgerStore(),
  now: () => new Date(),
  notify: notifyAllowedUser,
});

const defaultRouter = createRouter({
  ledger: aiLedger,
  available: () => ({
    anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
    perplexity: Boolean(process.env.PERPLEXITY_API_KEY),
    openai: Boolean(process.env.OPENAI_API_KEY),
  }),
  makeModel,
  generate: generateText,
});

export const { withModelFallback, runText, generateTextRouted, recordModelUsage } = defaultRouter;
```

- [ ] **Step 8: Rewrite `lib/ai/commands.ts`**

Read the file, then replace its contents with:

```ts
import { sendTelegramMessage } from "../telegram";
import { aiLedger } from "./router";

export type CreditsCommand =
  | { kind: "show" }
  | { kind: "set"; provider: "anthropic" | "perplexity"; amountUsd: number }
  | { kind: "usage_error"; message: string };

export const CREDITS_USAGE =
  "Usage: /credits to see balances, or /credits set claude 20.00 (and /credits set perplexity 8.94) with the current dashboard balance in USD.";

const PROVIDER_ALIASES: Record<string, "anthropic" | "perplexity"> = {
  claude: "anthropic",
  anthropic: "anthropic",
  perplexity: "perplexity",
};

export function parseCreditsCommand(text: string): CreditsCommand | null {
  const trimmed = text.trim();
  if (!/^\/credits(@\w+)?(\s|$)/i.test(trimmed)) return null;
  const parts = trimmed.split(/\s+/).slice(1);
  if (parts.length === 0) return { kind: "show" };
  if (parts[0].toLowerCase() === "set") {
    const provider = PROVIDER_ALIASES[parts[1]?.toLowerCase() ?? ""];
    const raw = parts[2]?.replace(/^\$/, "");
    const amount = raw === undefined || raw === "" ? NaN : Number(raw);
    if (provider && Number.isFinite(amount) && amount >= 0) {
      return { kind: "set", provider, amountUsd: amount };
    }
  }
  return { kind: "usage_error", message: CREDITS_USAGE };
}

export async function handleCreditsCommand(params: { chatId: number; text: string }): Promise<void> {
  const command = parseCreditsCommand(params.text);
  if (!command) return;
  if (command.kind === "usage_error") {
    await sendTelegramMessage(params.chatId, command.message, undefined, null);
    return;
  }
  if (command.kind === "set") {
    await aiLedger.setBalance(command.provider, command.amountUsd);
  }
  const summary = await aiLedger.describe();
  const prefix =
    command.kind === "set"
      ? `✅ ${command.provider === "anthropic" ? "Claude" : "Perplexity"} balance set to $${command.amountUsd.toFixed(2)}.\n\n`
      : "";
  await sendTelegramMessage(params.chatId, prefix + summary, undefined, null);
}
```

- [ ] **Step 9: Drop the Gemini branch from `lib/search.ts`**

Three edits:

1. Replace `  source: "sonar" | "gemini" | "claude" | "fallback";` with `  source: "sonar" | "claude" | "fallback";`.
2. Delete this block from `searchSystemPrompt`:

```ts
  if (provider === "gemini") {
    return `You are EGO, a helpful, concise personal assistant.
Answer the user's question directly and concisely in 2-3 sentences.
If it looks like a calendar event, expense, or to-do that wasn't recognized, suggest how to phrase it.`;
  }
```

3. Replace `    return { answer: text, source: handle.provider === "perplexity" ? "sonar" : "gemini" };` with `    return { answer: text, source: "sonar" };`.

- [ ] **Step 10: Run to verify it passes; type-check**

Run: `npm run test:ai-router`
Expected: PASS, every section prints `✅`, ending with `🎉 All AI router tests passed!`.

Run: `npx tsc --noEmit`
Expected: exit 0, no output. (Other files still mention Gemini in strings and env checks, but nothing imports removed exports. If `lib/voice-transcribe.ts` still imports `NoModelAvailableError` and `generateTextRouted("audio", ...)`, tsc reports it: that is fixed in Task 2, so for THIS step accept errors ONLY from `lib/voice-transcribe.ts`.)

- [ ] **Step 11: Commit**

```bash
git add lib/ai lib/search.ts scripts/test-ai-router.ts docs/superpowers
git commit -m "refactor(ai): slim the router to Claude tiers with low-balance warnings and a Perplexity breaker"
```

---

### Task 2: Speech-to-text replaces Gemini for voice notes

**Files:**
- Create: `lib/ai/transcribe.ts`
- Rewrite: `lib/voice-transcribe.ts`
- Modify: `app/api/telegram/route.ts`, `scripts/test-ego.ts`, `scripts/test-ai-router.ts`, `package.json`

**Interfaces:**
- Consumes: `classifyError` (`lib/ai/mode`), `TRANSCRIBE_MODEL_ID`, `transcriptionCostUsd` (`lib/ai/pricing`), `aiLedger` (`lib/ai/router`), `UsageRow` (`lib/ai/ledger`).
- Produces: `TranscriptionUnavailableError`; `interface TranscribeDeps { available(): boolean; run(args: { audio: Uint8Array; prompt: string }): Promise<{ text: string }>; recordUsage(row: UsageRow): Promise<void>; now(): Date }`; `transcribeAudio(input: { audio: Uint8Array; prompt: string; durationSeconds?: number }, deps?: TranscribeDeps): Promise<string>`; `realTranscribeRun(args): Promise<{ text: string }>` (the real OpenAI call, for the live check). From `voice-transcribe.ts`: `buildTranscriptionPrompt(contactNames: string[]): string`, `transcribeTelegramVoiceNote(input: { audio: Uint8Array; contactNames?: string[]; durationSeconds?: number }): Promise<string>`, `handleVoiceNoteAction(params: { chatId: number; fileId: string; mimeType?: string; durationSeconds?: number }): Promise<string | null>`.

- [ ] **Step 1: Install the OpenAI provider**

Run: `npm install @ai-sdk/openai@^4.0.95`
Expected: `package.json` gains `"@ai-sdk/openai"`; exit 0.

- [ ] **Step 2: Write the failing tests**

In `scripts/test-ai-router.ts` add to the imports:

```ts
import {
  TranscriptionUnavailableError,
  transcribeAudio,
  type TranscribeDeps,
} from "../lib/ai/transcribe";
```

and add above `// ---- runner ----`:

```ts
function transcribeHarness(o: { available?: boolean; fail?: unknown; text?: string; usageFails?: boolean } = {}) {
  const calls: Array<{ prompt: string; bytes: number }> = [];
  const used: UsageRow[] = [];
  const deps: TranscribeDeps = {
    available: () => o.available ?? true,
    run: async ({ audio, prompt }) => {
      calls.push({ prompt, bytes: audio.length });
      if (o.fail) throw o.fail;
      return { text: o.text ?? "  spent twelve fifty on lunch  " };
    },
    recordUsage: async (r) => {
      if (o.usageFails) throw new Error("sheets down");
      used.push(r);
    },
    now: () => new Date("2026-10-17T00:00:00.000Z"),
  };
  return { deps, calls, used };
}

section("transcribe: trims the text, passes the vocabulary prompt and logs the cost", async () => {
  const h = transcribeHarness();
  const text = await transcribeAudio(
    { audio: new Uint8Array(100), prompt: "Names: Priya", durationSeconds: 60 },
    h.deps
  );
  assert.equal(text, "spent twelve fifty on lunch");
  assert.deepEqual(h.calls, [{ prompt: "Names: Priya", bytes: 100 }]);
  assert.equal(h.used.length, 1);
  assert.equal(h.used[0].provider, "openai");
  assert.equal(h.used[0].model, "gpt-4o-mini-transcribe");
  assert.equal(h.used[0].role, "audio");
  assert.equal(h.used[0].costUsd, TRANSCRIPTION_PRICE_PER_MINUTE_USD);
});

section("transcribe: an unknown duration is costed as 10 seconds", async () => {
  const h = transcribeHarness();
  await transcribeAudio({ audio: new Uint8Array(1), prompt: "" }, h.deps);
  assert.equal(h.used[0].costUsd, transcriptionCostUsd(10));
});

section("transcribe: a missing key is reported as unavailable without calling the service", async () => {
  const h = transcribeHarness({ available: false });
  await assert.rejects(
    () => transcribeAudio({ audio: new Uint8Array(1), prompt: "" }, h.deps),
    (err: unknown) => err instanceof TranscriptionUnavailableError
  );
  assert.equal(h.calls.length, 0);
});

section("transcribe: depleted credits are unavailable; other errors pass through", async () => {
  const depleted = transcribeHarness({ fail: { statusCode: 429, message: "insufficient credits" } });
  await assert.rejects(
    () => transcribeAudio({ audio: new Uint8Array(1), prompt: "" }, depleted.deps),
    (err: unknown) => err instanceof TranscriptionUnavailableError
  );
  const other = transcribeHarness({ fail: new Error("unsupported audio format") });
  await assert.rejects(
    () => transcribeAudio({ audio: new Uint8Array(1), prompt: "" }, other.deps),
    /unsupported audio format/
  );
});

section("transcribe: a failing usage write never fails the transcription", async () => {
  const h = transcribeHarness({ usageFails: true });
  const text = await transcribeAudio({ audio: new Uint8Array(1), prompt: "" }, h.deps);
  assert.equal(text, "spent twelve fifty on lunch");
});
```

In `scripts/test-ego.ts`, change the import `import { buildTranscriptionSystemPrompt } from "../lib/voice-transcribe";` to `import { buildTranscriptionPrompt } from "../lib/voice-transcribe";` and replace the whole transcription section:

```ts
section("transcription prompt carries domain vocabulary and the user's contact names", () => {
  const p = buildTranscriptionSystemPrompt(["Priya", "Wei Jie"]);
  assert.match(p, /PayLah/);
  assert.match(p, /T-bar row/);
  assert.match(p, /Priya/);
  assert.match(p, /Wei Jie/);
  assert.match(p, /Output ONLY the transcribed text/);
  const bare = buildTranscriptionSystemPrompt([]);
  assert.match(bare, /PayLah/);
});
```

with:

```ts
section("transcription prompt carries domain vocabulary and the user's contact names", () => {
  const p = buildTranscriptionPrompt(["Priya", "Wei Jie"]);
  assert.match(p, /PayLah/);
  assert.match(p, /T-bar row/);
  assert.match(p, /Priya/);
  assert.match(p, /Wei Jie/);
  assert.match(buildTranscriptionPrompt([]), /PayLah/);
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `npm run test:ai-router`
Expected: FAIL, `Cannot find module ... lib/ai/transcribe`.

- [ ] **Step 4: Implement `lib/ai/transcribe.ts`**

```ts
import { openai } from "@ai-sdk/openai";
import { transcribe } from "ai";
import type { UsageRow } from "./ledger";
import { classifyError } from "./mode";
import { TRANSCRIBE_MODEL_ID, transcriptionCostUsd } from "./pricing";
import { aiLedger } from "./router";

/** The service is not configured, or reports its credits depleted. The user is asked to type instead. */
export class TranscriptionUnavailableError extends Error {
  constructor(reason: string) {
    super(`Transcription is unavailable: ${reason}`);
    this.name = "TranscriptionUnavailableError";
  }
}

const ASSUMED_SECONDS_WHEN_UNKNOWN = 10;

export interface TranscribeDeps {
  available(): boolean;
  run(args: { audio: Uint8Array; prompt: string }): Promise<{ text: string }>;
  recordUsage(row: UsageRow): Promise<void>;
  now(): Date;
}

/** The real OpenAI call. Exported so the live check can run it without touching the ledger. */
export function realTranscribeRun(args: { audio: Uint8Array; prompt: string }): Promise<{ text: string }> {
  return transcribe({
    // @ai-sdk/openai bundles its own @ai-sdk/provider copy; same spec, different nominal types.
    model: openai.transcription(TRANSCRIBE_MODEL_ID) as never,
    audio: args.audio,
    providerOptions: { openai: { prompt: args.prompt } },
  });
}

const defaultDeps: TranscribeDeps = {
  available: () => Boolean(process.env.OPENAI_API_KEY),
  run: realTranscribeRun,
  recordUsage: (row) => aiLedger.recordUsage(row),
  now: () => new Date(),
};

export async function transcribeAudio(
  input: { audio: Uint8Array; prompt: string; durationSeconds?: number },
  deps: TranscribeDeps = defaultDeps
): Promise<string> {
  if (!deps.available()) throw new TranscriptionUnavailableError("OPENAI_API_KEY is not set.");

  let result: { text: string };
  try {
    result = await deps.run({ audio: input.audio, prompt: input.prompt });
  } catch (error) {
    if (classifyError(error) === "depleted") {
      throw new TranscriptionUnavailableError("the speech-to-text account is out of credit.");
    }
    throw error;
  }

  await deps
    .recordUsage({
      timestamp: deps.now().toISOString(),
      provider: "openai",
      model: TRANSCRIBE_MODEL_ID,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: transcriptionCostUsd(input.durationSeconds ?? ASSUMED_SECONDS_WHEN_UNKNOWN),
      role: "audio",
    })
    .catch(() => {});

  return result.text.trim();
}
```

- [ ] **Step 5: Rewrite `lib/voice-transcribe.ts`**

Read the file, then replace its contents with:

```ts
import { classifyError } from "./ai/mode";
import { TranscriptionUnavailableError, transcribeAudio } from "./ai/transcribe";
import { listAllMemories } from "./memory";
import { downloadTelegramAudio } from "./telegram-files";
import { sendTelegramChatAction, sendTelegramMessage } from "./telegram";

const STATIC_VOCABULARY = [
  "EGO",
  "PayLah",
  "Apple Pay",
  "Grab",
  "SGD",
  "kg",
  "reps",
  "bench press",
  "incline Smith",
  "T-bar row",
  "lat pulldown",
  "personal calendar",
  "work calendar",
  "to-do list",
];

/** Vocabulary hints for the speech-to-text service (gym terms, PayLah, the user's contact names). */
export function buildTranscriptionPrompt(contactNames: string[]): string {
  const vocabulary = [...STATIC_VOCABULARY, ...contactNames].join(", ");
  return `A voice note for EGO, a personal assistant. Words and names you may hear (prefer these spellings when the audio matches): ${vocabulary}.`;
}

async function loadContactNames(): Promise<string[]> {
  try {
    const memories = await Promise.race([
      listAllMemories(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 1500)),
    ]);
    return memories
      .filter((m) => m.category === "contact")
      .map((m) => m.key)
      .slice(0, 40);
  } catch {
    return [];
  }
}

export async function transcribeTelegramVoiceNote(input: {
  audio: Uint8Array;
  contactNames?: string[];
  durationSeconds?: number;
}): Promise<string> {
  let text = (
    await transcribeAudio({
      audio: input.audio,
      prompt: buildTranscriptionPrompt(input.contactNames ?? []),
      durationSeconds: input.durationSeconds,
    })
  ).trim();

  // Strip outer quotes if the service wrapped the transcription in quotes
  if (
    (text.startsWith('"') && text.endsWith('"') && text.length >= 2) ||
    (text.startsWith('“') && text.endsWith('”') && text.length >= 2)
  ) {
    text = text.slice(1, -1).trim();
  }

  return text;
}

export async function handleVoiceNoteAction(params: {
  chatId: number;
  fileId: string;
  mimeType?: string;
  durationSeconds?: number;
}): Promise<string | null> {
  const { chatId, fileId, mimeType, durationSeconds } = params;

  // Immediate visual feedback
  await sendTelegramChatAction(chatId, "record_voice");
  await sendTelegramMessage(chatId, "🎧 Listening to your voice note...");

  try {
    const [downloaded, contactNames] = await Promise.all([
      downloadTelegramAudio(fileId, mimeType),
      loadContactNames(),
    ]);
    const transcription = await transcribeTelegramVoiceNote({
      audio: downloaded.data,
      contactNames,
      durationSeconds,
    });

    if (!transcription) {
      await sendTelegramMessage(
        chatId,
        "I couldn't hear any words in that voice note. Please try again."
      );
      return null;
    }

    await sendTelegramMessage(chatId, `🎤 Heard: “${transcription}”`);
    return transcription;
  } catch (voiceError) {
    const unavailable =
      voiceError instanceof TranscriptionUnavailableError || classifyError(voiceError) === "depleted";
    await sendTelegramMessage(
      chatId,
      unavailable
        ? "Voice notes are unavailable right now. Please type your message."
        : "Sorry, I had trouble processing that voice note. Please try typing your message."
    );
    throw voiceError;
  }
}
```

- [ ] **Step 6: Pass the voice duration from the route**

In `app/api/telegram/route.ts`, inside the voice block, replace:

```ts
          const transcription = await handleVoiceNoteAction({
            chatId,
            fileId: audioObj.file_id,
            mimeType: audioObj.mime_type,
          });
```

with:

```ts
          const transcription = await handleVoiceNoteAction({
            chatId,
            fileId: audioObj.file_id,
            mimeType: audioObj.mime_type,
            durationSeconds: audioObj.duration,
          });
```

- [ ] **Step 7: Run to verify it passes; type-check and regress**

Run: `npm run test:ai-router && npm run test:ego && npx tsc --noEmit`
Expected: both suites PASS (every section `✅`); tsc exits 0 with no output.

- [ ] **Step 8: Commit**

```bash
git add lib/ai/transcribe.ts lib/voice-transcribe.ts app/api/telegram/route.ts scripts/test-ai-router.ts scripts/test-ego.ts package.json package-lock.json
git commit -m "feat(voice): transcribe voice notes with OpenAI speech-to-text instead of Gemini"
```

---

### Task 3: Remove every remaining Gemini reference

**Files:**
- Modify: `lib/assistant-intent.ts`, `lib/image-intent.ts`, `lib/paylah-sync.ts`, `app/page.tsx`, `scripts/setup-sheet-dashboard.mjs`, `scripts/eval-ego.ts`, `scripts/test-intents.ts`, `scripts/ai-live-check.ts`, `scripts/bench/fixtures.ts`, `scripts/bench/util.ts`, `scripts/bench/model-cost.ts`, `scripts/bench/intent-latency.ts`, `scripts/bench/parallel-vs-sequential.ts`, `package.json`, `scripts/test-ai-router.ts`

- [ ] **Step 1: Write the failing guard test**

Add above `// ---- runner ----` in `scripts/test-ai-router.ts`:

```ts
section("no Gemini reference remains in app code, scripts, README or package.json", () => {
  const root = process.cwd();
  const self = path.join(root, "scripts/test-ai-router.ts");
  const targets = [
    ...sourceFiles(path.join(root, "app")),
    ...sourceFiles(path.join(root, "lib")),
    ...sourceFiles(path.join(root, "scripts")),
    path.join(root, "README.md"),
    path.join(root, "package.json"),
  ].filter((f) => f !== self);
  const offenders = targets
    .filter((f) => /gemini|@ai-sdk\/google|GOOGLE_GENERATIVE_AI/i.test(fs.readFileSync(f, "utf8")))
    .map((f) => path.relative(root, f));
  assert.deepEqual(offenders, [], "Gemini is removed; use Claude");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:ai-router`
Expected: FAIL, the offenders list includes `app/page.tsx`, `lib/assistant-intent.ts`, `lib/image-intent.ts`, `lib/paylah-sync.ts`, `scripts/*`, `README.md`, `package.json`.

- [ ] **Step 3: Library edits**

`lib/assistant-intent.ts`: replace

```ts
  if (
    !process.env.GOOGLE_GENERATIVE_AI_API_KEY &&
    !process.env.PERPLEXITY_API_KEY &&
    !process.env.ANTHROPIC_API_KEY
  ) {
    throw new Error(
      "AI API keys are missing (GOOGLE_GENERATIVE_AI_API_KEY, PERPLEXITY_API_KEY or ANTHROPIC_API_KEY)."
    );
  }
```

with:

```ts
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is missing.");
  }
```

`lib/image-intent.ts`: replace

```ts
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY && !process.env.ANTHROPIC_API_KEY) {
    throw new Error("GOOGLE_GENERATIVE_AI_API_KEY or ANTHROPIC_API_KEY is missing.");
  }
```

with:

```ts
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is missing.");
  }
```

`lib/paylah-sync.ts`: replace the comment `// 2. Fallback to Gemini AI if regex did not match (Universal Receipt Parser)` with `// 2. Fall back to the AI parser if regex did not match (Universal Receipt Parser)`.

- [ ] **Step 4: Landing page and dashboard wording**

`app/page.tsx` (text only; skim `node_modules/next/dist/docs/` is not needed for copy changes). Replace each of these exact strings:

- `Gemini 3.6 Flash: Category 'Dining' • Item 'Kaya Toast Set'` with `Claude Haiku: Category 'Dining' • Item 'Kaya Toast Set'`
- `badge: "Gemini 3.6 Flash Audio",` with `badge: "Speech-to-Text Audio",`
- `label: "GEMINI_AUDIO"` with `label: "VOICE_STT"`
- `badge: "Gemini Vision OCR",` with `badge: "Claude Vision OCR",`
- `Streamed buffer to Gemini 3.6 Flash pipeline` with `Streamed buffer to Claude vision pipeline`
- `streaming Opus audio directly to Gemini 3.6 Flash.` with `streaming Opus audio directly to a speech-to-text model.`
- `desc: "Gemini 3.6 Flash multimodal audio/vision & deterministic regex fast-path.",` with `desc: "Claude multimodal vision, speech-to-text audio & deterministic regex fast-path.",`
- `<span>Built with Next.js, Vercel AI SDK &amp; Gemini</span>` with `<span>Built with Next.js, Vercel AI SDK &amp; Claude</span>`

`scripts/setup-sheet-dashboard.mjs`: replace `Auto-categorized via Gemini AI` with `Auto-categorized via Claude AI`.

- [ ] **Step 5: Scripts**

`scripts/test-intents.ts`: replace `!process.env.GOOGLE_GENERATIVE_AI_API_KEY` with `!process.env.ANTHROPIC_API_KEY` and `provide GOOGLE_GENERATIVE_AI_API_KEY in .env.local` with `provide ANTHROPIC_API_KEY in .env.local`.

`scripts/ai-live-check.ts`: replace `available: () => ({ gemini: false, perplexity: false, anthropic: true }),` with `available: () => ({ anthropic: true, perplexity: false, openai: false }),`.

`scripts/eval-ego.ts`:
- Replace `needs GOOGLE_GENERATIVE_AI_API_KEY` in the header with `needs ANTHROPIC_API_KEY`.
- Remove the line `import { google } from "@ai-sdk/google";`.
- Replace the whole block from `/**\n * Override to compare models` through the `const evalModel = () => ...` definition (including `EVAL_IS_CLAUDE`) with:

```ts
/**
 * Model to score, a Claude model id (optionally with an `anthropic:` prefix), e.g.
 * EGO_EVAL_MODEL=claude-haiku-5-5. Production routing is decided by lib/ai/router.
 */
const EVAL_MODEL = (process.env.EGO_EVAL_MODEL ?? "claude-sonnet-5-5").replace(/^anthropic:/, "");
// The Claude provider bundles a newer copy of @ai-sdk/provider; same v4 spec, different nominal types.
const evalModel = () => anthropic(EVAL_MODEL) as never;
```

- Replace `process.argv.includes("--dry-run") || !process.env.GOOGLE_GENERATIVE_AI_API_KEY` with `process.argv.includes("--dry-run") || !process.env.ANTHROPIC_API_KEY`, and `Set GOOGLE_GENERATIVE_AI_API_KEY to run live.` with `Set ANTHROPIC_API_KEY to run live.`
- Delete the line `      ...(EVAL_IS_CLAUDE ? {} : { temperature: 0 }),` (Claude models reject non-default temperature).

`scripts/bench/fixtures.ts`: replace

```ts
export const MODEL_IDS = [
  "gemini-flash-lite-latest",
  "gemini-3.6-flash",
  "sonar",
] as const;
```

with:

```ts
export const MODEL_IDS = [
  "claude-haiku-5-5",
  "claude-sonnet-5-5",
  "claude-opus-5-5",
  "sonar",
] as const;
```

`scripts/bench/util.ts`: replace the pricing doc comment and the `PRICING_PER_MILLION_TOKENS_USD` table (from `/**\n * Published per-1M-token pricing (paid tier)` through the closing `};` of the table) with:

```ts
/**
 * Published per-1M-token pricing, checked 2026-10-17 against the Claude API model table
 * and (for Sonar) Perplexity's pricing page. Re-verify before quoting these publicly,
 * these prices change.
 */
export const PRICING_PER_MILLION_TOKENS_USD: Record<
  string,
  { input: number; output: number; note: string }
> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5, note: "Prompts up to 100K tokens" },
  "claude-sonnet-5-5": { input: 2.0, output: 10.0, note: "" },
  "claude-opus-5-5": { input: 4.0, output: 20.0, note: "" },
  sonar: {
    input: 1.0,
    output: 1.0,
    note: "Excludes Perplexity's $5-12 per 1,000-request search-context fee",
  },
};
```

`scripts/bench/model-cost.ts`:
- Header comment: replace "across the three models in the\n * assistant's fallback chain (gemini-flash-lite-latest, gemini-3.6-flash,\n * perplexity/sonar)" with "across the Claude tiers\n * (Haiku, Sonnet, Opus) and Perplexity Sonar" (keep the surrounding comment lines intact), and `Requires GOOGLE_GENERATIVE_AI_API_KEY and, to include Sonar` with `Requires ANTHROPIC_API_KEY and, to include Sonar`.
- Replace `import { google } from "@ai-sdk/google";` with `import { anthropic } from "@ai-sdk/anthropic";`.
- Replace `requireEnv("GOOGLE_GENERATIVE_AI_API_KEY");` with `requireEnv("ANTHROPIC_API_KEY");`.
- In `resolveModel`, replace `return google(key);` with `return anthropic(key) as never;`.
- In the `generateText` call inside `benchModel`, replace `        maxOutputTokens: 800,\n        temperature: 0,` with `        maxOutputTokens: 4096,\n        ...(key === "sonar" ? { temperature: 0 } : {}),` (Claude rejects non-default temperature and thinks before answering).
- Replace `const keysToRun: ModelKey[] = ["gemini-flash-lite-latest", "gemini-3.6-flash"];` with `const keysToRun: ModelKey[] = ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"];`.
- Replace `results.find((r) => r.key === "gemini-flash-lite-latest")` with `results.find((r) => r.key === "claude-haiku-5-5")`, and `Cost reduction vs each fallback tier` with `Cost reduction vs each other model`, and `flash-lite is ${reduction.toFixed(1)}% cheaper per call than ${r.key}` with `Haiku is ${reduction.toFixed(1)}% cheaper per call than ${r.key}`.

`scripts/bench/intent-latency.ts`: replace `(including its Flash-Lite -> 3.6-Flash -> Sonar fallback chain exactly as\n * shipped)` with `(including its Haiku -> Sonnet -> Opus escalation exactly as\n * shipped)`, `Requires GOOGLE_GENERATIVE_AI_API_KEY (matches` with `Requires ANTHROPIC_API_KEY (matches`, `one real Gemini call per test message` with `one real Claude call per test message`, and `requireEnv("GOOGLE_GENERATIVE_AI_API_KEY");` with `requireEnv("ANTHROPIC_API_KEY");`.

`scripts/bench/parallel-vs-sequential.ts`: replace `the SAME real Gemini receipt-parsing calls` with `the SAME real Claude receipt-parsing calls`, `Requires GOOGLE_GENERATIVE_AI_API_KEY.` with `Requires ANTHROPIC_API_KEY.`, `import { google } from "@ai-sdk/google";` with `import { anthropic } from "@ai-sdk/anthropic";`, `requireEnv("GOOGLE_GENERATIVE_AI_API_KEY");` with `requireEnv("ANTHROPIC_API_KEY");`, `const model = google("gemini-flash-lite-latest");` with `const model = anthropic("claude-haiku-5-5") as never;`, `    prompt,\n    temperature: 0,\n  });` with `    prompt,\n    maxOutputTokens: 4096,\n  });`, and `real Gemini receipt-parsing calls: sequential` with `real Claude receipt-parsing calls: sequential`.

- [ ] **Step 6: Remove the dependency**

Run: `npm uninstall @ai-sdk/google`
Expected: `@ai-sdk/google` is gone from `package.json` and the lockfile; exit 0.

- [ ] **Step 7: Run to verify it passes**

Run: `npm run test:ai-router && npx tsc --noEmit && npm run lint`
Expected: PASS including the new guard section (README still lists Gemini, so the guard fails until Task 4: if the ONLY offender is `README.md`, that is expected here; Task 4 clears it). tsc exits 0; lint has 0 errors.

- [ ] **Step 8: Commit**

```bash
git add lib app scripts package.json package-lock.json
git commit -m "refactor: remove every Gemini reference from code, scripts and tooling"
```

---

### Task 4: README, live checks, final verification

**Files:**
- Modify: `README.md`, `scripts/ai-live-check.ts`
- Create: `scripts/stt-live-check.ts`

- [ ] **Step 1: Rewrite the README**

In `README.md`:

1. In the intro paragraph replace `**Google Gemini 3.6 Flash**` with `**Anthropic Claude (Haiku, Sonnet, Opus)**` and `**Perplexity Sonar**,` with `**Perplexity Sonar**, **OpenAI speech-to-text**,`.
2. Replace `Gemini extracts start/end times` with `Claude extracts start/end times`.
3. Replace the table row `| **AI Models** | Google Gemini 3.6 Flash & Perplexity Sonar via Vercel AI SDK |` with `| **AI Models** | Anthropic Claude (Haiku, Sonnet, Opus), Perplexity Sonar search and OpenAI speech-to-text via Vercel AI SDK |`.
4. Replace the whole section starting at `## 🔁 Claude fallback and credit tracking` up to (not including) `## 🧠 The EGO orchestrator` with:

```markdown
## 🤖 Models, voice and credit tracking

EGO runs entirely on Claude. Each job starts at the cheapest tier that does it well and escalates only if a call fails: **Haiku** for simple jobs (intent classifier, email and receipt parsing), **Sonnet** for the orchestrator, the finance and workout agents and image reading, and **Opus** as the last resort. **Perplexity Sonar** answers live web questions; if it is out of credit, Claude answers from its own knowledge and says so. **Voice notes** are transcribed by OpenAI speech-to-text (Claude cannot take audio), then handled like typed messages.

- **Keys (in `.env.local` and Vercel):** `ANTHROPIC_API_KEY`, `PERPLEXITY_API_KEY`, `OPENAI_API_KEY` (voice).
- **Tell EGO your balances:** `/credits set claude 20.00` and `/credits set perplexity 8.94` (the current dashboard balance in USD). `/credits` shows the estimate and percent left.
- **Warnings:** EGO messages you once when a balance falls to 10% left and again at 5%. If Claude itself reports its credits depleted, you get an urgent alert (at most one per 30 minutes), because there is no other provider to fall back to.
- **Voice unavailable?** If the speech-to-text account is missing or out of credit, EGO asks you to type your message instead.
- **Tests:** `npm run test:ai-router` (offline), `npm run check:ai-live` (a few cents), `npm run check:stt-live -- <audio file>` (a fraction of a cent), and `npm run eval:ego` (routing accuracy on Claude Sonnet; `EGO_EVAL_MODEL=claude-haiku-5-5` to compare).
```

- [ ] **Step 2: Add a Perplexity search check to `scripts/ai-live-check.ts`**

Replace the router construction's `makeModel` and `available` so search can hit Perplexity. Change the imports to add `import { perplexity } from "@ai-sdk/perplexity";`, replace

```ts
    available: () => ({ anthropic: true, perplexity: false, openai: false }),
    makeModel: (c) => claudeModel(c.modelId),
```

with:

```ts
    available: () => ({
      anthropic: true,
      perplexity: Boolean(process.env.PERPLEXITY_API_KEY),
      openai: false,
    }),
    makeModel: (c) => (c.provider === "perplexity" ? perplexity(c.modelId) : claudeModel(c.modelId)),
```

and insert before the final `if (failed) process.exit(1);`:

```ts
  // Search: Perplexity Sonar first (when its key is set), Claude as the fallback.
  try {
    const { result, handle } = await router.generateTextRouted("search", {
      system: "Answer in one short sentence.",
      prompt: "What is the capital of Australia?",
      temperature: 0.2,
      maxOutputTokens: 200,
    });
    console.log(`  ✅ search via ${handle.provider}/${handle.modelId} -> "${result.text.trim().slice(0, 60)}"`);
    if (process.env.PERPLEXITY_API_KEY && handle.provider !== "perplexity") {
      throw new Error("Perplexity key is set but search was answered by Claude (Perplexity may be out of credit).");
    }
  } catch (error) {
    failed = true;
    console.error("  ❌ search:", error instanceof Error ? error.message : error);
  }
```

- [ ] **Step 3: Create `scripts/stt-live-check.ts` and its npm script**

Add to `package.json` scripts: `"check:stt-live": "node --experimental-strip-types --import ./scripts/bench/register.mjs scripts/stt-live-check.ts",`.

Create `scripts/stt-live-check.ts`:

```ts
/**
 * Transcribes one real audio file with the production speech-to-text call. Use a Telegram-style
 * voice note (OGG/Opus) to prove those are accepted. Costs a fraction of a cent. Uses no-op
 * usage recording, so nothing is written to Google Sheets.
 *
 * Usage: npm run check:stt-live -- path/to/voice.ogg
 */
import fs from "node:fs";
import { realTranscribeRun, transcribeAudio } from "../lib/ai/transcribe";
import { buildTranscriptionPrompt } from "../lib/voice-transcribe";
import { loadEnvLocal } from "./bench/util";

async function run() {
  loadEnvLocal();
  const file = process.argv.slice(2).find((a) => !a.startsWith("--"));
  if (!file || !fs.existsSync(file)) {
    console.error("Usage: npm run check:stt-live -- path/to/voice.ogg");
    process.exit(1);
  }
  if (!process.env.OPENAI_API_KEY) {
    console.error("OPENAI_API_KEY is not set in .env.local.");
    process.exit(1);
  }

  const audio = new Uint8Array(fs.readFileSync(file));
  const started = Date.now();
  const text = await transcribeAudio(
    { audio, prompt: buildTranscriptionPrompt(["Priya"]), durationSeconds: 5 },
    {
      available: () => true,
      run: realTranscribeRun,
      recordUsage: async () => {},
      now: () => new Date(),
    }
  );
  console.log(`  ✅ transcribed ${audio.length} bytes in ${Date.now() - started}ms -> "${text}"`);
}

run().catch((err) => {
  console.error("  ❌", err instanceof Error ? err.message : err);
  process.exit(1);
});
```

- [ ] **Step 4: Full verification**

Run: `npx tsc --noEmit && npm run lint && npm test && npm run build`
Expected: tsc exits 0; lint 0 errors (one pre-existing warning `flushed` in `workout-session.ts` is expected); all suites PASS including "AI Router" with the Gemini guard now clean; build succeeds and `/api/telegram` is still a dynamic route.

- [ ] **Step 5: Live Claude and Perplexity check**

Run: `npm run check:ai-live`
Expected: `✅` for Haiku, Sonnet, Opus, vision, and `search via perplexity/sonar`. If search shows `anthropic` while the Perplexity key is set, Perplexity is out of credit: report it (the fallback working is the correct behavior, but the user should know).

- [ ] **Step 6: Live speech-to-text check (blocked until the user adds `OPENAI_API_KEY`)**

If `OPENAI_API_KEY` is set: create a short voice sample in the scratch directory (macOS: `say -o <scratch>/sample.aiff "spent twelve fifty on lunch"`, then `ffmpeg -i <scratch>/sample.aiff -c:a libopus <scratch>/sample.ogg` if ffmpeg exists; otherwise ask the user to send a real Telegram voice note's file) and run `npm run check:stt-live -- <scratch>/sample.ogg`.
Expected: a transcript close to the spoken sentence. If OGG/Opus is rejected, report the exact error and convert to a supported format (e.g. mp3/wav) inside `transcribeTelegramVoiceNote` as a follow-up fix, test-first.
If `OPENAI_API_KEY` is NOT set: stop here, report this step as blocked, and do not mark Task 4 complete.

- [ ] **Step 7: Routing eval on Claude**

Run: `npm run eval:ego`
Expected: accuracy at or above 85% (the gate) on Claude Sonnet. Then run `EGO_EVAL_MODEL=claude-haiku-5-5 npm run eval:ego` for information only. If Sonnet is below 85%, tighten the failing rules in `lib/agent/ego-prompt.ts` test-first and re-run; never lower the threshold.

- [ ] **Step 8: Commit and final review**

```bash
git add README.md scripts package.json package-lock.json
git commit -m "docs: rewrite the README for the Claude-only setup; add Perplexity and speech-to-text live checks"
```

Then run the whole-branch review (`review-package` from `origin/main` to `HEAD`), fix Critical and Important findings test-first, and hand back. Do NOT push; tell the user `main` is ahead of `origin/main` and ask before pushing or deploying.

---

## Self-Review

**Spec coverage:** Claude-only routing with the Haiku/Sonnet/Opus chains and `search` through Perplexity then Claude (spec §1): Task 1. Slimmed credits, 10%/5% warnings once each, re-arm on set, depletion alert with 30-minute rate limit, `/credits` for claude/perplexity and rejecting gemini (spec §2): Task 1. Speech-to-text with OpenAI behind a small module, vocabulary prompt, unavailable message, cost logging (spec §3): Task 2. Removal of Gemini from code, scripts, bench, eval, landing page, package (spec §4): Task 3. README rewrite (spec §5): Task 4. Offline tests, guard test, live checks, eval gate, release gate, no push (spec §6): Tasks 1-4. Risks (single provider, cost, drift): alerts, warnings, `/credits`.

**Placeholder scan:** none. Every code step shows code; script edits give exact old and new strings; the two live steps state the exact commands and expected output, and the blocked case is explicit.

**Type consistency:** `Provider`/`Role`/`BalanceStatus`/`WarningLevel` (Task 1 `mode.ts`) are used identically in `ledger.ts`, `router.ts`, `sheets-store.ts`, `transcribe.ts` and the tests. `CreditProvider` is `"anthropic" | "perplexity"` everywhere, and `/credits` maps the word `claude` to `anthropic`. `RouterDeps.ledger` is `Pick<Ledger, "recordUsage" | "checkWarnings" | "alertDepleted">`, which `aiLedger` satisfies. `TranscribeDeps` fields (`available`, `run`, `recordUsage`, `now`) match between `transcribe.ts`, its tests and the live-check script. `handleVoiceNoteAction`'s new `durationSeconds` matches the route call.

**Review Focus coverage:** Claude depletion alert and loud failure (Task 1 router test), warning boundaries/once-each/jump/re-arm (Task 1 ledger tests), Perplexity breaker with search degrade (Task 1 router test), voice unavailable and cleanup (Task 2 transcribe tests), old sheet layout migration (Task 1 `needsLayoutMigration` test, confirmed manually after deploy via `/credits`).
