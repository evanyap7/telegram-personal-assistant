# Claude-Only EGO (Gemini Removed) — Design

Date: 2026-10-16
Status: Draft for review
Supersedes: the provider-fallback parts of `2026-10-16-claude-fallback-design.md`

## Goal

Run every model call on Claude (Haiku, then Sonnet, then Opus). Remove Gemini completely. Keep Perplexity for live web search. Replace Gemini's voice-note transcription with a dedicated speech-to-text service. Keep a slimmed-down `/credits` that warns the user before Claude or Perplexity credits run out.

## Decisions already made (from the user)

1. **Perplexity stays**, for web search only.
2. **Voice transcription is replaced** by a dedicated speech-to-text service (recommendation below).
3. **Slimmed-down credit tracking.** The user sets balances; EGO warns at low levels. There is no provider switching.
4. **Built directly on `main`**, not a feature branch. Nothing is pushed or deployed until the live checks pass.

## What "remove Gemini" does and does not touch

- Removed: `@ai-sdk/google`, the `GOOGLE_GENERATIVE_AI_API_KEY` env var, every `gemini-*` model id, Gemini pricing, the Gemini-vs-Claude fallback, the per-provider skipping and last-resort logic, the global "claude mode", and the Gemini depletion circuit breaker.
- **Not touched:** Google Sheets, Google Calendar and Gmail. They use Google's Workspace APIs with a service account and OAuth, not Gemini.
- Kept: Perplexity (`@ai-sdk/perplexity`, `PERPLEXITY_API_KEY`).

## 1. Model routing

`lib/ai/router.ts` keeps its public surface (`withModelFallback`, `runText`, `generateTextRouted`, `recordModelUsage`) so call sites do not change. Inside, candidates become:

| Role | Models, in order |
|---|---|
| `classifier`, `parse` | Claude Haiku 5.5, Sonnet 5.5, Opus 5.5 |
| `agent`, `vision` | Claude Sonnet 5.5, Opus 5.5 |
| `search` | Perplexity Sonar first, then Claude Sonnet 5.5, Opus 5.5 (no web, with the existing "no live web data" footer) |

- The `audio` role is removed from the text router; transcription is a separate module (Section 3).
- Escalation rules stay: a failed call tries the next tier; an agent that already ran a tool is never retried (`canRetry`).
- Claude call details stay as built and verified: `temperature` is never sent, `maxOutputTokens` is floored at 4096, classifier and parse calls use low effort.
- If Perplexity is out of credits or errors, search falls to Claude without web data. If every Claude tier fails, the user gets a plain "EGO's AI is temporarily unavailable, please try again shortly", and there is no other provider.

## 2. Credits: slimmed down

- **Tracked providers:** `anthropic` and `perplexity` (replacing `gemini` and `perplexity`). The `AICredits` sheet's rows become `claude`, `perplexity`, `meta`; `AIUsage` keeps the same columns and now logs Claude, Perplexity and speech-to-text calls.
- **No modes and no model switching.** The ledger exists to warn, not to route.
- **Warnings:** when a tracked provider's estimated remaining balance first falls to 10% or less, and again at 5% or less, EGO sends one Telegram message each ("Claude credits are about 10% left: top up at the Anthropic console, then send /credits set claude <balance>"). Each level is announced once until the balance is re-set.
- **Real depletion alert:** because Claude is the only provider, a Claude "credit balance too low" error sends an urgent Telegram alert (rate-limited to one per 30 minutes) in addition to the user-facing "AI unavailable" reply.
- **`/credits`** shows each provider's estimate, percent left, and Claude spend; `/credits set claude 20` and `/credits set perplexity 8.94` set balances. `/credits set gemini` is removed and answers with the usage text.
- Prices are Claude (Haiku 5.5 $0.10/$0.50, Sonnet 5.5 $2/$10, Opus 5.5 $4/$20 per million tokens), Perplexity Sonar (token price plus the per-request search fee), and the speech-to-text per-minute price.

## 3. Voice transcription: dedicated speech-to-text

Claude cannot take audio, so voice needs its own service.

