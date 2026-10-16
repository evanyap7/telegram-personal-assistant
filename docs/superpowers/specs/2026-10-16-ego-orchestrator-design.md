# EGO — Orchestrator Agent Design

Date: 2026-10-16
Status: Draft for review

## Goal

Rename the assistant **EGO** ("Everything Gets Optimized") and put one **orchestrator agent** in front of everything the assistant can already do. The user talks to EGO over Telegram, in text or by voice. The orchestrator decides which agent or function handles each message, including multi-step requests ("log lunch and move my 3pm"). It replaces the hard-coded regex and intent-classifier routing in the Telegram route.

## Decisions already made

- **Option A, full replacement.** Every free-text message goes through the orchestrator. Existing handlers and the finance and workout agents become its tools.
- **Flat tool set, not a hierarchy of per-domain agents.** One orchestrator holds all function tools plus two delegate tools. Most messages cost a single agent loop.
- **Rename is user-facing only.** Repo name, package name and deployed URLs do not change.
- **Voice input is transcribed, then routed as text, with a voice flag.** See "Voice".

## Non-goals

- No new capabilities beyond what is already implemented.
- No change to slash commands, inline-button callbacks, cron jobs, Gmail and Apple Wallet webhooks.
- No change to handler behavior. Handlers keep their own confirmations, undo buttons and Telegram replies.
- No native-audio-to-orchestrator path (see "Voice", rejected alternative).

## 1. Rename

User-visible text changes from "Personal Assistant" to EGO:

- Bot menu and `/help` (`lib/telegram/menu-builder.ts`, `lib/telegram/command-router.ts`).
- Landing page, page title and metadata (`app/page.tsx`, `app/layout.tsx`). The acronym is spelled out once on the landing page and in the README.
- README.
- System prompts: finance agent, workout agent, search, voice transcription, image intent ("...inside EGO, a private Telegram assistant").
- The Apple Wallet webhook service label (`app/api/apple-wallet/route.ts`).

Not changed: repository name, `package.json` name, GitHub and Vercel URLs.

## 2. Architecture

### Stays in `app/api/telegram/route.ts`

Input handling that makes no routing decision:

- Webhook secret check, allowed-user check, update dedupe and start/complete bookkeeping.
- Callback-query dispatch.
- Photo and album intake and the media-group batching (`processAssistantImages`).
- Voice and audio transcription (see "Voice").
- Slash-command dispatch (`dispatchCommand`).
- Chat-history logging.

### Replaced by one call, `runEgo()`

Removed from the route once the orchestrator is live:

- `handleWorkoutSessionMessage` as the first gate.
- The pending-image follow-up regex.
- The swipe-reply transaction fast-path.
- `FINANCE_HINT` and the finance-agent trigger condition.
- `parseAssistantIntent` plus `defaultRegistry.dispatchIntent`.
- The `answerWithSearch` fallback.

`runEgo()` lives in a new `lib/agent/ego-orchestrator.ts` and follows the existing agent pattern: `ToolLoopAgent`, `google("gemini-3.6-flash")`, `temperature: 0`, `stopWhen: isStepCount(10)`, `SECURITY_SYSTEM_GUARDRAIL` appended to the instructions.

### Context given to the orchestrator

The same information `ConversationContext` carries today, plus:

- Recent chat history (8 turns).
- Replied-to message text.
- The target transaction (replied-to or latest).
- Pending calendar context.
- Current Singapore date and time.
- Active workout session state, if any (day, cursor, logged sets).
- `inputMode: "text" | "voice"`.

## 3. Tools

### Function tools, generated from the registry

`lib/assistant-intent.ts` exports the per-action zod schemas that today live inside one `intentSchema` union. A builder in `lib/agent/ego-tools.ts` turns each registered intent into a tool:

- Tool name = the action name.
- Input schema = that action's schema without the `action` literal.
- `execute` = `defaultRegistry.dispatchIntent(ctx, { action, ...input })`.

Handlers stay the single source of behavior; nothing is duplicated. Covered: calendar (add, batch add, view, delete search, reschedule, free slots, move, rename), todos, email draft, split bill and IOU, memory, recurring, undo.

### Delegate tools

- `askFinanceAgent({ request })` wraps `runFinanceAgent`. Money requests go here, including add, edit, delete, summary, query and budget.
- `askWorkoutAgent({ request })` wraps `runWorkoutAgent` and the workout start/log/view actions.

The overlapping `finance_*`, `budget_set` and `workout_*` intents are not exposed as direct tools. The delegate agents are the only route for those domains.

### Other tools

