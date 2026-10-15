# 🤖 Telegram Personal Assistant

Hey! 👋 This is my personal Telegram assistant bot that essentially runs my daily life — handling my expenses, scheduling, nagging to-dos, email drafts, habit streaks, bill splitting, and memory recall without me ever having to open five different apps.

I built this full-stack serverless bot using **Next.js**, **TypeScript**, **Google Gemini 3.6 Flash**, **Perplexity Sonar**, the **Vercel AI SDK**, and **Vercel**. It hooks directly into my **Telegram**, **Google Sheets**, **Google Calendar**, and **Gmail**.

It started as a rigid intent router (one model call picks one fixed action). For finance and workouts it is now **agentic**: tool-calling agents search my data, decide what to change, and undo it if I ask, so I can just say *"change that to $15"* or *"delete my last set"* instead of editing a Google Sheet by hand. See [Agentic layer](#-agentic-layer-tool-calling-agents).

---

## ⚡ What this bot actually does for me

### 1. 💸 Hands-off Finance, Bill Splitting & Multi-Currency Tracking
I hate manually logging expenses. So I made it as frictionless as possible:
- **Apple Pay Auto-Log**: The second I tap my iPhone or Apple Watch at a store (or pay in-app/online), an iOS Shortcut fires in the background, hits my webhook, categorizes the purchase with AI, and logs it to my Google Sheet.
- **DBS PayLah! & Grab Auto-Sync**: The bot scans my Gmail for payment confirmations from DBS, POSB, PayNow, and Grab, extracts what I bought, and logs it. (I can also trigger `/sync` anytime).
- **Multi-Currency Live Conversion to SGD**: When travelling or buying online in USD, JPY, EUR, MYR, THB, or 15+ currencies, amounts are automatically converted to SGD using live FX rates (or cached Singapore-centric fallback tables), recording both original and SGD equivalent amounts.
- **Bill Splitting & IOU Ledger (`/split`, `/owed`)**:
  - Split bills effortlessly: `/split 60 Alice, Bob` or natural language: *"split $120 for dinner between me, Sarah, Dave with 10% tip"*.
  - Strict penny allocation ensures remainder cents are cleanly distributed with zero rounding loss.
  - Generates an IOU balance ledger with inline `[💸 Mark Settled]` callback buttons.
  - Automatically records your personal share as an expense in your finance sheet.
- **Natural Language Query Filters**: Ask *"how much did I spend on Grab this month?"*, *"show my food expenses in Sep"*, or *"how much did I spend at FairPrice?"* to get filtered totals and matching transaction lists.
- **Monthly CSV Export (`/export [month]`)**: Generates an RFC 4180 compliant CSV document directly in Telegram for spreadsheet analysis or tax accounting.
- **Recurring Subscriptions & Schedules**: Automated cron logs fixed subscriptions (e.g. Netflix, Spotify, gym membership) on their scheduled billing dates.
- **Monthly Budget Control & Real-Time Pacing**: Adjustable budget (default $500/mo) with configurable threshold alerts (50%, 75%, 90%, 100%) and daily allowance pacing calculations (`$X/day left in month`). Check balance anytime with `/budget`.
- **Executive UI/UX Google Sheets Dashboard (`📊 Dashboard`)**: Pinned as the first tab in Google Sheets with an executive dark slate/indigo theme, dynamic month dropdown (`L2`), live KPI cards, category breakdown, embedded doughnut chart, and real-time Top 5 largest expenses ranking.
- **Conversational Fixes (Finance Agent)**: Wrong amount or category? Just say so: *"change that to $15"*, *"that lunch was actually dining, not groceries"*, *"delete the Grab one from yesterday"*, or swipe-reply to a transaction. The agent searches across months, edits the right row, and replies with old → new. If two transactions match it asks which one instead of guessing.
- **Budget by Chat**: *"set my budget to $700"* or *"cap dining at $150"* updates the live budget, and *"how much do I have left?"* reads it back.
- **Safe Soft Deletes & Universal Undo**: Every agent edit, delete or add comes with an `[↩️ Undo]` button. Deletes only mark the row `deleted` in Google Sheets (nothing is destroyed), and undoing a delete restores it, while undoing an edit puts the previous values back.

### 2. 🏋️ Guided PH3 Workout Logging (Natural-Language Control)
Say `workout` and the bot reads today's day from my PH3 training program sheet, announces the exercises, then walks me through it set by set.
- **Fast logging**: reply `100 x 5`, `102.5 for 6`, or `bw x 10`. Each set is written into the program sheet as `weight*reps`.
- **Sheet-safe**: prescribed formula-driven cells and anything I already filled in are never overwritten. Those sets are saved to a `Workouts` tab instead.
- **Talk to it like a coach, not a form**: *"make that 95 not 90"*, *"delete set 2 of bench"*, *"skip the rest of triceps"*, *"do rows before the next exercise"*, *"add a bonus set of 60 for 12"*, or *"I'm done, skip the rest"*. The workout agent interprets it, updates the log (and the sheet cell), and asks again for the next set.
- **Skip or switch days**: *"skip day 1 and start day 2"*, `/workoutday 12`, `/nextworkoutday`. Skipped sets are never asked for again, and anything left undone is brought back before the session ends.
- **Stays out of the way**: unrelated messages during a workout (*"what's the weather?"*) go back to the normal assistant.

### 3. 📅 Smart Google Calendar, Free Slots & Leave-Now Alerts
- **Personal & Work Calendar Routing**: Just text *"Schedule project sync tomorrow 3pm to 4:30pm in Room 302 at work"*, and it routes to my work calendar, schedules the time, and extracts the location cleanly.
- **Free Slots Finder (`/freeslots [date]`)**: Ask *"when am I free tomorrow?"* or `/freeslots` to scan personal and work calendars and compute available open windows between 9 AM and 9 PM SGT.
- **Natural Language Rescheduling**: Say *"move my gym session to 5pm tomorrow"* or *"reschedule dentist to next Monday"* — automatically shifts the event in Google Calendar without manual entry.
- **Leave-Now Travel Alerts**: Analyzes upcoming event locations and calculates Singapore transit times and buffer intervals (e.g. 45m for Changi, 25m for CBD, 40m for NUS, 0m for Zoom/Meet), pinging you when it's time to head out.
- **Flyer & Email Screenshot OCR**: Screenshot an event flyer or meeting invite and send it to the bot — Gemini extracts start/end times and location into Google Calendar.
- **Upcoming Event Reminders**: Before an event starts, receive a Telegram ping with countdown, venue location, and a direct Google Calendar link.

### 4. ⏰ Persistent 30-Minute To-Do Reminders (The "Nag" Feature)
- If I tell the bot *"remind me to call John"* or `/remind buy groceries`, it adds it to my to-do list and **pings me on Telegram every 30 minutes** until I actually get it done.
- **Quiet Hours Enforcement**: Reminders respect Singapore quiet hours (11:00 PM – 8:00 AM SGT), keeping your sleep uninterrupted.
- **Smart Snooze Options**: Tapping snooze pauses reminders for 1 hour, tonight (8:00 PM), or tomorrow morning (9:00 AM).
- **Inline Actions**:
  - `[✅ Mark Done]`: Marks the task completed in Google Sheets and stops future reminders immediately.
  - `[🔕 Mute Reminder]`: Silences recurring notifications while keeping the task active.
  - `[↩️ Undo]`: Accidental tap? Instant 1-tap undo restores the task to active.

### 5. 🌅 Proactive Morning Brief & Evening Recap
Automated scheduled summaries delivered to Telegram:
- **Morning Brief (8:00 AM SGT)**:
  - Today's agenda across work and personal calendars
  - Overdue tasks and high-priority to-dos due today
  - Monthly budget pacing and daily allowance left
  - Actionable email triage digest
- **Evening Recap (10:00 PM SGT)**:
  - Total expenditure logged today and top spending categories
  - Tasks still open
  - First scheduled event for tomorrow morning
  - Daily habit streak review with 1-tap check-off buttons
- **Sunday Weekly Spending Report (Sunday 10:00 PM SGT)**:
  - Week-over-week spending comparison, percentage delta, and highest expense categories.

### 6. 🔥 Daily Habit Streak Tracker (`/habits`)
- Track daily routines like *"Read 20 mins"*, *"Workout"*, or *"Drink 2L Water"*.
- Tracks current streak and all-time best streak.
- `/habits` command displays progress with interactive inline buttons to check off remaining habits for the day.
- Habit review is seamlessly built into the 10:00 PM evening recap.

### 7. 🧠 Personal Memory, Notes & Contacts (`/remember`, `/recall`)
- **Save information**: `/remember WiFi: GuestPassword123` or *"remember that Alice's birthday is June 15"*.
- **Recall instantly**: `/recall WiFi` or *"what is Alice's birthday?"*.
- **Contact Nickname Resolution**: Remembers emails, phone numbers, and nicknames (e.g. "Ali" -> `alice.tan@example.com`), automatically resolving recipient addresses when drafting emails or splitting bills.

### 8. 📬 Gmail Inbox Triage & Quick Draft Execution (`/inbox`)
- `/inbox` scans unread emails and generates an actionable triage digest, separating priority action items from newsletters.
- Voice or text: *"Draft an email to Alex about the project update"* creates a polite Gmail draft.
- Every created draft includes an inline `[📤 Send Now]` button to immediately send the draft without opening Gmail.

### 9. 🔍 Perplexity Sonar Web Search Fallback
- When asking general questions or queries unrelated to calendar/finance/todos (e.g. *"what's the weather forecast this weekend in Singapore?"* or *"explain quantum computing simply"*), the bot seamlessly queries Perplexity Sonar and provides an intelligent, cited answer.

---

## 🎮 Command Reference

| Command | Description |
| --- | --- |
| `/menu`, `/start`, `/help` | Interactive 12-button control panel |
| `/split <amount> <p1, p2, ...>` | Split a bill evenly with remainder penny distribution & IOU recording |
| `/owed [person]` | View outstanding IOU debt balances with inline settle buttons |
| `/freeslots [date]` | Find open calendar slots between 9 AM and 9 PM SGT |
| `/inbox` | Unread Gmail triage digest with 1-tap draft send buttons |
| `/remember <key>: <val>` | Save personal notes, credentials, contacts, or preferences |
| `/recall <query>` | Search memory store using multi-factor token relevance |
| `/export [month]` | Download monthly transactions as an RFC 4180 CSV file |
| `/habits` | View daily habit streaks with quick check-off buttons |
| `/habit add <name>` | Create a new daily habit tracker |
| `/budget` | View current month's budget, remaining spend, and daily pacing |
| `/finance summary` | View monthly spending breakdown and category totals |
| `/finance list` | View recent 10 transactions |
| `/sync` | Run instant Gmail sync for DBS PayLah! and Grab receipts |
| `/agenda` | View today's schedule with Singapore timezone formatting |
| `/calendar` | List upcoming Google Calendar events |
| `/todo` | View active to-dos with 1-tap completion buttons |
| `/todo today` | View tasks due today |
| `/remind <task>` | Create a task with persistent 30-minute Telegram pings |
| `/workout`, `/gym` | Start the guided PH3 workout for today |
| `/endworkout` | End the session (logged sets are saved, you stay on the same day) |
| `/workoutday <n>`, `/nextworkoutday` | Jump to a program day or skip to the next one |
| `/budget set <amount>`, `/budget cap <category> <amount>` | Set the overall budget or a category cap |

---

## 🤖 Agentic layer (tool-calling agents)

The original design was **one model call → one fixed action** (`lib/assistant-intent.ts`). That's fast and cheap, but rigid: it can't look at the data, so it can't fix a specific wrong transaction or skip a specific set. Two domains now run on **tool-calling agents** built with the Vercel AI SDK's `ToolLoopAgent`:

| Agent | Where | Tools |
| --- | --- | --- |
| **Finance** (`lib/agent/finance-agent.ts`) | Edits/deletes and money-related messages the intent router can't place | `searchTransactions`, `updateTransaction`, `deleteTransaction`, `addTransaction`, `getSummary`, `getBudgetStatus`, `setBudget` |
| **Workout** (`lib/agent/workout-agent.ts`) | Any message during a guided session that isn't a plain `weight x reps` | `getSession`, `logSet`, `editLoggedSet`, `deleteLoggedSet`, `skipSets`, `goTo`, `addExtraSet`, `switchDay`, `endWorkout`, `finishWorkout` |

How it fits together:
- **Fast path first.** Obvious messages (`coffee 4.50`, `100 x 5`, `end workout`) still use the cheap regex/intent path. The agent only runs when that path can't handle the message.
- **Fall-through, not hard dependency.** If an agent errors, or decides the message isn't about its domain, the original handlers and web-search fallback run as before.
- **Act, then verify.** Agents never guess IDs: they search first, ask a clarifying question if more than one row matches, and only report what the tools actually returned.
- **Reversible by default.** Finance edits and deletes register undo tokens and the reply carries an `[↩️ Undo]` button. Workout edits go through the same session state as normal logging.
- **Per-set session state.** The workout session tracks every set as logged, skipped or pending, so skips, edits and out-of-order work all stay consistent.

---

## 🛠️ Tech Stack & Architecture

| Component | Tech |
| --- | --- |
| **Backend Framework** | Next.js (App Router, Route Handlers), Node.js, TypeScript |
| **Hosting & Serverless** | Vercel Serverless Functions |
| **AI Models** | Google Gemini 3.6 Flash & Perplexity Sonar via Vercel AI SDK |
| **Agents** | Vercel AI SDK `ToolLoopAgent` with Zod-typed tools (finance + workout) |
| **Modular Dispatcher** | Intent Registry & Domain Handlers (`lib/handlers/`) |
| **Universal Undo** | Single-use undo tokens persisted in the `PendingActions` sheet (survive serverless cold starts) for calendar, todo, finance, workout and subscription actions |
| **Database & State** | Google Sheets API (`Transactions`, `Todos`, `IOUs`, `Habits`, `Memory`, `PendingActions`, `UpdateLog`, `Workouts`, plus the PH3 program sheet) |
| **Calendar Engine** | Google Calendar API (Dual-calendar: Personal & Work, Free Slots Algorithm) |
| **Email & Financial Sync** | Gmail API (OAuth 2.0), iOS Shortcuts Personal Automation |
| **Multi-Currency** | Live FX rates with Singapore-centric fallback table |

---

## ⏰ Cron Endpoints Setup

Configure your cron provider (e.g. Vercel Cron or [cron-job.org](https://cron-job.org)) with:
- **Header**: `Authorization: Bearer <CRON_SECRET>`
- **Or URL Query Param**: `?secret=<CRON_SECRET>` (e.g. `https://<app>.vercel.app/api/cron/calendar-reminders?secret=<CRON_SECRET>`)

| Endpoint | Schedule | Purpose |
| --- | --- | --- |
| `/api/cron/briefing?type=morning` | `0 0 * * *` (8:00 AM SGT) | Daily morning briefing (events, tasks, budget, emails) |
| `/api/cron/briefing?type=evening` | `0 14 * * *` (10:00 PM SGT) | Daily evening recap (spending, open tasks, habits, next day event) |
| `/api/cron/calendar-reminders` | `*/10 * * * *` | 30-min to-do nagging, upcoming event pings, leave-now travel alerts |
| `/api/cron/recurring` | `0 1 * * *` (9:00 AM SGT) | Logs due recurring subscriptions and creates recurring tasks |
| `/api/cron/cleanup` | `0 16 * * *` (12:00 AM SGT) | Prunes expired pending actions, old chat history, and old Telegram update IDs |

`CRON_SECRET` is required: cron endpoints reject every request when it is unset.

### Optional environment variables

| Variable | Purpose |
| --- | --- |
| `MEMORY_ENCRYPTION_KEY` | Any random string (16+ chars). Encrypts `credential` memories (AES-256-GCM) before they are written to Google Sheets. Changing it makes previously saved credentials unreadable. |
| `MONTHLY_BUDGET` | Fallback monthly budget when none is set via `/budget set`. |

---

## 🧪 Test Suites

Run the local unit test runners:

```bash
# Test Intent Classification Fixtures
npm run test:intents -- --dry-run

# Test Bill Splitting & IOU Arithmetic
npm run test:split

# Test Calendar Free Slots & Travel Buffers
npm run test:calendar

# Test Personal Memory & Contact Parsing
npm run test:memory

# Test Currency Conversion & CSV Export
npm run test:currency-export

# Test Guided Workout Parsing, Skips & Per-Set Cursor
npm run test:workout-session
```

---

## 🔒 Security & Reliability

- **User Allowlisting**: Only my specific Telegram numeric User ID can interact with the bot. Unauthorized users get ignored.
- **Webhook Secrets**: All incoming Telegram and Apple Wallet webhook calls verify high-entropy secret tokens.
- **Cryptographic Confirmation Tokens**: Destructive actions require multi-step confirmation with single-use tokens that expire after 5 minutes.
- **Universal Undo**: Quick rollback for accidental calendar creations, task completions, and agent edits or deletes of transactions.
- **Agent Guardrails**: Agent prompts carry prompt-injection guardrails, and every agent tool input is schema-validated with Zod before it touches Google Sheets.
- **Idempotency & Deduplication**: Telegram retries and duplicate Gmail receipts are checked against an `UpdateLog` sheet to ensure zero duplicate records.
- **Soft Deletes**: Deleting an expense marks it `deleted` in Google Sheets rather than removing the row, keeping a full audit trail.
