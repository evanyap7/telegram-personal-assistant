# 🤖 Telegram Personal Assistant

Hey! 👋 This is my personal Telegram assistant bot that essentially runs my daily life — handling my expenses, scheduling, nagging to-dos, and Gmail drafts without me ever having to open five different apps. 

I built this full-stack serverless bot using **Next.js**, **TypeScript**, **Google Gemini 3.6 Flash**, **Perplexity Sonar**, and **Vercel**. It hooks directly into my **Telegram**, **Google Sheets**, **Google Calendar**, and **Gmail**.

---

## ⚡ What this bot actually does for me

### 1. 💸 Hands-off Finance & Expense Tracking
I hate manually logging expenses. So I made it as frictionless as possible:
- **Apple Pay Auto-Log**: The second I tap my iPhone or Apple Watch at a store, an iOS Shortcut fires in the background, hits my webhook, categorizes the purchase with AI, and logs it to my Google Sheet.
- **DBS PayLah! & Grab Auto-Sync**: The bot scans my Gmail for payment confirmations from DBS, POSB, PayNow, and Grab, extracts what I bought, and logs it. (I can also trigger `/sync` anytime).
- **Natural Language & Voice**: I can literally text or voice-note *"spent $6.50 on chicken rice for lunch"* or *"earned $150 from freelance"*, and it parses the amount, currency, category, and date.
- **Receipt Photos**: Snap a picture of a receipt, and the vision model breaks down the total, merchant, and items.
- **Monthly Spending Breakdown**: Tap `/finance_summary` or ask *"how much did I spend this month?"* for clean category-by-category charts.
- **Safe Soft Deletes**: Made a mistake? Tap the `[🗑️ Undo]` button on the Telegram alert or say *"delete my coffee expense"* — it safely marks it deleted in Google Sheets without destroying history.

### 2. 📅 Smart Google Calendar & Meeting Locations
- **Personal & Work Calendar Routing**: Just text *"Schedule project sync tomorrow 3pm to 4:30pm in Room 302 at work"*, and it routes to my work calendar, schedules the time, and extracts the location cleanly.
- **Flyer & Email Screenshot OCR**: When I receive an event poster, conference email, or meeting flyer, I just screenshot it, send it to the bot with *"add this to my calendar"*, and the AI extracts the exact start/end times, venue/meeting link into the `Location` field, and creates the event.
- **Upcoming Event Reminders**: Before an event starts (default 30 mins, or custom like *"notify me 2 hours before the deadline"*), the bot sends me a Telegram ping with countdown, venue location, and a direct Google Calendar link.
- **Daily Agenda & Week View**: Send `/agenda` or tap the button to get today's timeline in Singapore time.

### 3. ⏰ Persistent 30-Minute To-Do Reminders (The "Nag" Feature)
I tend to procrastinate or forget quick tasks. So I built an automated nag engine:
- If I tell the bot *"remind me to call John"* or `/remind buy groceries`, it adds it to my to-do list and **pings me on Telegram every 30 minutes** until I actually get it done.
- The reminder message includes two quick inline buttons:
  - `[✅ Mark Done]`: Marks the task completed in Google Sheets and stops all future reminder notifications immediately.
  - `[🔕 Mute Reminder]`: Silences the 30-minute notifications if I'm in a meeting, while keeping the task active.
- Daily tasks (`/todo today`) and full task lists (`/todo`) with 1-tap checkmark buttons.

### 4. 🎮 Interactive Inline Button Control Panel
Instead of remembering a bunch of slash commands, I can just type `/menu`, `/start`, `/help`, or *"menu"* to bring up an interactive dashboard with 12 quick-tap buttons:
- 📅 Today's Agenda (`menu:agenda`)
- 📆 Upcoming Events (`menu:calendar`)
- 🔔 Check Reminders (`menu:reminders`)
- 📋 Active Tasks (`menu:todos`)
- 📌 Today's Tasks (`menu:todos_today`)
- 💰 Spending Summary (`menu:finance_summary`)
- 💳 Recent Expenses (`menu:finance_list`)
- 🔄 Sync DBS & Grab (`menu:sync`)
- 🎤 Voice Notes Guide (`menu:guide_voice`)
- 📸 Photos & OCR Guide (`menu:guide_image`)
- 📖 Full Guide & Tips (`menu:guide_all`)
- ⚙️ Sync Commands (`menu:set_commands`)

