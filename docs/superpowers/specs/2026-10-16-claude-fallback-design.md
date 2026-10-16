# Claude Fallback and Tiered Model Router — Design

Date: 2026-10-16
Status: Draft for review

## Goal

When the Gemini and Perplexity API credits are nearly used up, EGO moves all of its model work to the Claude API automatically, using Claude's tiers (Haiku, then Sonnet, then Opus). The user is told when it happens and when it reverts. If a provider actually runs out before the estimate says it will, EGO still switches that call to Claude.

## Decisions already made

- **Trigger:** both Gemini and Perplexity at 5% or less of their remaining balance. Then **everything is handled by Claude** (user's words).
- **Backstop:** a provider that returns a credits-depleted error is served by Claude for that call and for a cool-down period, even if the estimate said credits were left.
- **SDK:** `@ai-sdk/anthropic` (the Vercel AI SDK's Claude provider), because the orchestrator and both agents already run on `ToolLoopAgent`/`generateText`. Recommended by the assistant and approved by the user.
- **Balance knowledge:** neither provider documents a balance API (checked 2026-10-16: Perplexity and Gemini both expose the balance only on their web dashboards, and Gemini's depleted error is reported as HTTP 402 in docs but 429 "prepayment credits are depleted" in forum reports). EGO therefore tracks spend itself against a balance the user enters.
- **Voice notes stay on Gemini.** Claude has no audio input. When Gemini is truly depleted, EGO replies that voice notes are unavailable and asks for text.
- **Web search in Claude mode:** Claude answers without live web data and says so. No paid search tool.
- **Tier assignment by job:**
  - Haiku 5.5 (`claude-haiku-5-5`): simple jobs (intent classifier, email parsing for PayLah and Apple Wallet).
  - Sonnet 5.5 (`claude-sonnet-5-5`): the orchestrator, finance agent, workout agent, vision (image intent), search answers, workout log parsing.
  - Opus 5.5 (`claude-opus-5-5`): last-resort escalation when a Sonnet-tier call fails or returns output that does not validate.

## Non-goals

- No change to which provider is used while credits are healthy. Gemini and Perplexity stay primary.
- No attempt to read a real balance from either vendor.
- No second transcription provider.
- No per-user quotas or billing UI beyond the `/credits` command.

## 1. Architecture

A new `lib/ai/` module is the only place that chooses a model:

- `lib/ai/pricing.ts` — price constants per model (USD per million input and output tokens, plus Perplexity's per-request fee), each with a source and date comment.
- `lib/ai/ledger.ts` — reads and writes the credit ledger (Section 2). Caches the computed state in memory for 60 seconds per server instance.
- `lib/ai/mode.ts` — pure functions: remaining balance, the 5% rule, error classification, mode decision. No I/O, fully unit-tested.
- `lib/ai/router.ts` — `getModel(role)` returns the model for the current mode; `runWithFallback(role, fn)` runs a model call and retries it up the Claude chain on a credits error.
- `lib/ai/usage.ts` — `recordUsage(provider, model, usage)` after every successful call.
- `lib/ai/commands.ts` — the `/credits` Telegram command.

All 13 existing call sites (`google(...)` / `perplexity(...)` in `assistant-intent`, `search`, `image-intent`, `voice-transcribe`, `paylah-sync`, `workout-handler`, `apple-wallet`, the finance, workout and EGO agents) are changed to ask the router for a model by **role** instead of naming one:

| Role | Credits healthy | Claude mode |
|---|---|---|
| `classifier` | Gemini flash-lite | Haiku, escalating Sonnet, Opus |
| `parse` (emails, workout text) | Gemini flash-lite / flash | Haiku, escalating Sonnet, Opus |
| `agent` (EGO, finance, workout) | Gemini flash | Sonnet, escalating Opus |
| `vision` | Gemini flash | Sonnet, escalating Opus |
| `search` | Perplexity Sonar, then Gemini | Sonnet (no web) |
| `audio` | Gemini flash | Gemini flash only (see Section 5) |

## 2. Credit ledger (Google Sheets, like the rest of the app)

Two sheets in the existing spreadsheet, created on demand like the other sheets:

- **`AICredits`** — one row per provider (`gemini`, `perplexity`): `provider`, `startBalanceUsd`, `setAt` (ISO, SGT), `mode` (the last announced mode), `modeChangedAt`.
- **`AIUsage`** — append-only: `timestamp`, `provider` (`gemini` | `perplexity` | `anthropic`), `model`, `inputTokens`, `outputTokens`, `costUsd`, `role`.

Remaining balance for a provider = `startBalanceUsd` minus the sum of `costUsd` in `AIUsage` for that provider since `setAt`. Appends are atomic, so concurrent serverless instances cannot overwrite each other the way a read-modify-write counter would.

The remaining *fraction* is `remaining / startBalanceUsd`. A provider is "nearly out" at 5% or less. A provider with no balance entered is treated as unknown: it never triggers the early switch (only the backstop applies), and `/credits` tells the user to set it.

Anthropic spend is logged too, so `/credits` can show what the fallback is costing.

## 3. Mode decision

- `credits` mode: normal routing (Gemini and Perplexity primary).
- `claude` mode: both Gemini and Perplexity are known and at 5% or less. All roles except `audio` use Claude.
- The mode is recomputed from the ledger at most once per 60 s per instance. When it changes, a one-time Telegram message is sent, guarded by the `mode`/`modeChangedAt` cells so two instances do not both announce it.
- It returns to `credits` mode only when the user re-sets a balance (a top-up) that puts either provider above 5%. Estimates never "recover" on their own.

If `ANTHROPIC_API_KEY` is missing, the router stays in `credits` mode, logs the problem once, and `/credits` warns that the fallback is not configured.

## 4. Backstop for real depletion

An error is classified as **credits depleted** when it is HTTP 402, or HTTP 429/403 whose message contains "credit", "prepayment", "quota", "billing", "insufficient" or "exhausted". Plain 429 rate limits with none of those words are treated as transient (retried by the SDK, not as depletion).

On a depletion error from a provider, the router:

1. Retries that call on the Claude chain for its role.
2. Marks the provider **depleted** in memory for 30 minutes (a circuit breaker) and writes a `depleted` marker to the ledger so other instances see it. While marked, that provider's roles go straight to Claude, re-probing the provider after 30 minutes.
3. Sends the same one-time Telegram notice as a mode change, worded for the single provider.

Agents (`ToolLoopAgent`) are retried on Claude **only if no tool has executed yet**. If a tool already ran, the failure is reported with the existing partial-failure message instead, to avoid duplicate side effects.

## 5. Voice and search

- **Voice notes (`audio`)** always use Gemini, in either mode, because Claude cannot hear audio. On a depletion error the user gets: "Voice notes are unavailable right now. Please type your message." and the update is closed cleanly.
- **Search in Claude mode:** Sonnet answers from its own knowledge with a footer "(no live web data — Perplexity credits are low)". The Perplexity-then-Gemini chain is skipped.

## 6. Claude call details

Verified against the Claude API reference on 2026-10-16:

- Existing calls pass `temperature: 0`. Claude 5.5 models reject non-default sampling parameters (400), so the router strips `temperature`, `topP`, and `topK` for Claude models.
- Thinking is always on for these models. The router does not send a `thinking` disabled setting. Effort is set low for Haiku/classifier roles and left at the model default for agents; exact option names are confirmed against `@ai-sdk/anthropic` at implementation time.
- Forced `tool_choice` (`any`/`tool`) returns a 400 on these models; the agents use the default `auto`, which is unaffected.
- Model IDs are exactly `claude-haiku-5-5`, `claude-sonnet-5-5`, `claude-opus-5-5` (no date suffix). They are verified once with the Models API when the key is available.
- Image input uses Claude vision. Audio is not supported (Section 5).
- Reply text is unchanged in format: plain text, sent with the existing Telegram helpers.

## 7. `/credits` command and notices

- `/credits` — shows each provider's start balance, estimated spent, estimated remaining, percent left, the current mode, and the Anthropic spend since the switch.
- `/credits set gemini 25.00` and `/credits set perplexity 10.00` — sets the balance (the number is the current dashboard balance in USD) and starts a new `setAt`.
- Notices: "Gemini and Perplexity credits are almost used up (about X% left). EGO is now using Claude." and "Credits topped up. EGO is back on Gemini and Perplexity."
- The command is added to the bot menu and `/help`. It is allowed only for the existing allowed Telegram user.

## 8. Testing

- **Unit (offline), `scripts/test-ai-router.ts`, wired into `npm test`:** remaining and percent calculations; the 5% boundary (5.0% switches, 5.1% does not); "both" logic (only one low, no early switch); unknown balance never triggers; error classification table (402, 429 with "prepayment credits are depleted", plain 429, 500, network); circuit-breaker timing with an injected clock; mode-change notice sent once; tier escalation order per role; temperature stripped for Claude; agent retry only when no tool ran; ledger arithmetic since `setAt`; command parsing for `/credits set`.
- **Routing eval on Claude:** `scripts/eval-ego.ts` already accepts `EGO_EVAL_MODEL`; extend it to take a Claude model so the same 35 cases are scored on Sonnet and on Haiku. Required: at least 85% on Sonnet before the work is considered done.
- **Live check after the key is available:** one call per role against real Claude, to confirm model IDs, parameter acceptance and usage fields.

## 9. Open risks

- **Estimates drift from the real dashboard** (rounding, price changes, billing lag, and Gemini balance mismatches seen on forums). The 5% margin plus the backstop absorb this; `/credits set` re-syncs it.
- **Price constants go stale.** They live in one file with a source and date, and `/credits` shows which prices it assumed.
- **Claude behaves differently** from Gemini on edge cases (always-on thinking, stricter parameters). The Claude routing eval and the existing intent fixtures run against it before release.
- **Latency and cost in Claude mode** differ: Haiku 5.5 is $0.10/$0.50 per million tokens, Sonnet 5.5 $2/$10, Opus 5.5 $4/$20; the Sonnet orchestrator will cost more per message than Gemini Flash did.
- **Sheets latency:** one ledger read per instance per minute and one append per model call. Appends are fire-and-forget so they never slow a reply.

## What is needed from the user

1. An Anthropic API key with billing: set `ANTHROPIC_API_KEY` in `.env.local` and in Vercel (never pasted into chat).
2. The current Gemini and Perplexity dashboard balances in USD, entered with `/credits set` once the feature is live.
3. Confirmation of the Vercel function duration limit (still open from the orchestrator review).
