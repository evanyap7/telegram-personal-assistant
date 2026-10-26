# 🤖 EGO: Everything Gets Optimized

**EGO** is my personal Telegram assistant and the name of the orchestrator agent at its center. It handles expenses, scheduling, to-dos, email drafts, habits, bill splitting and memory recall so I don't have to open five apps. (The repo is still called `telegram-personal-assistant`.)

Built as a serverless bot with **Next.js**, **TypeScript**, **Anthropic Claude** (Haiku, Sonnet, Opus), **Perplexity Sonar**, the **Vercel AI SDK** and **Vercel**. It connects to **Telegram**, **Google Sheets**, **Google Calendar** and **Gmail**.

---

## ⚡ Features

### 💸 Finance
- **Apple Pay auto-log**: an iOS Shortcut hits my webhook on every tap, AI categorizes the purchase, and it lands in Google Sheets.
- **DBS PayLah!, PayNow & Grab sync**: scans Gmail for payment confirmations and logs them (`/sync` to run on demand).
- **Multi-currency**: 15+ currencies converted to SGD with live FX (cached fallback), keeping both amounts.
- **Bill splitting (`/split`, `/owed`)**: *"split $120 for dinner between me, Sarah, Dave with 10% tip"*. Exact penny allocation, an IOU ledger with settle buttons, and my share is logged as an expense.
- **Natural-language queries**: *"how much did I spend on Grab this month?"*
- **Budget**: set by chat (*"set my budget to $700"*, *"cap dining at $150"*) with threshold alerts and daily pacing. Export any month as CSV with `/export`.
- **Recurring subscriptions** logged automatically on their billing dates.
- **Dashboard tab** in Google Sheets with KPI cards, category chart and top 5 expenses.
- **Conversational fixes**: *"change that to $15"* or *"delete the Grab one from yesterday"*. The agent finds the row, edits it, and asks which one if several match.
- **Safe undo**: every agent change has an `[↩️ Undo]` button, and deletes only mark rows `deleted`.

### 🏋️ Guided PH3 Workouts
- Say `workout` and it reads today's day from my program sheet, then walks me through set by set.
- Log with `100 x 5`, `102.5 for 6` or `bw x 10`. Prescribed or already-filled cells are never overwritten (sets go to a `Workouts` tab instead).
- Talk to it like a coach: *"make that 95 not 90"*, *"delete set 2 of bench"*, *"skip the rest of triceps"*, *"add a bonus set of 60 for 12"*.
- Switch days with `/workoutday 12` or `/nextworkoutday`. Unrelated messages go back to the normal assistant.

### 📅 Calendar
- Routes events to my personal or work calendar and extracts the location: *"project sync tomorrow 3pm in Room 302 at work"*.
- `/freeslots` finds open windows (9 AM to 9 PM SGT). Reschedule in plain language: *"move gym to 5pm tomorrow"*.
- Leave-now alerts use Singapore transit buffers. Event reminders include a countdown, venue and calendar link.
- Send a flyer or invite screenshot and Claude adds it to the calendar.

### ⏰ Persistent To-Do Reminders
- *"remind me to call John"* pings me every 30 minutes until it's done, respecting quiet hours (11 PM to 8 AM SGT).
- Snooze for 1 hour, tonight or tomorrow morning. Buttons for Done, Mute and Undo.

### 🌅 Briefs & Reports
- **Morning brief (8 AM SGT)**: agenda, overdue tasks, budget pacing, email triage.
- **Evening recap (10 PM SGT)**: spending, open tasks, tomorrow's first event, habit check-offs.
- **Weekly report (Sunday 10 PM SGT)**: week-over-week spending and top categories.

### 🔥 Habits, 🧠 Memory, 📬 Email, 🔍 Search
- **Habits (`/habits`)**: daily streaks with current and best counts and 1-tap check-off.
- **Memory (`/remember`, `/recall`)**: notes and contacts, with nickname resolution for emails and splits. Credentials are encrypted.
- **Gmail (`/inbox`)**: triage digest, voice or text drafts, and a `[📤 Send Now]` button.
- **Search**: general questions go to Perplexity Sonar for cited answers.

---

## 🎮 Commands

| Command | Description |
| --- | --- |
| `/menu`, `/start`, `/help` | Interactive control panel |
| `/split <amount> <p1, p2, ...>` | Split a bill and record IOUs |
| `/owed [person]` | Outstanding IOUs with settle buttons |
| `/budget`, `/budget set <amount>`, `/budget cap <category> <amount>` | View or set budgets |
| `/finance summary`, `/finance list` | Monthly breakdown, recent transactions |
| `/export [month]` | Monthly CSV |
| `/sync` | Gmail sync for PayLah! and Grab |
| `/freeslots [date]` | Open calendar slots |
| `/agenda`, `/calendar` | Today's schedule, upcoming events |
| `/todo`, `/todo today`, `/remind <task>` | View or add to-dos |
| `/inbox` | Unread Gmail triage |
| `/remember <key>: <val>`, `/recall <query>` | Save and search memory |
| `/habits`, `/habit add <name>` | Habit streaks |
| `/workout`, `/gym`, `/endworkout` | Start or end a guided workout |
| `/workoutday <n>`, `/nextworkoutday` | Jump to a program day |
| `/credits` | AI balances and usage |

---

## 🧠 How it works

### The EGO orchestrator
Every free-text message (typed, photo caption or transcribed voice note) goes to one orchestrator agent that calls tools: a **finance agent**, a **workout agent**, one tool per handler (calendar, to-dos, email & triage, payment sync, habits, bill splitting, memory, recurring items, briefings, credits, undo), web search and photo processing. One message can use several tools (*"log lunch and move my 3pm"*).

