# Telegram Personal Assistant

A secure, serverless Telegram personal assistant for natural-language finance tracking and Google Calendar management.

The assistant lets an authorized user record income and expenses, review recent transactions, create calendar events, search for records or events, and safely delete them through multi-step confirmation flows.

Built as an independent full-stack project with Next.js, TypeScript, Vercel AI SDK, Perplexity Sonar, Telegram Bot API, Google Sheets API, Google Calendar API, Zod, and Vercel.

## Features

### Finance Tracking

- Record income and expenses using natural language
- Extract transaction type, amount, currency, category, description, and date
- Store transactions in Google Sheets
- Generate unique transaction IDs
- View recent active transactions with `/finance list`
- Search for finance records using natural language
- Soft-delete transactions instead of permanently removing rows
- Retain transaction status and deletion timestamps for auditability

Examples:

```text
spent $6.20 for lunch
spent $2.50 on coffee
earned $100 from freelance work
delete my coffee expense
```

### Calendar Management

- Create Google Calendar events using natural language
- Route events to Personal or Work calendars
- Require confirmation before creating an event
- Search upcoming calendar events by title or keyword
- Select the exact event before deletion
- Require a second explicit confirmation before deleting an event
- Support date-only requests as all-day events
- Support timed events when users provide a clear start/end time or duration

Examples:

```text
Add gym tomorrow
Schedule floorball tomorrow from 8 pm to 9:30 pm
Add project meeting next Friday from 2 pm to 3 pm in work
delete gym tomorrow from personal
```

### Security and Reliability

- Telegram webhook secret-token verification
- Allowlist access control using an approved Telegram user ID
- Zod validation for incoming Telegram updates and AI-generated intents
- Persistent callback state stored in Google Sheets
- One-time action tokens for confirmations
- Telegram user-ownership checks for every callback action
- Five-minute expiration for pending actions
- Idempotency logging to prevent duplicate Telegram update processing
- Inline callback acknowledgement and keyboard removal
- Structured error logs with credential redaction
- Finance soft deletion for auditable records
- Calendar deletion only after explicit confirmation

## Tech Stack

| Area | Technologies |
| --- | --- |
| Backend | Next.js Route Handlers, Node.js, TypeScript |
| AI Intent Parsing | Vercel AI SDK, Perplexity Sonar API |
| Messaging | Telegram Bot API |
| Finance Storage | Google Sheets API |
| Calendar | Google Calendar API |
| Validation | Zod |
| Deployment | Vercel |

## Architecture

```text
Telegram User
     |
     v
Telegram Bot API Webhook
     |
     v
Next.js Route Handler: /api/telegram
     |
     +--> Verify Telegram webhook secret
     +--> Verify authorized Telegram user ID
     +--> Validate update payload with Zod
     +--> Prevent duplicate processing with UpdateLog
     |
     +--> Parse natural-language intent with Perplexity Sonar
     |
     +--> Finance actions
     |      |
     |      +--> Google Sheets Transactions tab
     |
     +--> Calendar actions
     |      |
     |      +--> Google Calendar API
     |
     +--> Pending actions and confirmation state
            |
            +--> Google Sheets PendingActions tab
```

## Intent Parsing

The assistant uses Perplexity Sonar through the Vercel AI SDK to convert natural-language Telegram messages into validated, structured intents.

Supported intent types include:

```text
finance_add
calendar_add
finance_delete_search
calendar_delete_search
unknown
```

Example finance intent:

```json
{
  "action": "finance_add",
  "type": "expense",
  "amount": 2.5,
  "currency": "SGD",
  "category": "Dining",
  "description": "coffee",
  "transactionDate": "2026-08-31"
}
```

Example timed calendar intent:

```json
{
  "action": "calendar_add",
  "calendarName": "personal",
  "allDay": false,
  "title": "Floorball",
  "start": "2026-09-02T20:00:00+08:00",
  "end": "2026-09-02T21:30:00+08:00"
}
```

