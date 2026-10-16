# Claude Fallback and Tiered Model Router Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route every model call through one router that moves all work to Claude (Haiku, then Sonnet, then Opus) when both Gemini and Perplexity credits are at 5% or less, and falls back per call when a provider reports its credits depleted.

**Architecture:** A new `lib/ai/` module owns model choice. Pure functions (`mode.ts`, `pricing.ts`) decide the mode and candidate models; a ledger (`ledger.ts`, with a Google Sheets store) tracks estimated spend against balances the user sets with `/credits`; a router (`router.ts`) wraps `generateText` and agent runs with fallback, usage recording and Claude-specific parameter handling. All 13 call sites switch from `google(...)`/`perplexity(...)` to router roles.

**Tech Stack:** Next.js 16, TypeScript, Vercel AI SDK v7 (`ai`), `@ai-sdk/anthropic` 4.x (new), `@ai-sdk/google`, `@ai-sdk/perplexity`, Google Sheets API (existing `getSheetsClient`), Node `--experimental-strip-types` test scripts.

**Spec:** `docs/superpowers/specs/2026-10-16-claude-fallback-design.md`

## Global Constraints

- Branch: `feat/claude-fallback` (already created from `main` at `05a59f5`). Commit messages are conventional and carry NO `Co-Authored-By` trailer (user preference). Run commit steps only if the user has authorised commits for the session; never push or merge without being asked.
- Claude model IDs are exactly `claude-haiku-5-5`, `claude-sonnet-5-5`, `claude-opus-5-5` (no date suffix).
- Switch threshold is `0.05` (5% or less remaining), both providers, then everything except `audio` goes to Claude.
- Claude 5.5 models reject non-default sampling parameters: the router strips `temperature` (and never sends `topP`/`topK`) for Claude. It also floors `maxOutputTokens` at 4096 for Claude because thinking is always on.
- Voice notes (`audio` role) are Gemini-only. Claude cannot take audio.
- Never print, log or commit `ANTHROPIC_API_KEY` or any other secret. It already exists in `.env.local`; do not echo it. Live checks spend a few cents of the user's Anthropic credit.
- Do not write to the user's real production spreadsheet from tests or scripts; the Sheets store is exercised only by the user sending `/credits` after deploy.
- Tests run with `node --experimental-strip-types`: type-only imports MUST use `import type`, no enums, no constructor parameter properties. Inside `lib/ai/`, import siblings with relative paths (`./mode`). `@/` aliases work elsewhere (resolved by `scripts/bench/ts-loader.mjs`).
- Test commands run from the repo root (`/Users/evanyap7/telegram-personal-assistant`).
- `AGENTS.md`: this Next.js has breaking changes; for `app/` edits, the bundled docs under `node_modules/next/dist/docs/` are authoritative. Verified: `export const maxDuration = <seconds>` is a supported route segment config.
- Existing price constants come from `scripts/bench/util.ts` (checked 2026-09-12); Claude prices from the Claude API model table (checked 2026-10-16).

## Function duration recommendation (the user delegated this)

Vercel's documented limits with Fluid Compute are 300 s default and maximum on Hobby, and 300 s default and 800 s maximum on Pro. EGO's worst case is the orchestrator's 10 model steps (about 4 s each) plus a delegate agent's 8 steps, roughly 60-90 s. **Set `export const maxDuration = 120` on `app/api/telegram/route.ts`.** It leaves headroom over the worst case, stops a runaway agent loop well before the platform default, and sits inside both plans' limits. Telegram retries a webhook that does not answer, but the route already de-duplicates updates. If the Vercel project does not have Fluid Compute enabled, confirm the dashboard shows at least 120 s allowed for this function. (Task 7.)

## Review Focus

Failure modes the spec implies but a first read would miss, most likely first. Each has a test in the owning task.

- **The credit ledger (Google Sheets) is unreachable:** the router must keep working in default `credits` mode, never throw because bookkeeping failed. (Task 3)
- **A Gemini per-minute rate limit whose message says "quota":** it must NOT be classified as credits depleted, or one rate-limit blip flips everything to Claude for 30 minutes. (Task 1)
- **Tiny `maxOutputTokens` (the Apple Pay categorizer sends 20) on a Claude model with always-on thinking:** output would be cut off or empty; the router must floor it. (Task 3)
- **An agent that already ran a tool must not be re-run on another model after a failure** (duplicate writes). (Task 3 and Task 5)
- **Exact 5% boundary, unknown balance, zero balance, and a top-up:** 5.0% remaining switches, 5.1% does not, a missing balance never triggers, and a re-set balance restarts spend counting from that moment. (Tasks 1 and 2)

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/ai/mode.ts` (create) | Types, 5% rule, mode decision, error classification, Claude chains, candidate selection. Pure. |
| `lib/ai/pricing.ts` (create) | Price table and `costUsd`. Pure. |
| `lib/ai/ledger.ts` (create) | Ledger logic over an injected store: state, notices, balances, depletion marker, `/credits` text. |
| `lib/ai/sheets-store.ts` (create) | Google Sheets implementation of the ledger store (`AICredits`, `AIUsage` sheets). |
| `lib/ai/router.ts` (create) | `createRouter`, `withModelFallback`, `runText`, `generateTextRouted`, usage recording, default wiring. |
| `lib/ai/commands.ts` (create) | `parseCreditsCommand`, `handleCreditsCommand`. |
| `scripts/test-ai-router.ts` (create) | Offline unit tests for everything above. |
| `scripts/ai-live-check.ts` (create) | One real call per Claude model (spends cents). |
| `lib/assistant-intent.ts`, `lib/search.ts`, `lib/image-intent.ts`, `lib/voice-transcribe.ts`, `lib/paylah-sync.ts`, `app/api/apple-wallet/route.ts`, `lib/workout/workout-handler.ts` (modify) | Move to router roles. |
| `lib/agent/finance-agent.ts`, `lib/agent/workout-agent.ts`, `lib/agent/ego-orchestrator.ts` (modify) | Run agents through `withModelFallback`. |
| `lib/telegram/command-router.ts`, `lib/telegram/menu-builder.ts` (modify) | `/credits` command, menu entry. |
| `app/api/telegram/route.ts` (modify) | `maxDuration`. |
| `scripts/eval-ego.ts` (modify) | `anthropic:` model prefix. |
| `package.json`, `scripts/test-all.ts`, `README.md` (modify) | Dependency, scripts, docs. |

---

### Task 1: Dependency, pricing, and the pure mode logic

**Files:**
- Create: `lib/ai/pricing.ts`, `lib/ai/mode.ts`, `scripts/test-ai-router.ts`
- Modify: `package.json` (dependency and scripts), `scripts/test-all.ts`

**Interfaces:**
- Produces from `mode.ts`: `type Provider = "gemini" | "perplexity" | "anthropic"`; `type Role = "classifier" | "parse" | "agent" | "vision" | "search" | "audio"`; `type Mode = "credits" | "claude"`; `type ErrorKind = "depleted" | "transient" | "other"`; `interface ProviderStatus { startBalanceUsd: number | null; spentUsd: number; depleted: boolean }`; `interface Candidate { provider: Provider; modelId: string }`; `const SWITCH_THRESHOLD = 0.05`; `remainingUsd(s)`, `remainingFraction(s)`, `isNearlyOut(s, threshold?)`, `decideMode(gemini, perplexity): Mode`, `classifyError(error): ErrorKind`, `claudeChain(role): Candidate[]`, `candidatesFor(role, mode, depleted, available): Candidate[]` where `depleted: { gemini: boolean; perplexity: boolean }` and `available: Record<Provider, boolean>`.
- Produces from `pricing.ts`: `PRICING_AS_OF`, `PRICING_PER_MILLION_TOKENS_USD`, `PERPLEXITY_REQUEST_FEE_USD`, `costUsd(modelId: string, inputTokens: number, outputTokens: number): number`.
- Produces: the `scripts/test-ai-router.ts` harness (`section(name, fn)` blocks above `// ---- runner ----`).

- [ ] **Step 1: Install the Claude provider**

Run: `npm install @ai-sdk/anthropic@^4.0.81`
Expected: `package.json` gains `"@ai-sdk/anthropic": "^4.0.81"` and the lockfile updates; exit 0.

- [ ] **Step 2: Create the test harness with the first failing tests**

Create `scripts/test-ai-router.ts`:

```ts
import assert from "node:assert/strict";
import {
  SWITCH_THRESHOLD,
  candidatesFor,
  claudeChain,
  classifyError,
  decideMode,
  isNearlyOut,
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

section("candidates: a depleted provider is skipped; missing keys are filtered", () => {
  const search = candidatesFor("search", "credits", { gemini: false, perplexity: true }, ALL).map((c) => c.modelId);
  assert.deepEqual(search, ["gemini-3.6-flash", "claude-sonnet-5-5", "claude-opus-5-5"]);
  const noClaudeKey = candidatesFor("agent", "credits", NONE_DEPLETED, { ...ALL, anthropic: false }).map(
    (c) => c.modelId
  );
  assert.deepEqual(noClaudeKey, ["gemini-3.6-flash"], "no Claude key means no Claude candidates");
  const audioDepleted = candidatesFor("audio", "credits", { gemini: true, perplexity: false }, ALL);
  assert.deepEqual(audioDepleted, [], "audio has no fallback when Gemini is depleted");
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
```

- [ ] **Step 3: Register the scripts**

In `package.json` `"scripts"`, add after the `"eval:ego"` line:

```json
    "test:ai-router": "node --experimental-strip-types --import ./scripts/bench/register.mjs scripts/test-ai-router.ts",
    "check:ai-live": "node --experimental-strip-types --import ./scripts/bench/register.mjs scripts/ai-live-check.ts",
```

In `scripts/test-all.ts` `SUITES`, add after the EGO entry:

```ts
  { name: "AI Router (credits, fallback, tiers)", command: "npm run test:ai-router" },
```

- [ ] **Step 4: Run to verify it fails**

Run: `npm run test:ai-router`
Expected: FAIL with `Cannot find module` for `lib/ai/mode`.

- [ ] **Step 5: Implement pricing**

Create `lib/ai/pricing.ts`:

```ts
/**
 * USD per 1M tokens. These are ESTIMATES used to track credit spend; the vendor
 * dashboards are the source of truth.
 *  - Gemini and Sonar: copied from scripts/bench/util.ts (vendor pages checked 2026-09-12).
 *  - Claude: Claude API model table, checked 2026-10-16 (Haiku 5.5 is $0.10/$0.50 for
 *    prompts up to 100K tokens).
 */
export const PRICING_AS_OF = "2026-10-16";

export const PRICING_PER_MILLION_TOKENS_USD: Record<string, { input: number; output: number }> = {
  "gemini-flash-lite-latest": { input: 0.3, output: 2.5 },
  "gemini-3.6-flash": { input: 0.75, output: 3.75 },
  sonar: { input: 1.0, output: 1.0 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "claude-sonnet-5-5": { input: 2.0, output: 10.0 },
  "claude-opus-5-5": { input: 4.0, output: 20.0 },
};

/**
 * Perplexity bills a per-request search fee ($5-12 per 1,000 requests). The top of the
 * range is used so the estimate errs toward switching early rather than late.
 */
export const PERPLEXITY_REQUEST_FEE_USD = 0.012;

/** Used for a model with no entry: deliberately expensive so spend is never under-counted. */
const CONSERVATIVE_DEFAULT = { input: 2.0, output: 10.0 };

export function costUsd(modelId: string, inputTokens: number, outputTokens: number): number {
  const price = PRICING_PER_MILLION_TOKENS_USD[modelId] ?? CONSERVATIVE_DEFAULT;
  const tokens = (inputTokens / 1_000_000) * price.input + (outputTokens / 1_000_000) * price.output;
  return modelId === "sonar" ? tokens + PERPLEXITY_REQUEST_FEE_USD : tokens;
}
```

- [ ] **Step 6: Implement the mode logic**

Create `lib/ai/mode.ts`:

```ts
export type Provider = "gemini" | "perplexity" | "anthropic";
export type Role = "classifier" | "parse" | "agent" | "vision" | "search" | "audio";
export type Mode = "credits" | "claude";
export type ErrorKind = "depleted" | "transient" | "other";

export interface ProviderStatus {
  /** What the user said the dashboard balance was when they last ran /credits set; null if never set. */
  startBalanceUsd: number | null;
  /** Estimated spend since that balance was set. */
  spentUsd: number;
  /** A depletion error was seen recently (circuit breaker). */
  depleted: boolean;
}

export interface Candidate {
  provider: Provider;
  modelId: string;
}

/** Both providers at or below this fraction of their balance sends everything to Claude. */
export const SWITCH_THRESHOLD = 0.05;

export function remainingUsd(s: ProviderStatus): number | null {
  return s.startBalanceUsd === null ? null : s.startBalanceUsd - s.spentUsd;
}

export function remainingFraction(s: ProviderStatus): number | null {
  if (s.startBalanceUsd === null) return null;
  if (s.startBalanceUsd <= 0) return 0;
  return Math.max(0, (s.startBalanceUsd - s.spentUsd) / s.startBalanceUsd);
}

export function isNearlyOut(s: ProviderStatus, threshold: number = SWITCH_THRESHOLD): boolean {
  if (s.depleted) return true;
  const fraction = remainingFraction(s);
  return fraction !== null && fraction <= threshold + 1e-9;
}

export function decideMode(gemini: ProviderStatus, perplexity: ProviderStatus): Mode {
  return isNearlyOut(gemini) && isNearlyOut(perplexity) ? "claude" : "credits";
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

const gemini = (modelId: string): Candidate => ({ provider: "gemini", modelId });
const perplexity = (modelId: string): Candidate => ({ provider: "perplexity", modelId });
const claude = (modelId: string): Candidate => ({ provider: "anthropic", modelId });

const HAIKU = "claude-haiku-5-5";
const SONNET = "claude-sonnet-5-5";
const OPUS = "claude-opus-5-5";

const PRIMARY: Record<Role, Candidate[]> = {
  classifier: [gemini("gemini-flash-lite-latest"), gemini("gemini-3.6-flash")],
  parse: [gemini("gemini-flash-lite-latest"), gemini("gemini-3.6-flash")],
  agent: [gemini("gemini-3.6-flash")],
  vision: [gemini("gemini-3.6-flash")],
  search: [perplexity("sonar"), gemini("gemini-3.6-flash")],
  audio: [gemini("gemini-3.6-flash")],
};

export function claudeChain(role: Role): Candidate[] {
  switch (role) {
    case "classifier":
    case "parse":
      return [claude(HAIKU), claude(SONNET), claude(OPUS)];
    case "agent":
    case "vision":
    case "search":
      return [claude(SONNET), claude(OPUS)];
    case "audio":
      return [];
  }
}

/**
 * Ordered models to try for a role. In claude mode Claude goes first; otherwise
 * Gemini/Perplexity go first with Claude as the tail. Audio never uses Claude.
 */
export function candidatesFor(
  role: Role,
  mode: Mode,
  depleted: { gemini: boolean; perplexity: boolean },
  available: Record<Provider, boolean>
): Candidate[] {
  const claudeCandidates = available.anthropic ? claudeChain(role) : [];
  if (mode === "claude" && claudeCandidates.length > 0) return claudeCandidates;
  const primaries = PRIMARY[role].filter(
    (c) => available[c.provider] && !(c.provider !== "anthropic" && depleted[c.provider])
  );
  return [...primaries, ...claudeCandidates];
}
```

- [ ] **Step 7: Run to verify it passes**

Run: `npm run test:ai-router`
Expected: PASS, all 9 sections print `✅`.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json lib/ai/pricing.ts lib/ai/mode.ts scripts/test-ai-router.ts scripts/test-all.ts docs/superpowers
git commit -m "feat(ai): add pricing and pure mode/fallback logic with tests"
```

---

### Task 2: Credit ledger and Sheets store

**Files:**
- Create: `lib/ai/ledger.ts`, `lib/ai/sheets-store.ts`
- Test: `scripts/test-ai-router.ts`

**Interfaces:**
- Consumes: `Mode`, `Provider`, `ProviderStatus`, `decideMode`, `remainingFraction`, `remainingUsd`, `SWITCH_THRESHOLD` (Task 1); `PRICING_AS_OF` (Task 1).
- Produces from `ledger.ts`: `type CreditProvider = "gemini" | "perplexity"`; `interface UsageRow { timestamp: string; provider: Provider; model: string; inputTokens: number; outputTokens: number; costUsd: number; role: string }`; `interface BalanceRow { startBalanceUsd: number; setAt: string }`; `interface LedgerMeta { announcedMode: Mode; depletedUntil: Partial<Record<CreditProvider, string>> }`; `interface LedgerStore` (methods below); `interface LedgerState { mode: Mode; gemini: ProviderStatus; perplexity: ProviderStatus }`; `interface Ledger { getState(): Promise<LedgerState>; markDepleted(p: CreditProvider): Promise<void>; recordUsage(row: UsageRow): Promise<void>; setBalance(p: CreditProvider, usd: number): Promise<void>; describe(): Promise<string> }`; `createLedger(deps: { store: LedgerStore; now: () => Date; notify: (text: string) => Promise<void> }): Ledger`; `sumSpent(rows: UsageRow[], provider: Provider, sinceIso: string): number`; `STATE_TTL_MS = 60_000`; `DEPLETED_COOLDOWN_MS = 1_800_000`; `modeChangeMessage(to, gemini, perplexity)`; `depletedMessage(provider)`.
- `LedgerStore`: `readBalances(): Promise<Partial<Record<CreditProvider, BalanceRow>>>`; `readUsage(): Promise<UsageRow[]>`; `readMeta(): Promise<LedgerMeta>`; `setBalance(p, usd, setAtIso): Promise<void>`; `setDepletedUntil(p, untilIso): Promise<void>`; `writeAnnouncedMode(mode): Promise<void>`; `appendUsage(row): Promise<void>`.
- Produces from `sheets-store.ts`: `createSheetsLedgerStore(): LedgerStore`.

- [ ] **Step 1: Write the failing tests**

Add to the imports at the top of `scripts/test-ai-router.ts`:

```ts
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
```

Add above `// ---- runner ----`:

```ts
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
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:ai-router`
Expected: FAIL, `Cannot find module` for `lib/ai/ledger`.

- [ ] **Step 3: Implement the ledger**

Create `lib/ai/ledger.ts`:

```ts
import {
  SWITCH_THRESHOLD,
  decideMode,
  remainingFraction,
  remainingUsd,
  type Mode,
  type Provider,
  type ProviderStatus,
} from "./mode";
import { PRICING_AS_OF } from "./pricing";

export type CreditProvider = "gemini" | "perplexity";

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

export interface LedgerMeta {
  announcedMode: Mode;
  depletedUntil: Partial<Record<CreditProvider, string>>;
}

export interface LedgerStore {
  readBalances(): Promise<Partial<Record<CreditProvider, BalanceRow>>>;
  readUsage(): Promise<UsageRow[]>;
  readMeta(): Promise<LedgerMeta>;
  setBalance(provider: CreditProvider, usd: number, setAtIso: string): Promise<void>;
  setDepletedUntil(provider: CreditProvider, untilIso: string): Promise<void>;
  writeAnnouncedMode(mode: Mode): Promise<void>;
  appendUsage(row: UsageRow): Promise<void>;
}

export interface LedgerState {
  mode: Mode;
  gemini: ProviderStatus;
  perplexity: ProviderStatus;
}

export interface Ledger {
  getState(): Promise<LedgerState>;
  markDepleted(provider: CreditProvider): Promise<void>;
  recordUsage(row: UsageRow): Promise<void>;
  setBalance(provider: CreditProvider, usd: number): Promise<void>;
  describe(): Promise<string>;
}

export const STATE_TTL_MS = 60_000;
export const DEPLETED_COOLDOWN_MS = 30 * 60_000;

const PROVIDER_NAME: Record<CreditProvider, string> = { gemini: "Gemini", perplexity: "Perplexity" };

/** Sum of recorded cost for one provider at or after `sinceIso` ("" means all time). ISO strings compare lexicographically. */
export function sumSpent(rows: UsageRow[], provider: Provider, sinceIso: string): number {
  let total = 0;
  for (const r of rows) {
    if (r.provider === provider && r.timestamp >= sinceIso) total += r.costUsd;
  }
  return total;
}

function percentLeft(s: ProviderStatus): string {
  if (s.depleted) return "depleted";
  const fraction = remainingFraction(s);
  return fraction === null ? "balance not set" : `${(fraction * 100).toFixed(1)}% left`;
}

export function modeChangeMessage(to: Mode, gemini: ProviderStatus, perplexity: ProviderStatus): string {
  if (to === "claude") {
    return `⚠️ Gemini (${percentLeft(gemini)}) and Perplexity (${percentLeft(perplexity)}) credits are almost used up. EGO is now using Claude (Haiku, Sonnet, Opus). Voice notes still use Gemini. After you top up, send /credits set gemini <balance> and /credits set perplexity <balance> to switch back.`;
  }
  return "✅ Credits topped up. EGO is back on Gemini and Perplexity.";
}

export function depletedMessage(provider: CreditProvider): string {
  const name = PROVIDER_NAME[provider];
  return `⚠️ ${name} says its credits are used up. EGO is sending ${name}'s work to Claude for now. After a top-up, send /credits set ${provider} <balance>.`;
}

export function createLedger(deps: {
  store: LedgerStore;
  now: () => Date;
  notify: (text: string) => Promise<void>;
}): Ledger {
  const { store, now, notify } = deps;
  let cache: { at: number; state: LedgerState } | null = null;

  async function getState(): Promise<LedgerState> {
    const nowMs = now().getTime();
    if (cache && nowMs - cache.at < STATE_TTL_MS) return cache.state;

    const [balances, usage, meta] = await Promise.all([
      store.readBalances(),
      store.readUsage(),
      store.readMeta(),
    ]);
    const nowIso = now().toISOString();

    const statusFor = (provider: CreditProvider): ProviderStatus => {
      const balance = balances[provider];
      const until = meta.depletedUntil[provider];
      return {
        startBalanceUsd: balance ? balance.startBalanceUsd : null,
        spentUsd: balance ? sumSpent(usage, provider, balance.setAt) : 0,
        depleted: Boolean(until && until > nowIso),
      };
    };

    const gemini = statusFor("gemini");
    const perplexity = statusFor("perplexity");
    const state: LedgerState = { mode: decideMode(gemini, perplexity), gemini, perplexity };
    cache = { at: nowMs, state };

    if (state.mode !== meta.announcedMode) {
      // Claim the change before notifying so a second instance is less likely to repeat it.
      await store.writeAnnouncedMode(state.mode);
      await notify(modeChangeMessage(state.mode, gemini, perplexity)).catch(() => {});
    }
    return state;
  }

  async function markDepleted(provider: CreditProvider): Promise<void> {
    const meta = await store.readMeta();
    const nowIso = now().toISOString();
    const existing = meta.depletedUntil[provider];
    if (existing && existing > nowIso) return;
    await store.setDepletedUntil(provider, new Date(now().getTime() + DEPLETED_COOLDOWN_MS).toISOString());
    cache = null;
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
    await getState();
  }

  async function describe(): Promise<string> {
    const [state, usage] = await Promise.all([getState(), store.readUsage()]);
    const line = (name: string, provider: CreditProvider, s: ProviderStatus) => {
      const left = remainingUsd(s);
      const fraction = remainingFraction(s);
      if (left === null || fraction === null || s.startBalanceUsd === null) {
        return `• ${name}: balance not set (send /credits set ${provider} <dashboard balance>)`;
      }
      return `• ${name}: about $${Math.max(0, left).toFixed(2)} left of $${s.startBalanceUsd.toFixed(2)} (${(
        fraction * 100
      ).toFixed(1)}%)${s.depleted ? " - reported depleted" : ""}`;
    };
    return [
      "🧠 AI credits (estimates from tracked usage)",
      `Mode: ${state.mode === "claude" ? "Claude fallback is ON" : "Gemini + Perplexity"}`,
      line("Gemini", "gemini", state.gemini),
      line("Perplexity", "perplexity", state.perplexity),
      `• Claude spend so far: $${sumSpent(usage, "anthropic", "").toFixed(2)}`,
      `EGO switches to Claude when both providers reach ${SWITCH_THRESHOLD * 100}% or less. Prices assumed as of ${PRICING_AS_OF}.`,
    ].join("\n");
  }

  return { getState, markDepleted, recordUsage, setBalance, describe };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:ai-router`
Expected: PASS for all sections including the nine new ledger sections.

- [ ] **Step 5: Implement the Sheets store**

Create `lib/ai/sheets-store.ts`:

```ts
import { getSheetsClient } from "../google";
import type {
  BalanceRow,
  CreditProvider,
  LedgerMeta,
  LedgerStore,
  UsageRow,
} from "./ledger";
import type { Mode, Provider } from "./mode";

const CREDITS_SHEET = "AICredits";
const USAGE_SHEET = "AIUsage";
// AICredits rows: 2 = gemini, 3 = perplexity, 4 = meta (announced mode lives in column E).
const ROW: Record<CreditProvider | "meta", number> = { gemini: 2, perplexity: 3, meta: 4 };

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
      requestBody: {
        values: [
          ["provider", "startBalanceUsd", "setAt", "depletedUntil", "announcedMode"],
          ["gemini", "", "", "", ""],
          ["perplexity", "", "", "", ""],
          ["meta", "", "", "", "credits"],
        ],
      },
    });
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
    range: `${CREDITS_SHEET}!A2:E4`,
  });
  return (res.data.values ?? []) as string[][];
}