Every view has a `« Back to Dashboard` button, making navigation super smooth.

### 5. ✉️ Gmail Drafts on the Fly
If I need to write an email while walking, I just voice note:
> *"Draft an email to Alex about the Q4 product roadmap update and tell him we're on track for Friday"*

The bot creates a polite, well-structured draft directly inside my Gmail account and drops a link in Telegram so I can review and hit send whenever I want.

### 6. 🎙️ Voice Notes & Multi-Image Albums
- **Opus Voice Memos**: Native Telegram voice notes are downloaded in memory, transcribed via Gemini, and processed just like text.
- **Batch Image Debouncing**: If I dump 5 receipt photos or event screenshots in a single Telegram album, the bot groups them and confirms them together instead of spamming 5 separate messages.

---

## 🛠️ Tech Stack

| Component | Tech |
| --- | --- |
| **Backend Framework** | Next.js (App Router, Route Handlers), Node.js, TypeScript |
| **Hosting & Serverless** | Vercel Edge / Serverless Functions |
| **AI Models** | Google Gemini 3.6 Flash (Audio transcription, Vision OCR, Fast parsing) & Perplexity Sonar via Vercel AI SDK |
| **Bot Interface** | Telegram Bot API (Webhooks, Inline Keyboards, Callbacks) |
| **Database & State** | Google Sheets API (`Transactions`, `Todos`, `PendingActions`, `UpdateLog`) |
| **Calendar Engine** | Google Calendar API (Dual-calendar: Personal & Work) |
| **Email & Financial Sync** | Gmail API (OAuth 2.0), iOS Shortcuts Personal Automation |
| **Validation** | Zod (Strict schema validation for all inputs & AI outputs) |

---

## 🏗️ Architecture Flow

```text
  [ Apple Pay Tap ]         [ DBS / Grab Email ]             [ Telegram User ]
          │                         │                               │
          ▼                         ▼                               ▼
iOS Shortcut Automation      Gmail API Background Sync      Telegram Bot Webhook
          │                         │                               │
          ▼                         ▼                               ▼
/api/apple-wallet            /api/paylah-sync               /api/telegram
          │                         │                               │
          └─────────────────────────┼───────────────────────────────┘
                                    │
                  ┌─────────────────┴─────────────────┐
                  │ • Webhook Secret & User Auth      │
                  │ • Zod Validation & Deduplication  │
                  │ • Gemini 3.6 / Sonar AI Engine    │
                  └─────────────────┬─────────────────┘
                                    │
          ┌─────────────────────────┼─────────────────────────┐
          ▼                         ▼                         ▼
   Google Sheets             Google Calendar              Telegram
(Transactions & Todos)      (Personal & Work)       (Interactive Buttons &
                                                      Event Reminders)
```

---

## 🔒 Security & Reliability

Because this bot manages my actual money, schedule, and emails, I built it with strict guardrails:
- **User Allowlisting**: Only my specific Telegram numeric User ID can interact with the bot. Unauthorized users get ignored.
- **Webhook Secrets**: All incoming Telegram and Apple Wallet webhook calls verify high-entropy secret tokens.
- **Cryptographic Confirmation Tokens**: Destructive actions (deleting calendar events or expenses) require multi-step confirmation with single-use tokens that expire after 5 minutes.
- **Idempotency & Deduplication**: Telegram retries and duplicate Gmail receipts are checked against an `UpdateLog` sheet to ensure no transaction is ever recorded twice.
- **Soft Deletes**: Deleting an expense marks it `deleted` in Google Sheets rather than removing the row, keeping a full audit trail.

---

## 📊 Google Sheets Setup

The database runs on a single Google Spreadsheet with these tabs:

1. **`Transactions`**: Logs all income/expenses with ID, timestamp, type, amount, currency, category, description, and status (`active` / `deleted`).
2. **`Todos`**: Stores tasks with ID, created timestamp, task description, due date, priority, status (`active` / `completed`), completion timestamp, reminder interval (e.g. `30` mins), last reminded timestamp, and chat ID.
3. **`PendingActions`**: Temporary server state holding payload JSON and 5-minute expiry tokens for inline button confirmations.
4. **`UpdateLog`**: Webhook update deduplication ledger tracking processed Telegram update IDs.

---

## 🚀 Local Development

### 1. Clone & Install
```bash
git clone https://github.com/evanyap7/telegram-personal-assistant.git
cd telegram-personal-assistant
npm install
```

### 2. Configure `.env.local`
```bash
cp .env.example .env.local
```

Fill in your credentials:
```env
# Telegram
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
TELEGRAM_WEBHOOK_SECRET=your_long_random_webhook_secret
TELEGRAM_ALLOWED_USER_ID=your_numeric_user_id

# AI Models
GEMINI_API_KEY=your_google_gemini_api_key
PERPLEXITY_API_KEY=your_perplexity_api_key

# Google APIs
GOOGLE_SHEET_ID=your_google_sheet_id
GOOGLE_PERSONAL_CALENDAR_ID=your_personal_calendar_id
GOOGLE_WORK_CALENDAR_ID=your_work_calendar_id
GOOGLE_CLIENT_ID=your_google_oauth_client_id
GOOGLE_CLIENT_SECRET=your_google_oauth_client_secret
GOOGLE_REFRESH_TOKEN=your_google_oauth_refresh_token

# Apple Pay / Webhook Secrets
APPLE_WALLET_SECRET=your_wallet_webhook_secret
CRON_SECRET=your_cron_secret
```

### 3. Generate Gmail OAuth Token (For Drafts & DBS Sync)
```bash
npm run get-gmail-token
```
Follow the browser prompt to grant permissions and paste the generated `GOOGLE_REFRESH_TOKEN` into your `.env.local`.

### 4. Run Locally
```bash
npm run dev
```

---

## ⏰ Background Cron Setup (Event & To-Do Reminders)

To have the bot check for event reminders (30 mins before meetings) and ping you every 30 mins for active to-do reminders, set up an external cron job (like [cron-job.org](https://cron-job.org)) to hit the reminder endpoint:

```text
GET https://YOUR_VERCEL_DOMAIN/api/cron/calendar-reminders
Header: Authorization: Bearer <CRON_SECRET>
Schedule: Every 10 or 15 minutes
```

---

## 💼 Engineering & Resume Highlights

- **Architected fintech ingestion pipelines for Apple Pay, Grab, DBS/POSB, and e-commerce receipts (Shopee, Amazon)** via iOS Shortcuts and Gmail push webhooks (Google Cloud Pub/Sub); parallel batch execution (`Promise.allSettled`) and a regex-first parser cut sync latency 78% and eliminated date-parsing crashes.
- **Engineered a cost-optimized, 3-tiered AI intent engine (Gemini Flash-Lite → 3.6 Flash → Perplexity Sonar failover)** on Vercel AI SDK, cutting inference cost 70% with 809ms median classification latency, enforced by Zod schemas for 100% type-safe action routing.
- **Built an in-memory multimodal pipeline with magic-byte validation**, transcribing Opus voice memos and extracting up to 30 calendar events (with venues, room numbers, and meeting links) or 25 receipt items per image, synced across Google Sheets and dual calendars (Personal/Work).
- **Designed an asynchronous reminder engine & interactive Telegram dashboard**, dispatching dynamic event alerts and persistent 30-minute recurring to-do notifications until completion, accompanied by a 12-button inline control panel with 1-tap completion callbacks.
- **Hardened production security and distributed reliability** with constant-time authorization (`timingSafeEqual`), prompt-injection guardrails, and automated PII/PAN/NRIC redaction; exponential backoff with jitter and idempotency ledgers prevented duplicate transactions and retry storms.