Example all-day calendar intent:

```json
{
  "action": "calendar_add",
  "calendarName": "work",
  "allDay": true,
  "title": "Freshies Start School",
  "date": "2026-09-14"
}
```

## Confirmation Flows

### Calendar Creation

Calendar events are never created immediately after AI parsing.

```text
Natural-language calendar request
        |
        v
Parse and validate event details
        |
        v
Store pending action in Google Sheets
        |
        v
Send Telegram Yes/No buttons
        |
        +--> No: cancel pending action
        |
        +--> Yes: create Google Calendar event
```

### Finance Deletion

Finance deletion uses a two-step flow:

```text
Delete request
        |
        v
Search active finance transactions
        |
        v
User selects exact transaction
        |
        v
Show full transaction details
        |
        v
User taps Yes/No
        |
        +--> No: keep transaction
        |
        +--> Yes: mark Status = deleted in Google Sheets
```

Finance rows are retained for auditability.

### Calendar Deletion

Calendar deletion also uses a two-step confirmation flow:

```text
Delete request
        |
        v
Search upcoming events in selected calendar
        |
        v
User selects exact event
        |
        v
Show event title, calendar, start, and end
        |
        v
User taps Yes/No
        |
        +--> No: keep event
        |
        +--> Yes: delete selected Google Calendar event
```

Calendar deletion is permanent only after the second explicit confirmation.

## Google Sheets Structure

The project uses one spreadsheet with three tabs.

### `Transactions`

| Column | Field |
| --- | --- |
| A | Transaction ID |
| B | Timestamp |
| C | Type |
| D | Amount |
| E | Currency |
| F | Category |
| G | Description |
| H | Status |
| I | Deleted At |

Example:

```text
txn_abc123 | 31 Aug 2026 @ 4:43 PM | expense | 2.50 | SGD | Dining | coffee | active |
```

A deleted transaction remains in the sheet:

```text
txn_abc123 | 31 Aug 2026 @ 4:43 PM | expense | 2.50 | SGD | Dining | coffee | deleted | 2026-08-31T...
```

### `PendingActions`

| Column | Field |
| --- | --- |
| A | Token |
| B | User ID |
| C | Action Type |
| D | Payload JSON |
| E | Expires At |
| F | Status |

This tab stores short-lived server-side state for calendar creation, selection, and deletion confirmation workflows.

### `UpdateLog`

| Column | Field |
| --- | ---|
| A | Telegram Update ID |
| B | Status |
| C | Started At |
| D | Completed At |
| E | Action |
| F | Error |

This tab prevents duplicate processing when Telegram retries webhook deliveries.

## Local Setup

### Prerequisites

- Node.js 18 or later
- npm
- A Telegram bot token
- A Perplexity API key
- A Google Cloud project with Google Sheets API and Google Calendar API enabled
- Google OAuth credentials or a supported Google authentication configuration
- A Google Sheet for transaction and action state
- Personal and Work Google Calendar IDs
- A Vercel account for production deployment

### Installation

Clone the repository:

```bash
git clone https://github.com/evanyap7/telegram-personal-assistant.git
cd telegram-personal-assistant
```

Install dependencies:

```bash
npm install
```

Create the local environment file:

```bash
cp .env.example .env.local
```

Add the required environment variables:

```env
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
TELEGRAM_WEBHOOK_SECRET=your_long_random_webhook_secret
TELEGRAM_ALLOWED_USER_ID=your_telegram_numeric_user_id

PERPLEXITY_API_KEY=your_perplexity_api_key

GOOGLE_SHEET_ID=your_google_sheet_id
GOOGLE_PERSONAL_CALENDAR_ID=your_personal_calendar_id
GOOGLE_WORK_CALENDAR_ID=your_work_calendar_id

GOOGLE_CLIENT_ID=your_google_oauth_client_id
GOOGLE_CLIENT_SECRET=your_google_oauth_client_secret
GOOGLE_REFRESH_TOKEN=your_google_oauth_refresh_token
```

