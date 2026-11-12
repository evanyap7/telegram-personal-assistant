# EGO avatar app: design (Phases 0-2)

Date: 2026-11-12. Status: draft, awaiting approval.

## Intent

EGO today is a Telegram bot with no face and no presence outside one chat. The owner wants EGO to feel like a personal agent that lives on their phone and computer, with an avatar they recognise as EGO, in the spirit of Meta's Muse. This design covers the first three phases: make EGO reachable from more than Telegram (0), give it an avatar and an installable app (1), and let the owner talk to it and hear it answer (2).

The why: one brain with many surfaces. EGO's value is its tools (finance, workout, calendar, to-dos, email, memory, search). The avatar and app are a new way in, not a new product, so nothing about those tools may fork or regress.

## Goals

- Talk to the same EGO from an installable web app on the owner's phone (home screen) and computer (Dock or taskbar), with the same tools, memory and history as Telegram.
- A 2D expressive portrait avatar, based on the supplied front/back/left/right reference sheet, that visibly idles, listens, thinks and speaks, with a few moods.
- Voice in and voice out: hold to talk, EGO answers aloud, the avatar's mouth moves with the audio.
- Proactive messages (briefs, to-do nags, reminders) also reach the app as push notifications.
- Telegram keeps working unchanged. `npm run check` stays green.

## Non-goals

- Muse-style features (parallel "Contemplate" mode, camera and visual search, image generation, shopping, permission layer). That is Phase 3.
- Native iOS or macOS apps, menu-bar app, widgets. Phase 4, only if the web app proves too limited.
- Payments, smart home, health data, self-building tools.
- 3D or video avatars, multiple avatars, multiple users.
- Photo or file upload from the app. Image handling is keyed to Telegram file ids today.
- Always-listening wake word, and full-duplex conversation where the owner can talk over EGO mid-sentence.
- Replacing Telegram.

## Anti-goals (failures even if it technically works)

- A second copy of the tool logic that drifts from the Telegram path.
- An app endpoint that anyone on the internet can drive. EGO can spend money, edit calendars and send email.
- An avatar that looks like a different person from the reference, or flickers and jumps between states.
- Voice that feels slow enough that the avatar seems dead. Slow replies must show a thinking state immediately.
- Proactive notifications that double up or arrive on a device the owner did not enable.

## What exists (verified in the code)

- Telegram webhook [app/api/telegram/route.ts](../../../app/api/telegram/route.ts) authenticates, de-duplicates by Telegram `update_id`, handles photo and voice intake, then calls `handleEgoText` in [lib/telegram/ego-pipeline.ts](../../../lib/telegram/ego-pipeline.ts), which calls `runEgo`.
- Replies are not returned. Tools, handlers and the orchestrator call `sendTelegramMessage(chatId, ...)` directly: about 300 call sites across `lib/handlers/*`, the command and callback routers, workout code and agents. Inline keyboards (undo, confirm) are sent the same way and come back as callback queries.
- State lives in Google Sheets, so the server is stateless. Chat history is shared via `getRecentChatHistory(userId, 8)`.
- Voice notes are transcribed by Gemini ([lib/voice-transcribe.ts](../../../lib/voice-transcribe.ts)), which takes raw audio bytes and so is reusable for an app.
- Model ids already use the 5.5 Claude family and `gemini-3.6-flash` ([lib/ai/mode.ts](../../../lib/ai/mode.ts)).
- `/` is a 1,000-line public portfolio page ([app/page.tsx](../../../app/page.tsx)). It stays as it is.
- The route's `maxDuration` is 120 s. Auth is a single allowed Telegram user plus `CRON_SECRET` for crons.

## Design

### Phase 0: a surface seam, not a rewrite

Because replies are sent as side effects from about 300 places, changing every call site is the wrong move. Instead, add a per-request **output channel** behind the Telegram send helpers in [lib/telegram.ts](../../../lib/telegram.ts), using Node's `AsyncLocalStorage`.

- Telegram requests behave exactly as today (no channel set).
- An app request runs `runEgo` inside a channel whose sink captures what would have been sent: messages (with their inline-keyboard buttons), edits, keyboard removals, callback answers, documents and chat actions (typing becomes a "thinking" event). The helpers check for a channel first and divert to it.
- The sink gives each message a synthetic id so edits and button callbacks work.
- A new streaming endpoint `POST /api/ego/chat` accepts `{ text, inputMode, requestId }`, runs the existing pipeline logic for text, and streams the captured events to the client as server-sent events: `thinking`, `message`, `edit`, `buttons`, `done`, `error`.
- A second endpoint `POST /api/ego/callback` takes a button's `callback_data` and runs the existing callback router inside a channel.
- `handleEgoText` needs a surface-neutral input (text, date, optional reply context) instead of a Telegram message object. Telegram's route maps into it.
- App replies appear in the app only, not mirrored into Telegram. History is shared: app turns are logged to the same chat history so either surface has context.
- Idempotency: the client sends a `requestId`. App requests use a separate id namespace from Telegram update ids so they cannot collide.