- **Voice**: transcribed with gym, PayLah and contact-name hints, echoed back as "Heard: ...", and handled with mishearings in mind. Uncertain destructive changes get confirmed first.
- **Deterministic paths skip the model**: slash commands, buttons, cron jobs, photo intake and plain `weight x reps` logging.
- **Rollback**: `EGO_ORCHESTRATOR=off` restores the old regex and intent-classifier pipeline.

### Agents
Finance and workout run on Vercel AI SDK `ToolLoopAgent`s with Zod-typed tools.

| Agent | File | Tools |
| --- | --- | --- |
| Finance | `lib/agent/finance-agent.ts` | `searchTransactions`, `updateTransaction`, `deleteTransaction`, `addTransaction`, `getSummary`, `getBudgetStatus`, `setBudget` |
| Workout | `lib/agent/workout-agent.ts` | `getSession`, `logSet`, `editLoggedSet`, `deleteLoggedSet`, `skipSets`, `goTo`, `addExtraSet`, `switchDay`, `endWorkout`, `finishWorkout` |

- **Fast path first**: obvious messages (`coffee 4.50`) skip the agent.
- **Falls through** to the original handlers if an agent errors or the message isn't its domain.
- **Search, then act**: agents never guess IDs and ask when several rows match.
- **Reversible**: edits and deletes register undo tokens.

### Models and credits
All text jobs run on Claude: Haiku for classifying and parsing, Sonnet for the orchestrator, agents and image reading, Opus as the last resort. Search uses Perplexity Sonar and falls back to Claude (without live data) when Perplexity is out. Voice transcription uses Google Gemini, its only job.

- **Keys**: `ANTHROPIC_API_KEY`, `PERPLEXITY_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY` (voice only).
- **Balances**: `/credits set claude 20.00` and `/credits set perplexity 8.94`. `/credits` shows estimates and costs.
- **Warnings**: Telegram alerts at 10% and 5% left per provider, plus an urgent alert (at most every 30 minutes) if Claude credits run out. Re-setting a balance re-arms them.
- The first `/credits` or model call creates the `AICredits` and `AIUsage` sheets.

---

## 🛠️ Tech Stack

| Component | Tech |
| --- | --- |
| Framework | Next.js (App Router), Node.js, TypeScript |
| Hosting | Vercel Serverless Functions |
| AI | Claude, Perplexity Sonar, Google speech transcription, via Vercel AI SDK |
| Dispatcher | Intent registry and domain handlers (`lib/handlers/`) |
| Undo | Single-use tokens in the `PendingActions` sheet (survive cold starts) |
| Data | Google Sheets (`Transactions`, `Todos`, `IOUs`, `Habits`, `Memory`, `PendingActions`, `UpdateLog`, `Workouts`, PH3 program sheet) |
| Integrations | Google Calendar (personal and work), Gmail (OAuth 2.0), iOS Shortcuts |

---

## ⏰ Cron Setup

Use Vercel Cron or [cron-job.org](https://cron-job.org) with the header `Authorization: Bearer <CRON_SECRET>` or the query param `?secret=<CRON_SECRET>`. `CRON_SECRET` is required; endpoints reject all requests without it.

| Endpoint | Schedule (UTC) | Purpose |
| --- | --- | --- |
| `/api/cron/briefing?type=morning` | `0 0 * * *` | Morning brief |
| `/api/cron/briefing?type=evening` | `0 14 * * *` | Evening recap |
| `/api/cron/calendar-reminders` | `*/10 * * * *` | To-do nags, event pings, leave-now alerts |
| `/api/cron/rest-timer` | `* * * * *` | Pings you when a workout rest timer ends (needs per-minute polling, e.g. cron-job.org) |
| `/api/cron/recurring` | `0 1 * * *` | Recurring subscriptions and tasks |
| `/api/cron/cleanup` | `0 16 * * *` | Prune expired actions, chat history, update IDs |

### Optional environment variables

| Variable | Purpose |
| --- | --- |
| `MEMORY_ENCRYPTION_KEY` | Random string (16+ chars) that encrypts `credential` memories (AES-256-GCM). Changing it makes saved credentials unreadable. |
| `MONTHLY_BUDGET` | Fallback budget when none is set via `/budget set`. |

---

## 🧪 Tests

```bash
npm run test:ego               # orchestrator unit tests
npm run eval:ego               # routing accuracy vs live model (-- --dry-run for offline)
npm run test:ai-router         # model router (offline)
npm run check:ai-live          # live provider check (a few cents)
npm run test:intents           # fixture check, no API calls
npm run eval:intents           # live intent classification (~10k tokens per case)
npm run test:split
npm run test:calendar
npm run test:memory
npm run test:currency-export
npm run test:workout-session
```

`eval:ego` defaults to Sonnet; set `EGO_EVAL_MODEL=claude-haiku-5-5` to try Haiku.

---

## 🔒 Security & Reliability

- **Allowlist**: only my Telegram user ID can use the bot.
- **Webhook secrets** verified on all Telegram and Apple Wallet calls.
- **Confirmation tokens**: destructive actions need a single-use token that expires in 5 minutes.
- **Agent guardrails**: prompt-injection guards and Zod validation on every tool input.
- **Idempotency**: Telegram retries and duplicate Gmail receipts are deduplicated via `UpdateLog`.
- **Soft deletes** keep a full audit trail, and universal undo covers calendar, to-do and finance actions.