- `webSearch` wraps `answerWithSearch` for general questions.
- `processPendingImage` replaces the pending-image follow-up regex. When a photo is waiting for instructions and the user's message plausibly refers to it, the orchestrator calls this.

### Drift test

Every intent registered in `defaultRegistry` must either have a tool or appear on an explicit exclusion list in the tool builder. A test fails if someone adds a handler and forgets to expose it.

## 4. Replies

Handlers and both agents already send their own Telegram messages. Tools therefore return `{ ok, userNotified: true, ... }`, and the orchestrator is instructed not to repeat what a tool already sent.

- If at least one tool notified the user, the orchestrator's final text is sent only if it adds something (for example a one-line summary of a multi-step request); an empty or redundant reply is suppressed.
- If no tool notified the user (chit-chat, a question, a clarification), the final text is sent.
- A shared per-run flag (`notified`) tracks this.

Destructive actions keep their existing gates: handler confirmation prompts, soft deletes and undo buttons. The orchestrator is instructed to ask before bulk or ambiguous changes, as the finance agent does now.

## 5. Voice

### Current behavior (kept)

`handleVoiceNoteAction` downloads the audio, transcribes it with Gemini, echoes `🎤 Heard: "…"`, and the route continues with the transcript as `text`. The chat-history entry is already tagged `voice_transcribed`.

### Changes

1. The route passes `inputMode: "voice"` into `runEgo()` when the text came from a voice or audio message.
2. **Orchestrator instructions for voice:**
   - Treat the message as spoken instructions and act on them like typed ones.
   - Expect transcription noise: misheard names, merchants and numbers.
   - For destructive or ambiguous requests that depend on a single uncertain word or number, confirm before acting. The "Heard" echo lets the user catch errors.
   - Normalize spoken forms ("a hundred kilos for five" is 100 kg × 5; "twelve fifty" is $12.50).
3. **Delegates receive the flag.** `askFinanceAgent` and `askWorkoutAgent` take `inputMode` and add the same short spoken-input note to their instructions, so voice works in every agent, not only the orchestrator.
4. **Transcription prompt improvement.** The transcription system prompt gets domain hints (gym exercise names, PayLah, Apple Pay, calendar words, and the user's saved contact names from memory) to cut mishearings.
5. **Workout session set shortcut.** A spoken set such as "one hundred times five" will not match the strict `weight x reps` parser, so it falls through to the orchestrator and then the workout agent. That is correct, just slower.

### Rejected alternative

Passing the raw audio directly to the orchestrator model would save one transcription call, but the delegate agents, chat history and logs all need text, and the user would lose the "Heard" check. Not worth it.

## 6. Workout-session shortcut

The most frequent message in a workout is a plain set like `100 x 5`. Sending it through the orchestrator and then the workout agent would be two LLM loops for something a parser handles instantly. One narrow shortcut is kept: while a session is active and the text strictly matches `parseSetInput`, the set is recorded directly. Everything else during a session ("fix my last set", "skip squats", "what's the weather") goes through the orchestrator, which sees the session state and can delegate to the workout agent.

## 7. Safety and rollout

- Same guardrail, model and step-cap pattern as the existing agents.
- If the orchestrator throws, the user gets the existing "ran into an issue" reply and the update is marked failed.
- Feature flag `EGO_ORCHESTRATOR`. When set to `off`, the route uses the old pipeline unchanged. This is the rollback during transition; the old pipeline and flag are deleted once the user is happy with the orchestrator.

## 8. Testing

- **Routing eval (`test:ego`)**, in the style of `scripts/test-intents.ts`: about 30 representative phrases, including voice-style phrasings, checked for the tool the orchestrator selects. Supports `--dry-run` when no API key is set.
- **Unit tests:** registry-to-tool drift check; the `notified` reply-suppression logic; voice flag propagation to the delegates; set-input shortcut only fires with an active session and a strict match.
- **Benchmarks:** before/after numbers from the existing `bench:intent` and `bench:cost` scripts, since every message now runs an agent loop.
- `npm test` (`scripts/test-all.ts`) includes the new tests.

## Open risks

- **Latency and cost** per message rise versus the one-shot classifier. Mitigated by Flash, a step cap, the set shortcut, and the benchmark comparison.
- **Misrouting by the LLM** where regex was deterministic. Mitigated by the routing eval and the rollback flag.
- **Handler return values** are only status strings, so the orchestrator cannot read results (for example, calendar contents) back from handler tools. It only knows the action ran. Multi-step requests that need one tool's output to feed the next are limited to the delegate agents, which return data to their own loops. If this matters in practice, handlers can be extended to return structured results later.