**Auth.** Single user. The owner signs in once per device with a long random token (`EGO_APP_TOKEN`, compared with the existing `safeCompare`), which sets a signed, httpOnly, SameSite=Strict cookie valid for 30 days (HMAC with `EGO_APP_SECRET`; rotating the secret signs every device out). API routes check the cookie, require a JSON content type and an Origin match, and cap input length. Missing env vars fail closed, as the cron auth does.

### Phase 1: avatar and installable app

- Routes: `/ego` (the app) and `/ego/login`. The manifest's `start_url` is `/ego`, so the public portfolio at `/` is untouched.
- Installable: web manifest, icons cut from the avatar, a service worker for the app shell and offline "EGO is offline" state. Works on iOS (Add to Home Screen) and macOS/Chrome/Edge install.
- UI: the avatar large at the top, the conversation below, a text box and a hold-to-talk button. Tool replies render as message cards with their buttons (including undo).
- Avatar states, driven by a small pure state machine so it is testable offline: `idle`, `listening`, `thinking`, `speaking`, plus moods `neutral`, `warm`, `focused`, `concerned`. Idle includes natural blinks and a slow breathing motion. The mood follows simple signals (a failed tool is `concerned`, a completed action is `warm`).
- Avatar art: the owner's reference sheet is the source of truth. Expression and mouth variants are generated from it (see "Asset production") and composed in the browser: a base portrait with swappable eye and mouth layers, crossfaded for smoothness. If layer drift is visible, the builder falls back to full-frame expression images with crossfades.
- Push: Web Push with VAPID keys. Subscriptions are stored in Google Sheets, consistent with the stateless design. The briefing, to-do nag, calendar and rest-timer crons send to Telegram as today and also push to subscribed devices. iOS push requires the app to be installed to the home screen; the app explains this on first run.

### Phase 2: voice

- Voice in: hold-to-talk records audio in the browser, posts it to `POST /api/ego/voice`, which reuses `transcribeTelegramVoiceNote` (Gemini) and then runs the same chat path with `inputMode: "voice"`. The transcript is shown in the conversation.
- Voice out: replies are spoken. Default provider is Gemini text-to-speech, since the Gemini key already exists and no new vendor is needed (my call, to be confirmed by a latency test before committing). The server returns audio for each reply message.
- Lip sync: the avatar's mouth opens and closes from the audio's loudness (Web Audio analyser), not phonemes. It is cheap, works with any voice, and reads as natural at this art style.
- Speed: the avatar enters `thinking` immediately. The builder measures end-to-end latency with the existing `bench` scripts' approach and reports it. If the orchestrator is too slow for voice turns, a faster path for short conversational turns is a follow-up decision, not an assumption here.
- Interrupt: tapping the avatar stops speech. Talking over EGO is not supported.
- Spoken text is cleaned of Markdown, emoji and long tables, and long tool outputs are summarised for speech while the full text stays on screen.

### Asset production

The reference sheet is a front/back/left/right turnaround of one character in a navy suit and burgundy tie. The builder needs, at matching framing and lighting: neutral, warm smile, focused, concerned, eyes closed (blink), and four mouth shapes (closed, small, open, wide; "oo" is dropped because loudness alone cannot select it). Production tool: Dreamina, as the owner chose. Dreamina is not connected to this environment, so the owner generates the images from prompts and a shot list the builder provides, and drops the files in `public/avatar/`. The reference sheet is copied into the repo under `docs/avatar/` for provenance.

## Constraints

- Next.js in this repo has breaking changes. Read the relevant guide in `node_modules/next/dist/docs/` before writing any Next code, as AGENTS.md requires.
- `npm run check` (tsc, eslint, all offline suites) must pass before anything is called done or committed. No `--no-verify`.
- No secrets in the repo. New env vars: `EGO_APP_TOKEN`, `EGO_APP_SECRET`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`.
- Streaming responses on the deployment target must be verified early (the route limit is 120 s).
- Offline tests for: the channel sink and diversion, the cookie and token auth, SSE event framing, the avatar state machine, and speech-text cleaning. Telegram regression stays covered by the existing suites.

## Left to the builder

- Exact event schema and file layout.
- Whether `AsyncLocalStorage` diversion needs any call-site fixes (for example code that calls Telegram through a different path).
- Avatar rendering technique (layers versus full-frame crossfades), animation timing, and exact moods mapping.
- Audio encoding, chunking, and the TTS voice, subject to the latency check.
- Visual design of the app around the avatar. The builder should show the owner a mockup before building the full UI.

## My calls (not yet confirmed by the owner)

1. App replies stay in the app and are not mirrored to Telegram; history is shared.
2. Single-token sign-in with a 30-day cookie rather than Telegram Login.
3. The app lives at `/ego`; the public portfolio at `/` is unchanged.
4. Gemini for TTS, pending the latency test.
5. Mouth sync by loudness, not phonemes.
6. Push notifications are sent in addition to Telegram, not instead of it.
7. No photo upload in the app for now.

## Decided by the owner

- Voice is hold-to-talk (confirmed 2026-11-12). Hands-free conversation is out of scope.
- Avatar images come from Dreamina (https://dreamina.capcut.com), using the owner's reference sheet.

## Still open

- Who drives Dreamina: the owner signs in and generates from the shot list, or signs in and lets the builder drive the browser. Generation may spend Dreamina credits, so each batch needs the owner's go-ahead.