Never commit `.env.local`, OAuth credentials, refresh tokens, or bot tokens.

Start the development server:

```bash
npm run dev
```

## Environment Variables

| Variable | Purpose |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | Authenticates requests to the Telegram Bot API |
| `TELEGRAM_WEBHOOK_SECRET` | Verifies that webhook requests came from Telegram |
| `TELEGRAM_ALLOWED_USER_ID` | Restricts bot usage to one approved Telegram user |
| `PERPLEXITY_API_KEY` | Authenticates Perplexity Sonar intent parsing |
| `GOOGLE_SHEET_ID` | Identifies the spreadsheet used for application state |
| `GOOGLE_PERSONAL_CALENDAR_ID` | Personal Google Calendar destination |
| `GOOGLE_WORK_CALENDAR_ID` | Work Google Calendar destination |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `GOOGLE_REFRESH_TOKEN` | Google OAuth refresh token |

## Telegram Webhook Setup

After deploying the project, configure Telegram to send both messages and inline-button callbacks to the webhook endpoint.

```bash
curl -X POST \
  "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -H "Content-Type: application/json" \
  -d "{
    \"url\": \"https://YOUR_VERCEL_DOMAIN/api/telegram\",
    \"secret_token\": \"${TELEGRAM_WEBHOOK_SECRET}\",
    \"allowed_updates\": [\"message\", \"callback_query\"],
    \"drop_pending_updates\": true
  }"
```

Replace:

```text
YOUR_VERCEL_DOMAIN
```

with the production Vercel deployment domain.

## Build and Deployment

Build locally before pushing:

```bash
npm run build
```

Deploy through the GitHub and Vercel integration:

```bash
git add .
git commit -m "Describe your change"
git push
```

Vercel automatically creates a production deployment from the connected production branch.

## Example Commands

### Finance

```text
spent $6.20 for lunch
spent 23.50 SGD on groceries
earned $100 from freelance work
/finance list
delete my coffee expense
```

### Calendar

```text
Add gym tomorrow
Schedule floorball tomorrow from 8 pm to 9:30 pm
Add a project meeting next Friday from 2 pm to 3 pm in work
delete gym tomorrow from personal
```

## Safety Design Decisions

- The AI model only classifies user intent and extracts structured data.
- The AI model cannot call Google Sheets, Google Calendar, Telegram, or other external APIs directly.
- Calendar creation always requires explicit user confirmation.
- Finance deletion requires transaction selection and a second confirmation.
- Calendar deletion requires event selection and a second confirmation.
- Finance deletion is implemented as a soft delete to maintain transaction history.
- Pending callback tokens are stored server-side, scoped to the authorized Telegram user, expire after five minutes, and can be used once.
- Telegram update IDs are logged to prevent duplicate webhook processing.
- Error logs redact recognizable secret formats before output.

## Future Improvements

- Add finance summaries by week, month, category, and currency
- Add transaction restoration through `/finance undo <transaction-id>`
- Support calendar event updates and rescheduling
- Add date-specific deletion searches, such as “delete yesterday’s lunch”
- Add recurring-event support
- Add scheduled cleanup for expired pending actions and update logs
- Support multiple authorized users with per-user spreadsheet and calendar scopes
- Add a lightweight admin dashboard for reviewing finance activity and pending actions

## Resume Highlights

- Built and deployed a secure serverless Telegram personal assistant using Next.js, TypeScript, Vercel AI SDK, Perplexity Sonar, Telegram Bot API, Google Sheets API, Google Calendar API, Zod, and Vercel.
- Engineered stateful, two-step confirmation flows for finance and calendar deletion using Telegram inline keyboards, Google Sheets-backed one-time tokens, ownership validation, expiry windows, idempotency controls, and callback acknowledgement.
- Developed an auditable finance ledger with natural-language transaction capture, categorized multi-currency records, Singapore-local timestamps, search, and soft deletion; integrated Google Calendar creation and deletion with explicit approval safeguards.