export function createSheetsLedgerStore(): LedgerStore {
  return {
    async readBalances() {
      const rows = await readCredits();
      const out: Partial<Record<CreditProvider, BalanceRow>> = {};
      (["gemini", "perplexity"] as const).forEach((provider, i) => {
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
          provider: (r[1] ?? "gemini") as Provider,
          model: r[2] ?? "",
          inputTokens: Number(r[3]) || 0,
          outputTokens: Number(r[4]) || 0,
          costUsd: Number(r[5]) || 0,
          role: r[6] ?? "",
        })
      );
    },

    async readMeta() {
      const rows = await readCredits();
      const depletedUntil: LedgerMeta["depletedUntil"] = {};
      if (rows[0]?.[3]) depletedUntil.gemini = rows[0][3];
      if (rows[1]?.[3]) depletedUntil.perplexity = rows[1][3];
      const announced: Mode = rows[2]?.[4] === "claude" ? "claude" : "credits";
      return { announcedMode: announced, depletedUntil };
    },

    async setBalance(provider, usd, setAtIso) {
      await ensureSheets();
      await getSheetsClient().spreadsheets.values.update({
        spreadsheetId: spreadsheetId(),
        range: `${CREDITS_SHEET}!B${ROW[provider]}:D${ROW[provider]}`,
        valueInputOption: "RAW",
        requestBody: { values: [[usd, setAtIso, ""]] },
      });
    },

    async setDepletedUntil(provider, untilIso) {
      await ensureSheets();
      await getSheetsClient().spreadsheets.values.update({
        spreadsheetId: spreadsheetId(),
        range: `${CREDITS_SHEET}!D${ROW[provider]}`,
        valueInputOption: "RAW",
        requestBody: { values: [[untilIso]] },
      });
    },

    async writeAnnouncedMode(mode) {
      await ensureSheets();
      await getSheetsClient().spreadsheets.values.update({
        spreadsheetId: spreadsheetId(),
        range: `${CREDITS_SHEET}!E${ROW.meta}`,
        valueInputOption: "RAW",
        requestBody: { values: [[mode]] },
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

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: exit 0. (The Sheets store has no offline test by design; it is exercised by `/credits` after deploy.)

- [ ] **Step 7: Commit**

```bash
git add lib/ai/ledger.ts lib/ai/sheets-store.ts scripts/test-ai-router.ts
git commit -m "feat(ai): add credit ledger with Google Sheets store"
```

---

### Task 3: The router

**Files:**
- Create: `lib/ai/router.ts`
- Test: `scripts/test-ai-router.ts`

**Interfaces:**
- Consumes: Task 1 (`candidatesFor`, `classifyError`, `Candidate`, `Provider`, `Role`, `Mode`, `costUsd`); Task 2 (`createLedger`, `createSheetsLedgerStore`, `Ledger`, `LedgerState`, `UsageRow`).
- Produces from `router.ts`:
  - `CLAUDE_MIN_OUTPUT_TOKENS = 4096`
  - `interface ModelHandle { model: LanguageModel; provider: Provider; modelId: string; role: Role; isClaude: boolean; providerOptions?: Record<string, Record<string, unknown>>; sampling(temperature: number): { temperature?: number } }`
  - `class NoModelAvailableError extends Error` with a `role: Role` field.
  - `buildHandle(c: Candidate, role: Role, makeModel: (c: Candidate) => LanguageModel): ModelHandle`
  - `mergeProviderOptions(a, b)`
  - `interface RouterDeps { ledger: Pick<Ledger, "getState" | "markDepleted" | "recordUsage">; available(): Record<Provider, boolean>; makeModel(c: Candidate): LanguageModel; generate: typeof generateText }`
  - `createRouter(deps): { withModelFallback, runText, generateTextRouted, recordModelUsage }`
    - `withModelFallback<T>(role: Role, attempt: (h: ModelHandle) => Promise<T>, opts?: { canRetry?: () => boolean }): Promise<{ result: T; handle: ModelHandle }>`
    - `runText(handle: ModelHandle, params: RoutedParams): Promise<Awaited<ReturnType<typeof generateText>>>`
    - `generateTextRouted(role: Role, params: RoutedParams, opts?): Promise<{ result; handle }>`
    - `recordModelUsage(handle: ModelHandle, usage: { inputTokens?: number; outputTokens?: number } | undefined): Promise<void>`
  - Default singleton exports: `withModelFallback`, `runText`, `generateTextRouted`, `recordModelUsage`, `aiLedger` (the real ledger), `type RoutedParams`.

- [ ] **Step 1: Write the failing tests**

Add to the imports at the top of `scripts/test-ai-router.ts`:

```ts
import {
  CLAUDE_MIN_OUTPUT_TOKENS,
  NoModelAvailableError,
  buildHandle,
  createRouter,
  mergeProviderOptions,
  type RouterDeps,
} from "../lib/ai/router";
import type { LedgerState } from "../lib/ai/ledger";
```

Add above `// ---- runner ----`:

```ts
function routerHarness(overrides: {
  mode?: LedgerState["mode"];
  geminiDepleted?: boolean;
  perplexityDepleted?: boolean;
  failOn?: Record<string, unknown>;
  available?: Partial<Record<"gemini" | "perplexity" | "anthropic", boolean>>;
  getStateThrows?: boolean;
} = {}) {
  const generated: Array<Record<string, unknown>> = [];
  const used: UsageRow[] = [];
  const depletedMarks: string[] = [];
  const state: LedgerState = {
    mode: overrides.mode ?? "credits",
    gemini: { startBalanceUsd: 100, spentUsd: 10, depleted: overrides.geminiDepleted ?? false },
    perplexity: { startBalanceUsd: 10, spentUsd: 1, depleted: overrides.perplexityDepleted ?? false },
  };
  const deps: RouterDeps = {
    ledger: {
      getState: async () => {
        if (overrides.getStateThrows) throw new Error("sheets unreachable");
        return state;
      },
      markDepleted: async (p) => void depletedMarks.push(p),
      recordUsage: async (row) => void used.push(row),
    },
    available: () => ({ gemini: true, perplexity: true, anthropic: true, ...(overrides.available ?? {}) }),
    makeModel: (c) => ({ specificationVersion: "test", provider: c.provider, modelId: c.modelId }) as never,
    generate: (async (params: Record<string, unknown>) => {
      generated.push(params);
      const modelId = (params.model as { modelId: string }).modelId;
      const failure = overrides.failOn?.[modelId];
      if (failure) throw failure;
      return { text: `ok from ${modelId}`, usage: { inputTokens: 1000, outputTokens: 500 } };
    }) as never,
  };
  return { router: createRouter(deps), generated, used, depletedMarks };
}

const modelOf = (p: Record<string, unknown>) => (p.model as { modelId: string }).modelId;

section("router: credits mode uses the first Gemini model and keeps temperature", async () => {
  const h = routerHarness();
  const { result, handle } = await h.router.generateTextRouted("classifier", {
    prompt: "hi",
    temperature: 0,
    maxOutputTokens: 800,
  });
  assert.equal(handle.modelId, "gemini-flash-lite-latest");
  assert.equal((result as { text: string }).text, "ok from gemini-flash-lite-latest");
  assert.equal(h.generated[0].temperature, 0);
  assert.equal(h.generated[0].maxOutputTokens, 800);
});

section("router: claude mode uses Haiku for the classifier, strips temperature, floors tokens, sets low effort", async () => {
  const h = routerHarness({ mode: "claude" });
  const { handle } = await h.router.generateTextRouted("classifier", {
    prompt: "hi",
    temperature: 0,
    maxOutputTokens: 20,
  });
  assert.equal(handle.modelId, "claude-haiku-5-5");
  const params = h.generated[0];
  assert.equal("temperature" in params, false, "Claude models reject non-default sampling");
  assert.equal(params.maxOutputTokens, CLAUDE_MIN_OUTPUT_TOKENS, "always-on thinking needs headroom");
  assert.deepEqual(
    (params.providerOptions as { anthropic: { effort: string } }).anthropic.effort,
    "low"
  );
});

section("router: agent role starts at Sonnet in claude mode, without forced effort", async () => {
  const h = routerHarness({ mode: "claude" });
  const { handle } = await h.router.generateTextRouted("agent", { prompt: "hi" });
  assert.equal(handle.modelId, "claude-sonnet-5-5");
  assert.equal(h.generated[0].providerOptions, undefined);
});

section("router: depletion on Gemini marks it once, skips its other models and falls to Claude", async () => {
  const h = routerHarness({
    failOn: { "gemini-flash-lite-latest": { statusCode: 429, message: "Your prepayment credits are depleted" } },
  });
  const { handle } = await h.router.generateTextRouted("classifier", { prompt: "hi" });
  assert.equal(handle.modelId, "claude-haiku-5-5");
  assert.deepEqual(h.depletedMarks, ["gemini"]);
  assert.deepEqual(h.generated.map(modelOf), ["gemini-flash-lite-latest", "claude-haiku-5-5"], "gemini-3.6-flash is skipped");
});

section("router: a transient error tries the next Gemini model before Claude", async () => {
  const h = routerHarness({ failOn: { "gemini-flash-lite-latest": { statusCode: 500 } } });
  const { handle } = await h.router.generateTextRouted("classifier", { prompt: "hi" });
  assert.equal(handle.modelId, "gemini-3.6-flash");
  assert.deepEqual(h.depletedMarks, []);
});

section("router: Claude tiers escalate Haiku to Sonnet to Opus, then the last error is thrown", async () => {
  const boom = { statusCode: 400, message: "bad" };
  const h = routerHarness({
    mode: "claude",
    failOn: { "claude-haiku-5-5": boom, "claude-sonnet-5-5": boom },
  });
  const { handle } = await h.router.generateTextRouted("classifier", { prompt: "hi" });
  assert.equal(handle.modelId, "claude-opus-5-5");

  const all = routerHarness({
    mode: "claude",
    failOn: { "claude-haiku-5-5": boom, "claude-sonnet-5-5": boom, "claude-opus-5-5": boom },
  });
  await assert.rejects(() => all.router.generateTextRouted("classifier", { prompt: "hi" }), /bad/);
});

section("router: no retry once canRetry says a tool already ran", async () => {
  const h = routerHarness({ failOn: { "gemini-3.6-flash": { statusCode: 500 } } });
  await assert.rejects(
    () => h.router.withModelFallback("agent", async (handle) => h.router.runText(handle, { prompt: "hi" }), { canRetry: () => false }),
    (err: unknown) => (err as { statusCode?: number }).statusCode === 500
  );
  assert.equal(h.generated.length, 1, "no second model was tried");
});

section("router: audio never uses Claude and reports unavailability when Gemini is depleted", async () => {
  const ok = routerHarness({ mode: "claude" });
  const { handle } = await ok.router.generateTextRouted("audio", { prompt: "x" });
  assert.equal(handle.provider, "gemini");

  const depleted = routerHarness({ geminiDepleted: true });
  await assert.rejects(
    () => depleted.router.generateTextRouted("audio", { prompt: "x" }),
    (err: unknown) => err instanceof NoModelAvailableError
  );
});

section("router: ledger failure falls back to default routing instead of throwing", async () => {
  const h = routerHarness({ getStateThrows: true });
  const { handle } = await h.router.generateTextRouted("agent", { prompt: "hi" });
  assert.equal(handle.modelId, "gemini-3.6-flash");
});

section("router: records usage with the computed cost", async () => {
  const h = routerHarness({ mode: "claude" });
  await h.router.generateTextRouted("agent", { prompt: "hi" });
  assert.equal(h.used.length, 1);
  assert.equal(h.used[0].provider, "anthropic");
  assert.equal(h.used[0].model, "claude-sonnet-5-5");
  assert.equal(h.used[0].inputTokens, 1000);
  assert.equal(h.used[0].outputTokens, 500);
  assert.ok(Math.abs(h.used[0].costUsd - (1000 / 1e6) * 2 - (500 / 1e6) * 10) < 1e-12);
  assert.equal(h.used[0].role, "agent");
});

section("router: a missing Claude key keeps Gemini even in claude mode", async () => {
  const h = routerHarness({ mode: "claude", available: { anthropic: false } });
  const { handle } = await h.router.generateTextRouted("agent", { prompt: "hi" });
  assert.equal(handle.provider, "gemini");
});

section("handle and provider-option helpers", () => {
  const claudeHandle = buildHandle({ provider: "anthropic", modelId: "claude-haiku-5-5" }, "parse", () => ({}) as never);
  assert.deepEqual(claudeHandle.sampling(0), {});
  const geminiHandle = buildHandle({ provider: "gemini", modelId: "gemini-3.6-flash" }, "agent", () => ({}) as never);
  assert.deepEqual(geminiHandle.sampling(0), { temperature: 0 });
  assert.equal(geminiHandle.providerOptions, undefined);
  assert.deepEqual(
    mergeProviderOptions({ anthropic: { a: 1 } }, { anthropic: { b: 2 }, google: { c: 3 } }),
    { anthropic: { a: 1, b: 2 }, google: { c: 3 } }
  );
  assert.equal(mergeProviderOptions(undefined, undefined), undefined);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:ai-router`
Expected: FAIL, `Cannot find module` for `lib/ai/router`.

- [ ] **Step 3: Implement the router**

Create `lib/ai/router.ts`:

```ts
import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import { perplexity } from "@ai-sdk/perplexity";
import { generateText, type LanguageModel } from "ai";
import { sendTelegramMessage } from "../telegram";
import { createLedger, type Ledger, type LedgerState } from "./ledger";
import { candidatesFor, classifyError, type Candidate, type Provider, type Role } from "./mode";
import { costUsd } from "./pricing";
import { createSheetsLedgerStore } from "./sheets-store";

type GenerateTextParams = Parameters<typeof generateText>[0];
export type RoutedParams = Omit<GenerateTextParams, "model">;
type ProviderOptions = Record<string, Record<string, unknown>>;

/** Claude 5.5 models think by default, and thinking counts toward max tokens, so tiny limits cut answers off. */
export const CLAUDE_MIN_OUTPUT_TOKENS = 4096;
const USAGE_WRITE_TIMEOUT_MS = 2000;

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
  ledger: Pick<Ledger, "getState" | "markDepleted" | "recordUsage">;
  available(): Record<Provider, boolean>;
  makeModel(c: Candidate): LanguageModel;
  generate: typeof generateText;
}

const DEFAULT_STATE: LedgerState = {
  mode: "credits",
  gemini: { startBalanceUsd: null, spentUsd: 0, depleted: false },
  perplexity: { startBalanceUsd: null, spentUsd: 0, depleted: false },
};

export function createRouter(deps: RouterDeps) {
  async function currentState(): Promise<LedgerState> {
    try {
      return await deps.ledger.getState();
    } catch (error) {
      console.warn("AI credit ledger unavailable; using default routing:", error);
      return DEFAULT_STATE;
    }
  }

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
      USAGE_WRITE_TIMEOUT_MS
    ).catch(() => {});
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
   * Runs `attempt` on each candidate model for the role until one succeeds. Credits-depleted
   * errors mark the provider and skip its remaining models. `canRetry` lets callers forbid a
   * retry once side effects happened (agents that already ran a tool).
   */
  async function withModelFallback<T>(
    role: Role,
    attempt: (handle: ModelHandle) => Promise<T>,
    opts: { canRetry?: () => boolean } = {}
  ): Promise<{ result: T; handle: ModelHandle }> {
    const state = await currentState();
    const candidates = candidatesFor(
      role,
      state.mode,
      { gemini: state.gemini.depleted, perplexity: state.perplexity.depleted },
      deps.available()
    );
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
          if (candidate.provider !== "anthropic") {
            await deps.ledger.markDepleted(candidate.provider).catch(() => {});
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
    case "gemini":
      return google(c.modelId);
    case "perplexity":
      return perplexity(c.modelId);
    case "anthropic":
      return anthropic(c.modelId);
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
    gemini: Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY),
    perplexity: Boolean(process.env.PERPLEXITY_API_KEY),
    anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
  }),
  makeModel,
  generate: generateText,
});

export const { withModelFallback, runText, generateTextRouted, recordModelUsage } = defaultRouter;
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:ai-router`
Expected: PASS for all sections including the twelve new router sections.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: exit 0. Likely adjustments if not: `Omit<GenerateTextParams, "model">` may need to become a plain intersection type or the `as GenerateTextParams` casts widened to `as never`; `LanguageModel` import may need `LanguageModelV2`-style typing from `@ai-sdk/provider` (check what `google(...)` returns and type `makeModel` accordingly). Keep runtime behavior; adjust only types.

- [ ] **Step 6: Commit**

```bash
git add lib/ai/router.ts scripts/test-ai-router.ts
git commit -m "feat(ai): add the model router with fallback, tiers and usage recording"
```

---

### Task 4: Move the non-agent call sites onto the router

**Files:**
- Modify: `lib/assistant-intent.ts`, `lib/search.ts` (rewrite), `lib/image-intent.ts`, `lib/voice-transcribe.ts`, `lib/paylah-sync.ts`, `app/api/apple-wallet/route.ts`, `lib/workout/workout-handler.ts`
- Test: `scripts/test-ai-router.ts`

**Interfaces:**
- Consumes: `generateTextRouted`, `withModelFallback`, `runText`, `NoModelAvailableError` (Task 3); `classifyError` (Task 1).
- Produces: `searchSystemPrompt(provider: Provider): string`, `NO_WEB_FOOTER` and `SearchAnswerResult.source: "sonar" | "gemini" | "claude" | "fallback"` from `lib/search.ts`.
- Behavior notes (deliberate): the classifier no longer falls back to Perplexity Sonar (Claude replaces it); `workout-handler` log parsing moves from `gemini-2.5-flash` to the `parse` role (flash-lite, then flash, then Claude); an empty search answer now falls to the next model like an error does.

- [ ] **Step 1: Write the failing tests**

Add to the imports at the top of `scripts/test-ai-router.ts`:

```ts
import fs from "node:fs";
import path from "node:path";
import { NO_WEB_FOOTER, searchSystemPrompt } from "../lib/search";
```

Add above `// ---- runner ----`:

```ts
/** Files still allowed to call google()/perplexity() directly. Task 5 empties this list. */
const NOT_YET_MIGRATED = [
  "lib/agent/finance-agent.ts",
  "lib/agent/workout-agent.ts",
  "lib/agent/ego-orchestrator.ts",
];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

section("no file outside the router picks a Gemini/Perplexity model directly", () => {
  const root = process.cwd();
  const offenders: string[] = [];
  for (const dir of ["app", "lib"]) {
    for (const file of sourceFiles(path.join(root, dir))) {
      const rel = path.relative(root, file);
      if (rel === "lib/ai/router.ts" || NOT_YET_MIGRATED.includes(rel)) continue;
      const text = fs.readFileSync(file, "utf8");
      if (/\b(google|perplexity)\(\s*["'`]/.test(text)) offenders.push(rel);
    }
  }
  assert.deepEqual(offenders, [], "route model calls through lib/ai/router");
});