- **Recommendation: OpenAI `gpt-4o-mini-transcribe`.** Market comparisons dated 2026 list it at about $0.003 per minute, the cheapest production-grade option, with AssemblyAI Universal-2 close behind at about $0.0025 per minute and Deepgram Nova-3 at about $0.0043-$0.0077 per minute. A typical 10-second voice note costs well under a tenth of a cent.
- It is reachable through the AI SDK the app already uses (`@ai-sdk/openai`, transcription models), so the code stays in the same style as the rest.
- The existing vocabulary hints (gym terms, PayLah, saved contact names) are passed as the transcription prompt.
- **To verify with a live test before release:** that Telegram's OGG/Opus voice notes are accepted directly (the price comparison sources did not state formats), and the exact AI SDK call name for this SDK version.
- The transcription module is a small interface (`transcribeAudio({ audio, mediaType, hints })`), so switching to another service later is one file.
- On failure the user sees "Voice notes are unavailable right now. Please type your message."; the "Heard: …" echo stays.
- Needs from the user: an OpenAI account with API credit and an `OPENAI_API_KEY`. Cost is tracked in `AIUsage` but has no balance warning (it is pennies).

## 4. Files changed

- Delete: Gemini model ids and pricing; `providerFlags`, `isNearlyOut`-based mode logic, `decideMode`, `isExhausted`-style helpers, last-resort tail, Gemini-specific tests.
- Change: `lib/ai/mode.ts`, `lib/ai/pricing.ts`, `lib/ai/ledger.ts`, `lib/ai/sheets-store.ts`, `lib/ai/router.ts`, `lib/ai/commands.ts`.
- Add: `lib/ai/transcribe.ts`; the `@ai-sdk/openai` dependency.
- Change call sites: `lib/voice-transcribe.ts` (use the transcription module), and any remaining Gemini environment checks (`image-intent`, `assistant-intent`, `voice-transcribe`).
- Remove the `@ai-sdk/google` dependency and every `GOOGLE_GENERATIVE_AI_API_KEY` reference.
- Rework Gemini-based scripts: `scripts/eval-ego.ts` defaults to Claude Sonnet; `scripts/bench/*` (intent latency, model cost, parallel vs sequential) compare Claude tiers instead of Gemini; `scripts/test-intents.ts` runs through the router.

## 5. README

Rewritten for a Claude-only setup: the intro and tech-stack lines stop mentioning Gemini; the AI section describes the Claude tiers, Perplexity search and the speech-to-text service; the environment-variable list drops the Gemini key and adds the OpenAI key; the credits section describes the slimmed `/credits` and its warnings; the testing section lists the Claude checks.

## 6. Testing and release gate

- Offline unit tests (`npm run test:ai-router`): tier chains per role, escalation, no retry after a tool ran, search falling to Claude when Perplexity fails, credit warnings at exactly 10% and 5% (once each, re-armed after `/credits set`), real-depletion alert rate limit, command parsing (including rejecting `gemini`), transcription module with a fake provider, and a guard test that fails if any file references Gemini or `@ai-sdk/google`.
- Live checks that spend a few cents: `npm run check:ai-live` (Haiku, Sonnet, Opus, vision), a transcription call with a real Telegram-style OGG/Opus clip, and one Perplexity search.
- Routing eval on Claude Sonnet must score at least 85% on the 35 cases (Haiku reported for information).
- **Release gate:** nothing is pushed or deployed until the Anthropic and OpenAI keys are valid, all live checks pass, the full suite and build pass, and an independent whole-branch review is clean.

## 7. Risks

- **Single provider.** A Claude outage or empty balance takes the bot down. Mitigations: clear user message, urgent Telegram alert, early low-balance warnings, and `/credits` visibility.
- **Cost.** The Sonnet-based orchestrator costs more per message than Gemini Flash did; the 10%/5% warnings and Claude spend in `/credits` make it visible.
- **Behavior differences** between models (always-on thinking, stricter parameters) are covered by the Claude routing eval and the intent fixtures.
- **Estimates drift** from the real dashboards; `/credits set` re-syncs them.

## What is needed from the user

1. A valid Anthropic API key with credit, in `.env.local` and Vercel. The current value is rejected as invalid.
2. An OpenAI account with a few dollars of API credit and an `OPENAI_API_KEY` (or a different speech-to-text choice).
3. The current Claude and Perplexity dashboard balances in USD, entered with `/credits set` after deploy.
