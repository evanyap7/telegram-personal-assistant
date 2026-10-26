# 🤖 EGO: Everything Gets Optimized

**One Telegram chat that runs my day.** Type or send a voice note and EGO logs the expense, books the meeting, coaches the lift and chases the to-do. No app switching, no forms.

Built solo as a serverless bot: **Next.js · TypeScript · Claude (Haiku, Sonnet, Opus) · Perplexity Sonar · Vercel AI SDK · Vercel**, on top of **Google Sheets, Calendar and Gmail**.

> *"log lunch $14 and move my 3pm to 4"* → two tools, one message, both undoable.

---

## ⚡ What it does

| | |
| --- | --- |
| 💸 **Finance** | Apple Pay taps and DBS PayLah!/Grab emails auto-log and auto-categorise. 15+ currencies, bill splitting with an IOU ledger, budgets with pacing alerts, CSV export, a Sheets dashboard. |
| 🏋️ **Workout coach** | Reads today's session from my 90-day powerlifting programme and walks me through it set by set. Log with `100 x 5`, fix with *"make that 95 not 90"*. Starts a **rest timer after every set** and pings me when it's time to lift again. |
| 📅 **Calendar** | Routes events to personal or work, finds free slots, reschedules in plain language, sends leave-now alerts, reads flyers and invite screenshots. |
| ⏰ **To-dos** | *"remind me to call John"* nags every 30 min until done, respecting quiet hours. |
| 🌅 **Briefs** | Morning agenda, evening recap and a weekly spending report. |
| 🔥 **Habits · 🧠 Memory · 📬 Email · 🔍 Search** | Streaks, notes and encrypted credentials, inbox triage and voice-drafted replies, cited web answers. |

---

## 🧠 How it works

Every message, voice note or photo goes to one **orchestrator agent** that picks from typed tools: finance and workout sub-agents, calendar, to-dos, email, habits, splitting, memory, search and more.

- **Fast where it can be**: slash commands, buttons, cron jobs and plain `weight x reps` logging skip the model entirely.
- **Safe by design**: single-user allowlist, verified webhooks, Zod-validated tool inputs, confirmation tokens for destructive actions, soft deletes and an **undo button on every change**.
- **Cost-aware**: Haiku classifies, Sonnet orchestrates, Opus is the last resort. `/credits` tracks balances and warns at 10% and 5%.
- **Stateless**: state lives in Google Sheets, so it runs happily on cold-start serverless functions.

---

## 🚀 Run your own

1. `npm install`, then copy the variables below into `.env.local` and Vercel.
2. Deploy to Vercel and point the Telegram webhook at `/api/telegram`.
3. Schedule the crons below.

| Required variables | |
| --- | --- |
| Telegram | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_ALLOWED_USER_ID` |
| Google | `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `GOOGLE_SHEET_ID`, `GOOGLE_WORKOUT_SHEET_ID`, `GOOGLE_CALENDAR_ID_PERSONAL`, `GOOGLE_CALENDAR_ID_WORK`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` |
| AI | `ANTHROPIC_API_KEY`, `PERPLEXITY_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY` (voice only) |
| Other | `CRON_SECRET`, `APPLE_WALLET_SECRET`, `GMAIL_PUBSUB_TOPIC` |

Optional: `MEMORY_ENCRYPTION_KEY` (encrypts saved credentials), `MONTHLY_BUDGET`. Setup guides: [Apple Wallet](APPLE_WALLET_SETUP.md), [Gmail push](GMAIL_PUSH_SETUP.md).

### ⏰ Crons
Call each endpoint with `Authorization: Bearer <CRON_SECRET>` from Vercel Cron or [cron-job.org](https://cron-job.org).

| Endpoint | Schedule (UTC) | Purpose |
| --- | --- | --- |
| `/api/cron/briefing?type=morning` | `0 0 * * *` | Morning brief |
| `/api/cron/briefing?type=evening` | `0 14 * * *` | Evening recap |
| `/api/cron/calendar-reminders` | `*/10 * * * *` | To-do nags, event pings, leave-now alerts |
| `/api/cron/rest-timer` | `* * * * *` | Workout rest-over pings (1-minute polling, 30 s timeout) |
| `/api/cron/recurring` | `0 1 * * *` | Recurring subscriptions and tasks |
| `/api/cron/cleanup` | `0 16 * * *` | Prune expired actions and logs |

---

## 🎮 Commands

`/menu` · `/split` · `/owed` · `/budget` · `/finance` · `/export` · `/sync` · `/freeslots` · `/agenda` · `/todo` · `/remind` · `/inbox` · `/remember` · `/recall` · `/habits` · `/workout` · `/workoutday` · `/credits`

Everything also works as plain language. Commands are just shortcuts.

---

## 🧪 Tests

```bash
npm run test:ego        # orchestrator
npm run eval:ego        # routing accuracy vs live model (-- --dry-run for offline)
npm run test:workout-session
npm run test:split && npm run test:calendar && npm run test:memory
```