section("search prompts differ by provider and Claude is honest about having no web access", () => {
  assert.match(searchSystemPrompt("perplexity"), /3-4 sentences/);
  assert.match(searchSystemPrompt("gemini"), /2-3 sentences/);
  assert.match(searchSystemPrompt("anthropic"), /cannot browse/i);
  assert.match(NO_WEB_FOOTER, /no live web data/i);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:ai-router`
Expected: FAIL: first on the missing `searchSystemPrompt` export, then (after that is fixed) the guard section lists the unmigrated files.

- [ ] **Step 3: Rewrite `lib/search.ts`**

Replace the entire file with:

```ts
import type { Provider } from "./ai/mode";
import { runText, withModelFallback } from "./ai/router";

export interface SearchAnswerResult {
  answer: string;
  source: "sonar" | "gemini" | "claude" | "fallback";
}

export const NO_WEB_FOOTER = "(No live web data right now, so this comes from my own knowledge.)";

export function searchSystemPrompt(provider: Provider): string {
  if (provider === "perplexity") {
    return `You are EGO, an intelligent, concise personal assistant for a user in Singapore.
Answer the user's question directly, accurately, and concisely.
Keep responses under 3-4 sentences whenever possible, with practical, factual information.
Include relevant times, opening hours, or numbers if requested.
Do not add conversational fluff or unprompted disclaimers.`;
  }
  if (provider === "gemini") {
    return `You are EGO, a helpful, concise personal assistant.
Answer the user's question directly and concisely in 2-3 sentences.
If it looks like a calendar event, expense, or to-do that wasn't recognized, suggest how to phrase it.`;
  }
  return `You are EGO, a helpful, concise personal assistant for a user in Singapore.
Answer the user's question directly and concisely in 2-3 sentences from your own knowledge.
You cannot browse the web, so if the question needs live information (current prices, opening hours, news) that you cannot confirm, say so plainly.
If it looks like a calendar event, expense, or to-do that wasn't recognized, suggest how to phrase it.`;
}

export async function answerWithSearch(query: string): Promise<SearchAnswerResult> {
  const trimmed = query.trim();
  if (!trimmed) {
    return {
      answer: "How can I help you? You can ask me questions, or track finances, calendar events, and to-dos.",
      source: "fallback",
    };
  }

  try {
    const { result, handle } = await withModelFallback("search", async (h) => {
      const generated = await runText(h, {
        system: searchSystemPrompt(h.provider),
        prompt: trimmed,
        maxOutputTokens: h.provider === "perplexity" ? 500 : 400,
        temperature: h.provider === "perplexity" ? 0.2 : 0.3,
      });
      if (!generated.text?.trim()) throw new Error("Search model returned an empty answer.");
      return generated;
    });
    const text = result.text.trim();
    if (handle.provider === "anthropic") {
      return { answer: `${text}\n\n${NO_WEB_FOOTER}`, source: "claude" };
    }
    return { answer: text, source: handle.provider === "perplexity" ? "sonar" : "gemini" };
  } catch (error) {
    console.warn("All search models failed:", error);
  }

  return {
    answer: "I wasn't sure how to handle that. Try /help to see examples of calendar, finance, and to-do commands.",
    source: "fallback",
  };
}
```

- [ ] **Step 4: Move `lib/assistant-intent.ts`**

Replace the head imports:

```ts
import { perplexity } from "@ai-sdk/perplexity";
import { google } from "@ai-sdk/google";
import { generateText } from "ai";
import { z } from "zod";
import { SECURITY_SYSTEM_GUARDRAIL } from "./security";
```

with:

```ts
import { z } from "zod";
import { generateTextRouted } from "./ai/router";
import { SECURITY_SYSTEM_GUARDRAIL } from "./security";
```

Change the key guard:

```ts
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY && !process.env.PERPLEXITY_API_KEY) {
    throw new Error("AI API keys are missing (GOOGLE_GENERATIVE_AI_API_KEY or PERPLEXITY_API_KEY).");
  }
```

to:

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

Replace the whole block that starts at `let responseText = "";` + `try {` + `const result = await generateText({` (model `gemini-flash-lite-latest`) and ends at the closing of the Perplexity fallback just before `try {\n    const rawJson = extractJson(responseText)` with:

```ts
  let responseText = "";
  try {
    const { result } = await generateTextRouted("classifier", {
      system: systemPrompt,
      prompt: userMessage,
      maxOutputTokens: 800,
      temperature: 0,
    });
    responseText = result.text;
  } catch (error) {
    console.error("All AI models failed in determineAssistantIntent:", error);
    return {
      action: "unknown",
      message:
        "I'm temporarily having trouble connecting to the AI service. Please try again in a moment.",
    };
  }
```

(That block currently contains three nested attempts: flash-lite, flash, then Perplexity Sonar, each with its own `return { action: "unknown", ... }` fallback. The single router call replaces all of them: Gemini flash-lite, Gemini flash, then Claude Haiku, Sonnet, Opus.)

- [ ] **Step 5: Move `lib/image-intent.ts`**

Replace imports `import { google } from "@ai-sdk/google";` and `import { generateText } from "ai";` with `import { generateTextRouted } from "./ai/router";` (keep `import { z } from "zod";`).

Change the guard `if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {` (inside `parseImageAssistantIntent`) to:

```ts
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY && !process.env.ANTHROPIC_API_KEY) {
```

Replace the call head:

```ts
  const result = await generateText({
    model: google("gemini-3.6-flash"),
    system: `You are a strict image-to-JSON parser for EGO
```

with:

```ts
  const { result } = await generateTextRouted("vision", {
    system: `You are a strict image-to-JSON parser for EGO
```

(`temperature: 0`, `maxOutputTokens: 8_192` and the `finishReason === "length"` check stay as they are; the router strips `temperature` for Claude.)

- [ ] **Step 6: Move `lib/voice-transcribe.ts`**

Replace the imports `import { google } from "@ai-sdk/google";` and `import { generateText } from "ai";` with:

```ts
import { classifyError } from "./ai/mode";
import { NoModelAvailableError, generateTextRouted } from "./ai/router";
```

Replace the call head:

```ts
  const result = await generateText({
    model: google("gemini-3.6-flash"),
    system: buildTranscriptionSystemPrompt(input.contactNames ?? []),
```

with:

```ts
  const { result } = await generateTextRouted("audio", {
    system: buildTranscriptionSystemPrompt(input.contactNames ?? []),
```

Replace the catch in `handleVoiceNoteAction`:

```ts
  } catch (voiceError) {
    await sendTelegramMessage(
      chatId,
      "Sorry, I had trouble processing that voice note. Please try typing your message."
    );
    throw voiceError;
  }
```

with:

```ts
  } catch (voiceError) {
    // Claude cannot take audio, so when Gemini is out there is no fallback for voice.
    const unavailable =
      voiceError instanceof NoModelAvailableError || classifyError(voiceError) === "depleted";
    await sendTelegramMessage(
      chatId,
      unavailable
        ? "Voice notes are unavailable right now. Please type your message."
        : "Sorry, I had trouble processing that voice note. Please try typing your message."
    );
    throw voiceError;
  }
```

- [ ] **Step 7: Move `lib/paylah-sync.ts`**

Replace the imports `import { google } from "@ai-sdk/google";` and `import { generateText } from "ai";` with `import { generateTextRouted } from "./ai/router";`.

In the merchant-categorizer function, replace:

```ts
    let text = "";
    try {
      const result = await generateText({
        model: google("gemini-flash-lite-latest"),
        system: systemPrompt,
        prompt,
      });
      text = result.text;
    } catch {
      const result = await generateText({
        model: google("gemini-3.6-flash"),
        system: systemPrompt,
        prompt,
      });
      text = result.text;
    }
```

with:

```ts
    const { result } = await generateTextRouted("classifier", { system: systemPrompt, prompt });
    const text = result.text;
```

In `parseEmailTransaction`, replace:

```ts
    let responseText = "";
    try {
      const result = await generateText({
        model: google("gemini-flash-lite-latest"),
        system: systemPrompt,
        prompt,
      });
      responseText = result.text;
    } catch (liteErr) {
      console.warn(
        "gemini-flash-lite-latest failed in parseEmailTransaction, falling back to gemini-3.6-flash:",
        liteErr
      );
      const result = await generateText({
        model: google("gemini-3.6-flash"),
        system: systemPrompt,
        prompt,
      });
      responseText = result.text;
    }
```

with:

```ts
    const { result } = await generateTextRouted("parse", { system: systemPrompt, prompt });
    const responseText = result.text;
```

- [ ] **Step 8: Move `app/api/apple-wallet/route.ts`**

Replace the imports `import { google } from "@ai-sdk/google";` and `import { generateText } from "ai";` with `import { generateTextRouted } from "@/lib/ai/router";`.

Replace the call head:

```ts
    const result = await generateText({
      model: google("gemini-flash-lite-latest"),
      system: `You are a financial transaction categorizer.
```

with:

```ts
    const { result } = await generateTextRouted("classifier", {
      system: `You are a financial transaction categorizer.
```

(`maxOutputTokens: 20` stays; the router raises it to 4096 for Claude.)

- [ ] **Step 9: Move `lib/workout/workout-handler.ts`**

Replace the imports `import { google } from "@ai-sdk/google";` and `import { generateText } from "ai";` with `import { generateTextRouted } from "../ai/router";` (keep `import { z } from "zod";`).

Delete the lines:

```ts
  // Use Gemini Flash with structured prompt to reliably parse all exercise sets
  const model = google("gemini-2.5-flash");
```

Replace:

```ts
    const { text: responseText } = await generateText({
      model,
      prompt,
```

with:

```ts
    const { result: parsedResult } = await generateTextRouted("parse", {
      prompt,
```

and replace the line `    const cleaned = responseText` with `    const cleaned = parsedResult.text`.

- [ ] **Step 10: Run to verify the new tests pass and nothing regressed**

Run: `npm run test:ai-router && npx tsc --noEmit && npm run lint`
Expected: AI router tests PASS (the guard lists no offenders other than the three allowed agent files); tsc exits 0; lint 0 errors (one pre-existing warning `flushed` in `workout-session.ts` is expected).

Run: `npm run test:intents && npm test`
Expected: intent fixtures pass live (about 32/32) and all suites pass.

- [ ] **Step 11: Commit**

```bash
git add lib app scripts/test-ai-router.ts
git commit -m "feat(ai): route classifier, search, vision, voice and parsing calls through the router"
```

---

### Task 5: Move the agents onto the router

**Files:**
- Modify: `lib/agent/finance-agent.ts`, `lib/agent/workout-agent.ts`, `lib/agent/ego-orchestrator.ts`
- Test: `scripts/test-ai-router.ts`

**Interfaces:**
- Consumes: `withModelFallback`, `recordModelUsage`, `ModelHandle` (Task 3).
- Behavior: each agent builds its `ToolLoopAgent` inside the fallback attempt with `model: handle.model`, `providerOptions: handle.providerOptions`, and `...handle.sampling(0)`. A failed run is retried on the next model only if no tool has executed (`canRetry`): finance and workout use their existing `mutated` flag; the EGO orchestrator uses `toolsUsed.length === 0 && !tracker.notified`.

- [ ] **Step 1: Make the guard fail first**

In `scripts/test-ai-router.ts`, change the list to empty:

```ts
const NOT_YET_MIGRATED: string[] = [];
```

Run: `npm run test:ai-router`
Expected: FAIL, the guard section lists `lib/agent/finance-agent.ts`, `lib/agent/workout-agent.ts` and `lib/agent/ego-orchestrator.ts` as offenders.

- [ ] **Step 2: Move the finance agent**

In `lib/agent/finance-agent.ts`: remove the line `import { google } from "@ai-sdk/google";`, change `import { ToolLoopAgent, tool, isStepCount } from "ai";` (keep as is), and add `import { recordModelUsage, withModelFallback } from "@/lib/ai/router";`.

Replace the agent construction block:

```ts
  const agent = new ToolLoopAgent({
    model: google("gemini-3.6-flash"),
    instructions: buildFinanceInstructions({
      today: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" }),
      targetTransaction: params.targetTransaction,
      repliedToText: params.repliedToText,
      inputMode: params.inputMode,
    }),
    tools,
    stopWhen: isStepCount(8),
    temperature: 0,
  });
```

with:

```ts
  const instructions = buildFinanceInstructions({
    today: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" }),
    targetTransaction: params.targetTransaction,
    repliedToText: params.repliedToText,
    inputMode: params.inputMode,
  });
```

Replace `  const result = await agent.generate({ messages });` with:

```ts
  const { result } = await withModelFallback(
    "agent",
    async (handle) => {
      const agent = new ToolLoopAgent({
        model: handle.model,
        instructions,
        tools,
        stopWhen: isStepCount(8),
        providerOptions: handle.providerOptions,
        ...handle.sampling(0),
      });
      const generated = await agent.generate({ messages });
      await recordModelUsage(handle, generated.totalUsage);
      return generated;
    },
    { canRetry: () => !mutated }
  );
```

- [ ] **Step 3: Move the workout agent**

In `lib/agent/workout-agent.ts`: remove `import { google } from "@ai-sdk/google";` and add `import { recordModelUsage, withModelFallback } from "@/lib/ai/router";`.

Replace:

```ts
  const agent = new ToolLoopAgent({
    model: google("gemini-3.6-flash"),
    instructions: buildWorkoutInstructions(plan, state, inputMode),
    tools,
    stopWhen: isStepCount(8),
    temperature: 0,
  });
```

with:

```ts
  const instructions = buildWorkoutInstructions(plan, state, inputMode);
```

Replace:

```ts
  const result = await agent.generate({
    messages: [...history, { role: "user" as const, content: text }],
  });
```

with:

```ts
  const { result } = await withModelFallback(
    "agent",
    async (handle) => {
      const agent = new ToolLoopAgent({
        model: handle.model,
        instructions,
        tools,
        stopWhen: isStepCount(8),
        providerOptions: handle.providerOptions,
        ...handle.sampling(0),
      });
      const generated = await agent.generate({
        messages: [...history, { role: "user" as const, content: text }],
      });
      await recordModelUsage(handle, generated.totalUsage);
      return generated;
    },
    { canRetry: () => !mutated }
  );
```

- [ ] **Step 4: Move the EGO orchestrator**

In `lib/agent/ego-orchestrator.ts`: remove `import { google } from "@ai-sdk/google";` and add `import { recordModelUsage, withModelFallback } from "@/lib/ai/router";`.

Replace the agent construction:

```ts
  const agent = new ToolLoopAgent({
    model: google("gemini-3.6-flash"),
    instructions: buildEgoInstructions({
      now: input.messageDate,
      inputMode,
      context,
      workoutLine: describeWorkoutContext(workoutState),
      hasPendingImage: input.hasPendingImage,
      repliedToPhoto: Boolean(input.repliedPhotoFileIds?.length),
    }),
    tools,
    stopWhen: isStepCount(10),
    temperature: 0,
  });
```

with:

```ts
  const instructions = buildEgoInstructions({
    now: input.messageDate,
    inputMode,
    context,
    workoutLine: describeWorkoutContext(workoutState),
    hasPendingImage: input.hasPendingImage,
    repliedToPhoto: Boolean(input.repliedPhotoFileIds?.length),
  });
```

Replace the `try` body:

```ts
    result = await agent.generate({ messages: toConversationMessages(input.history, text) });
```

with:

```ts
    ({ result } = await withModelFallback(
      "agent",
      async (handle) => {
        const agent = new ToolLoopAgent({
          model: handle.model,
          instructions,
          tools,
          stopWhen: isStepCount(10),
          providerOptions: handle.providerOptions,
          ...handle.sampling(0),
        });
        const generated = await agent.generate({
          messages: toConversationMessages(input.history, text),
        });
        await recordModelUsage(handle, generated.totalUsage);
        return generated;
      },
      { canRetry: () => toolsUsed.length === 0 && !tracker.notified }
    ));
```

(`let result;` above the `try` keeps working; the existing `catch` for partial failures stays.)

- [ ] **Step 5: Run to verify**

Run: `npm run test:ai-router && npx tsc --noEmit && npm run lint && npm test`
Expected: AI router tests PASS (guard now clean with an empty list); tsc exits 0 (if `generated.totalUsage` is typed differently, use `generated.usage`); lint 0 errors; all suites pass.

- [ ] **Step 6: Commit**

```bash
git add lib/agent scripts/test-ai-router.ts
git commit -m "feat(ai): run the finance, workout and EGO agents through the router"
```

---

### Task 6: `/credits` command and menu entry

**Files:**
- Create: `lib/ai/commands.ts`
- Modify: `lib/telegram/command-router.ts`, `lib/telegram/menu-builder.ts`
- Test: `scripts/test-ai-router.ts`

**Interfaces:**
- Consumes: `aiLedger` (Task 3); `sendTelegramMessage`.
- Produces: `type CreditsCommand = { kind: "show" } | { kind: "set"; provider: "gemini" | "perplexity"; amountUsd: number } | { kind: "usage_error"; message: string }`; `CREDITS_USAGE: string`; `parseCreditsCommand(text: string): CreditsCommand | null` (null when the text is not a `/credits` command); `handleCreditsCommand(params: { chatId: number; text: string }): Promise<void>`.

- [ ] **Step 1: Write the failing tests**

Add to the imports at the top of `scripts/test-ai-router.ts`:

```ts
import { CREDITS_USAGE, parseCreditsCommand } from "../lib/ai/commands";
```

Add above `// ---- runner ----`:

```ts
section("/credits parsing", () => {
  assert.equal(parseCreditsCommand("hello"), null);
  assert.equal(parseCreditsCommand("/creditsx"), null);
  assert.equal(parseCreditsCommand("/todo"), null);
  assert.deepEqual(parseCreditsCommand("/credits"), { kind: "show" });
  assert.deepEqual(parseCreditsCommand("/credits@ego_bot"), { kind: "show" });
  assert.deepEqual(parseCreditsCommand("/credits set gemini 25"), {
    kind: "set",
    provider: "gemini",
    amountUsd: 25,
  });
  assert.deepEqual(parseCreditsCommand("/credits set Perplexity $10.50"), {
    kind: "set",
    provider: "perplexity",
    amountUsd: 10.5,
  });
  assert.deepEqual(parseCreditsCommand("/credits set gemini 0"), {
    kind: "set",
    provider: "gemini",
    amountUsd: 0,
  });
  for (const bad of [
    "/credits set",
    "/credits set gemini",
    "/credits set gemini abc",
    "/credits set gemini -5",
    "/credits set claude 5",
    "/credits nonsense",
  ]) {
    assert.deepEqual(parseCreditsCommand(bad), { kind: "usage_error", message: CREDITS_USAGE }, bad);
  }
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:ai-router`
Expected: FAIL, `Cannot find module` for `lib/ai/commands`.

- [ ] **Step 3: Implement the command**

Create `lib/ai/commands.ts`:

```ts
import { sendTelegramMessage } from "../telegram";
import { aiLedger } from "./router";

export type CreditsCommand =
  | { kind: "show" }
  | { kind: "set"; provider: "gemini" | "perplexity"; amountUsd: number }
  | { kind: "usage_error"; message: string };

export const CREDITS_USAGE =
  "Usage: /credits to see balances, or /credits set gemini 25.00 (and /credits set perplexity 10.00) with the current dashboard balance in USD.";

export function parseCreditsCommand(text: string): CreditsCommand | null {
  const trimmed = text.trim();
  if (!/^\/credits(@\w+)?(\s|$)/i.test(trimmed)) return null;
  const parts = trimmed.split(/\s+/).slice(1);
  if (parts.length === 0) return { kind: "show" };
  if (parts[0].toLowerCase() === "set") {
    const provider = parts[1]?.toLowerCase();
    const raw = parts[2]?.replace(/^\$/, "");
    const amount = raw === undefined || raw === "" ? NaN : Number(raw);
    if ((provider === "gemini" || provider === "perplexity") && Number.isFinite(amount) && amount >= 0) {
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
      ? `✅ ${command.provider === "gemini" ? "Gemini" : "Perplexity"} balance set to $${command.amountUsd.toFixed(2)}.\n\n`
      : "";
  await sendTelegramMessage(params.chatId, prefix + summary, undefined, null);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:ai-router`
Expected: PASS, including `/credits parsing`.

- [ ] **Step 5: Wire the command and menu**

In `lib/telegram/command-router.ts`, add to the imports (after the `import { executeLatestUndo } from "../undo";` line):

```ts
import { handleCreditsCommand, parseCreditsCommand } from "../ai/commands";
```

Insert immediately before the `// Set Commands` block (`  // Set Commands\n  if (text === "/setcommands") {`):

```ts
  // AI credit balances and Claude fallback
  if (parseCreditsCommand(text)) {
    await handleCreditsCommand({ chatId, text });
    return { handled: true, completionStatus: "credits" };
  }

```

In `lib/telegram/menu-builder.ts`, add to `BOT_COMMANDS` directly before the `help` entry:

```ts
  { command: "credits", description: "AI credit balances & Claude fallback" },
```

and add to the dashboard text list, after the `Tasks` bullet in `getCompactDashboardText()`:

```ts
    "• 🧠 *Credits*: /credits shows AI balances and the Claude fallback",
```

- [ ] **Step 6: Verify**

Run: `npm run test:ai-router && npx tsc --noEmit && npm run lint && npm test`
Expected: all pass; lint 0 errors.

- [ ] **Step 7: Commit**

```bash
git add lib/ai/commands.ts lib/telegram/command-router.ts lib/telegram/menu-builder.ts scripts/test-ai-router.ts
git commit -m "feat(ai): add the /credits command"
```

---

### Task 7: Duration limit, Claude eval, live check, docs, final verification

**Files:**
- Modify: `app/api/telegram/route.ts`, `scripts/eval-ego.ts`, `README.md`
- Create: `scripts/ai-live-check.ts`

**Interfaces:**
- Consumes: `createRouter`, `buildHandle`, `NoModelAvailableError` (Task 3); `@ai-sdk/anthropic`.
- Produces: `EGO_EVAL_MODEL=anthropic:<model-id>` support in `scripts/eval-ego.ts`; `npm run check:ai-live`.

- [ ] **Step 1: Set the function duration**

In `app/api/telegram/route.ts`, add directly after the last import line (before `const FINANCE_HINT`):

```ts
// Worst case is the orchestrator's 10 model steps plus a delegate agent's 8: about 60-90 s.
// 120 s leaves headroom and stops a runaway agent loop well before the platform default.
export const maxDuration = 120;
```

- [ ] **Step 2: Let the eval run Claude models**

In `scripts/eval-ego.ts`, add to the imports:

```ts
import { anthropic } from "@ai-sdk/anthropic";
```

Replace the line `const EVAL_MODEL = process.env.EGO_EVAL_MODEL ?? "gemini-3.6-flash";` and its comment with:

```ts
/**
 * Override to compare models: EGO_EVAL_MODEL=gemini-flash-lite-latest, or a Claude model
 * with the anthropic: prefix, e.g. EGO_EVAL_MODEL=anthropic:claude-sonnet-5-5.
 * Production routing is decided by lib/ai/router.
 */
const EVAL_MODEL = process.env.EGO_EVAL_MODEL ?? "gemini-3.6-flash";
const EVAL_IS_CLAUDE = EVAL_MODEL.startsWith("anthropic:");
const evalModel = () =>
  EVAL_IS_CLAUDE ? anthropic(EVAL_MODEL.slice("anthropic:".length)) : google(EVAL_MODEL);
```

Replace `      model: google(EVAL_MODEL),` with `      model: evalModel(),` and replace `      temperature: 0,\n    });\n\n    const started` with:

```ts
      ...(EVAL_IS_CLAUDE ? {} : { temperature: 0 }),
    });

    const started
```

- [ ] **Step 3: Create the live check**

Create `scripts/ai-live-check.ts`:

```ts
/**
 * One real call per Claude tier through the router's own parameter handling (temperature
 * stripped, output floor, effort). Spends a few cents. Uses a no-op ledger, so nothing is
 * written to Google Sheets.
 *
 * Usage: npm run check:ai-live
 */
import { anthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import { createRouter, buildHandle } from "../lib/ai/router";
import { loadEnvLocal } from "./bench/util";

// 1x1 transparent PNG
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function run() {
  loadEnvLocal();
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY is not set in .env.local.");
    process.exit(1);
  }

  const router = createRouter({
    ledger: {
      getState: async () => {
        throw new Error("not used");
      },
      markDepleted: async () => {},
      recordUsage: async () => {},
    },
    available: () => ({ gemini: false, perplexity: false, anthropic: true }),
    makeModel: (c) => anthropic(c.modelId),
    generate: generateText,
  });

  const cases = [
    { modelId: "claude-haiku-5-5", role: "classifier" as const },
    { modelId: "claude-sonnet-5-5", role: "agent" as const },
    { modelId: "claude-opus-5-5", role: "agent" as const },
  ];

  let failed = false;
  for (const c of cases) {
    const handle = buildHandle({ provider: "anthropic", modelId: c.modelId }, c.role, (cand) =>
      anthropic(cand.modelId)
    );
    const started = Date.now();
    try {
      const result = await router.runText(handle, {
        system: "Reply with exactly the word OK and nothing else.",
        prompt: "ping",
        temperature: 0, // must be stripped for Claude or the API returns a 400
        maxOutputTokens: 20, // must be floored: thinking is always on
      });
      console.log(
        `  ✅ ${c.modelId} [${c.role}] -> "${result.text.trim().slice(0, 40)}" (${result.usage.inputTokens} in / ${result.usage.outputTokens} out, ${Date.now() - started}ms)`
      );
      if (!/ok/i.test(result.text)) throw new Error(`unexpected reply: ${result.text}`);
    } catch (error) {
      failed = true;
      console.error(`  ❌ ${c.modelId}:`, error instanceof Error ? error.message : error);
    }
  }

  // Vision: Sonnet reads an image part the way lib/image-intent sends it.
  try {
    const handle = buildHandle({ provider: "anthropic", modelId: "claude-sonnet-5-5" }, "vision", (cand) =>
      anthropic(cand.modelId)
    );
    const result = await router.runText(handle, {
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Describe this image in five words or fewer." },
            { type: "file", data: Buffer.from(PNG_BASE64, "base64"), mediaType: "image/png" },
          ],
        },
      ],
      temperature: 0,
      maxOutputTokens: 200,
    });
    console.log(`  ✅ claude-sonnet-5-5 [vision] -> "${result.text.trim().slice(0, 60)}"`);
  } catch (error) {
    failed = true;
    console.error("  ❌ vision:", error instanceof Error ? error.message : error);
  }

  if (failed) process.exit(1);
  console.log("\n  🎉 Claude tiers respond through the router.\n");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 4: Run the live check**

Run: `npm run check:ai-live`
Expected: four `✅` lines (Haiku, Sonnet, Opus, vision) and the final `🎉`; exit 0. If a model ID is rejected, stop and report it; do not guess another ID. If any call returns a 400 about `temperature`, the router's sampling handling is wrong; fix it test-first in `lib/ai/router.ts`.

- [ ] **Step 5: Score the orchestrator routing on Claude**

Run: `EGO_EVAL_MODEL=anthropic:claude-sonnet-5-5 npm run eval:ego`
Expected: accuracy at or above 85% (the gate for this work). Record the average latency.

Run: `EGO_EVAL_MODEL=anthropic:claude-haiku-5-5 npm run eval:ego`
Expected: informational only. Record accuracy and latency for the user. If Sonnet scores below 85%, tighten the failing prompt rules in `lib/agent/ego-prompt.ts` (test-first, as in the orchestrator work) and re-run; do not lower the threshold.

- [ ] **Step 6: Document it**

In `README.md`, add a section before "The EGO orchestrator":

```markdown
## 🔁 Claude fallback and credit tracking

EGO normally runs on Gemini (and Perplexity for search). It watches how much of each balance is left and moves everything to Claude when both are almost out.

- **Tell it your balances:** `/credits set gemini 25.00` and `/credits set perplexity 10.00` (the current dashboard balance in USD). `/credits` shows the estimate, the current mode and what Claude has cost.
- **When it switches:** both providers at 5% or less remaining. EGO tells you in Telegram, then uses Claude Haiku for simple jobs, Sonnet for the orchestrator, agents and image reading, and Opus as a last resort. It switches back when you re-set a balance after a top-up.
- **If a provider runs dry sooner than the estimate:** that call, and the next 30 minutes, go to Claude.
- **Voice notes always use Gemini** (Claude cannot take audio); when Gemini is out, EGO asks you to type instead.
- **In Claude mode, web search answers come from Claude's own knowledge** and say so.
- **Setup:** set `ANTHROPIC_API_KEY` in `.env.local` and in Vercel. The first `/credits` creates the `AICredits` and `AIUsage` sheets.
- **Tests:** `npm run test:ai-router` (offline), `npm run check:ai-live` (a few cents), and `EGO_EVAL_MODEL=anthropic:claude-sonnet-5-5 npm run eval:ego`.
```

- [ ] **Step 7: Final verification**

Run: `npx tsc --noEmit && npm run lint && npm test && npm run build`
Expected: tsc exits 0; lint 0 errors (one pre-existing warning); all suites pass including "AI Router"; build succeeds and `/api/telegram` is still a dynamic route.

- [ ] **Step 8: Commit**

```bash
git add app/api/telegram/route.ts scripts/eval-ego.ts scripts/ai-live-check.ts README.md
git commit -m "feat(ai): set the webhook duration, add the Claude live check and eval, document the fallback"
```

- [ ] **Step 9: Hand back**

Summarize for the user: what shipped, the Claude eval accuracy and latency (Sonnet and Haiku), the live-check result, the duration setting, and the two things only they can do after deploy: (1) send `/credits set gemini <balance>` and `/credits set perplexity <balance>` (this also creates the two sheets), (2) confirm the Vercel dashboard allows at least 120 s for the function.

---

## Self-Review

**Spec coverage**
- Trigger on both at 5%, everything to Claude, audio exempt: Task 1 (`decideMode`, `candidatesFor`) and Task 3 (router).
- Backstop for real depletion with a 30-minute circuit breaker, per-provider skip, agents retry only if no tool ran: Task 1 (`classifyError`), Task 2 (`markDepleted`), Task 3 (`withModelFallback`, `canRetry`), Task 5.
- Ledger on Google Sheets (`AICredits`, `AIUsage`), spend since `setAt`, unknown balance never triggers, top-up restarts spend: Task 2.
- Tier assignment (Haiku for classifier/parse, Sonnet for agent/vision/search, Opus escalation): Task 1 (`claudeChain`), Task 4 and Task 5 (roles at call sites).
- Claude call details (strip temperature, thinking headroom, effort, exact model IDs, vision): Task 3 (`runText`, `buildHandle`), Task 7 live check.
- Voice stays on Gemini with the unavailable message; Claude-mode search is honest about no web: Task 4 (`voice-transcribe`, `search`).
- `/credits` command, notices, menu entry: Task 2 (notices, `describe`), Task 6.
- Testing (offline unit suite, Claude routing eval at 85% on Sonnet, live check): Tasks 1-3, 6 and 7.
- Duration recommendation requested by the user: the section after Global Constraints and Task 7 Step 1.

**Deliberate deviations from the spec**
- Usage writes are awaited with a 2-second cap rather than fire-and-forget, because a detached promise can be lost when a serverless function freezes after responding. (Spec Section 9 said fire-and-forget; the cost is a small added latency per model call.)
- The classifier no longer falls back to Perplexity Sonar; Claude replaces that last resort.
- Workout log parsing moves from `gemini-2.5-flash` to the `parse` role.

**Placeholder scan:** none; every step shows code or an exact command. Task 3 Step 5 names the likely type adjustments instead of "fix types".

**Type consistency:** `Provider`, `Role`, `Mode`, `Candidate`, `ProviderStatus` (Task 1) are used with the same shapes in Tasks 2-5. `Ledger` methods (`getState`, `markDepleted`, `recordUsage`, `setBalance`, `describe`) match across `ledger.ts`, `router.ts`, `commands.ts` and the tests. `ModelHandle` fields and `sampling()` are used identically in the router and all three agents. `RouterDeps.ledger` is `Pick<Ledger, "getState" | "markDepleted" | "recordUsage">`, which the live check's no-op ledger satisfies.

**Review Focus coverage:** ledger outage fallback (Task 3 test), per-minute "quota" 429 not depleted and the exact 5% boundary (Task 1 tests), `maxOutputTokens` floor (Task 3 test), no agent retry after a tool ran (Task 3 `canRetry` test and Task 5), top-up restart and unknown balance (Task 2 tests).
