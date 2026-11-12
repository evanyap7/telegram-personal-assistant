# EGO Avatar App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the owner talk to EGO from an installable web app on phone and computer, with a 2D expressive avatar, hold-to-talk voice in, spoken replies, and push notifications.

**Architecture:** A per-request output channel (`AsyncLocalStorage`) sits behind the Telegram send helpers, so the existing ~300 send call sites stream to the app instead of Telegram when a request comes from the app. Streaming SSE endpoints run the same EGO pipeline. The app, avatar and voice are a web app at `/ego`, installable as a PWA.

**Tech Stack:** Next.js 16 App Router (read `node_modules/next/dist/docs/` first), React 19, TypeScript, Vercel AI SDK (Gemini for speech in and out), `web-push`, Google Sheets (existing store), offline `node --experimental-strip-types` test scripts.

**Spec:** [docs/superpowers/specs/2026-11-12-ego-avatar-app-design.md](../specs/2026-11-12-ego-avatar-app-design.md)

## Global Constraints

- Telegram behaviour must not change. With no channel set, every Telegram helper must behave exactly as today.
- Read the relevant guide in `node_modules/next/dist/docs/` before writing any Next.js code (AGENTS.md). Route handlers that use Node APIs set `export const runtime = "nodejs"`.
- `npm run check` (tsc, eslint, all offline suites) must pass before any task is called done. Never `--no-verify`, never loosen config to get green.
- Work on a branch (`feat/ego-avatar-app`), not `main`. Commit steps apply only if the owner has asked for commits. Commit messages carry no `Co-Authored-By` trailer (owner's standing rule, which overrides any default attribution).
- New env vars: `EGO_APP_TOKEN` (at least 32 characters), `EGO_APP_SECRET`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`. No secrets in the repo. Missing or too-short auth env vars fail closed.
- App routes live at `/ego` and `/api/ego/*`. The public portfolio at `/` is untouched.
- Voice is hold-to-talk with tap-to-interrupt. No wake word, no talking over EGO.
- Avatar from the owner's reference sheet (navy suit, burgundy tie). Moods: `neutral`, `warm`, `focused`, `concerned`. Activities: `idle`, `listening`, `thinking`, `speaking`. Mouth shapes: `closed`, `small`, `open`, `wide` (four; the spec's "oo" shape is dropped because loudness cannot select it, and the spec is updated in Task 1).
- Dreamina generation may spend the owner's credits. Ask before each batch.
- Do not commit `.playwright-mcp/` or the Google service-account key JSON in the project root.
- Test convention: a new offline suite is a `scripts/test-app-<name>.ts` file in the style of `scripts/test-cron-auth.ts`, registered by (a) a `test:app-<name>` script in package.json using the same node flags as `test:memory`, and (b) an entry in `SUITES` in `scripts/test-all.ts`.

## Review Focus

Inputs and conditions the spec implies but the happy-path tasks would not exercise. Each has a test in the owning task.

1. A Telegram request with no channel set still calls Telegram exactly as before (Task 1).
2. A fire-and-forget send that lands after the app stream has closed must not throw or hang (Task 1).
3. A reply containing `<script>` tags or unbalanced `*`/`_` renders as plain text, never as markup (Task 5).
4. The same `requestId` submitted twice (double tap, network retry) runs the turn once (Task 3).
5. A silent or oversized recording gets a friendly error event, not a blank turn or a 500 (Task 10).

## File Structure

| Path | Responsibility |
|---|---|
| `lib/channel.ts` | `OutputChannel` interface and `AsyncLocalStorage` plumbing |
| `lib/telegram.ts` (modify) | Each send helper diverts to the current channel when one is set |
| `lib/app/auth.ts` | Session cookie signing and verification, Origin check, `requireOwner` |
| `lib/app/events.ts` | `AppEvent` union and SSE framing |
| `lib/app/turn.ts` | Synthetic ids, idempotency, runs a turn inside a channel and emits events |
| `lib/telegram/ego-pipeline.ts` (modify) | `handleEgoTurn` takes a surface-neutral input |
| `lib/app/avatar-state.ts`, `lib/app/markdown.ts` | Pure logic: avatar state machine, safe inline Markdown |
| `lib/app/avatar-layout.ts`, `public/avatar/*` | Frame paths and eye/mouth regions |
| `lib/app/push-store.ts`, `lib/app/push.ts` | Push subscriptions in Sheets; `pushOwner` |
| `lib/app/audio.ts`, `lib/app/speech-text.ts`, `lib/app/tts.ts` | WAV encoding, speech text cleaning, TTS call |
| `app/api/ego/{login,chat,callback,voice,speak,push}/route.ts` | HTTP surface, thin: validate, then delegate |
| `app/ego/**`, `components/ego/**` | UI: login, avatar, conversation, composer, install prompt, push toggle, hold-to-talk, hooks |
| `app/manifest.ts`, `public/sw.js`, `public/icons/*` | PWA |
| `scripts/test-app-*.ts` | One offline suite per area |

---

### Task 1: Output channel and Telegram diversion

**Files:**
- Create: `lib/channel.ts`, `scripts/test-app-channel.ts`
- Modify: `lib/telegram.ts` (`sendTelegramMessage`, `editTelegramMessage`, `removeTelegramInlineKeyboard`, `answerTelegramCallback`, `sendTelegramDocument`, `sendTelegramChatAction`), `package.json`, `scripts/test-all.ts`, `docs/superpowers/specs/2026-11-12-ego-avatar-app-design.md` (mouth shapes: four, not five)

**Interfaces:**
- Produces:
  ```ts
  export interface OutputChannel {
    send(text: string, markup?: InlineKeyboardMarkup): number;           // returns message id
    edit(messageId: number, text: string, markup?: InlineKeyboardMarkup): void;
    removeKeyboard(messageId: number): void;
    answerCallback(text?: string): void;
    document(filename: string, content: string, caption?: string): void;
    action(kind: "typing" | "upload_photo" | "record_voice" | "upload_document"): void;
  }
  export function runInChannel<T>(channel: OutputChannel, fn: () => Promise<T>): Promise<T>;
  export function currentChannel(): OutputChannel | undefined;
  ```

- [ ] **Step 1: Create the branch** `feat/ego-avatar-app` and read the route-handler and PWA docs named in Global Constraints.
- [ ] **Step 2: Write failing tests** in `scripts/test-app-channel.ts` (stub `globalThis.fetch` to count Telegram calls):
  - `diverts_send_inside_channel`: inside `runInChannel`, `sendTelegramMessage(1, "hi", markup)` calls `channel.send("hi", markup)` once and `fetch` zero times.
  - `each_helper_diverts`: edit, removeKeyboard, answerCallback, document and chat action each reach the matching channel method and never `fetch`.
  - `no_channel_is_unchanged` (Review Focus 1): outside any channel, `sendTelegramMessage` calls `fetch` with `sendMessage` exactly as before.
  - `async_context_survives_promise_all`: two concurrent `sendTelegramMessage` calls inside one `runInChannel` both reach that channel; a concurrent `runInChannel` with another channel does not cross-talk.
  - `send_after_stream_close_is_safe` (Review Focus 2): a channel whose methods no-op after `close()` does not throw when a send arrives late.
- [ ] **Step 3: Run** `npm run test:app-channel`. Expected: FAIL (`lib/channel` missing).
- [ ] **Step 4: Implement** `lib/channel.ts` with `AsyncLocalStorage<OutputChannel>`, then add a channel check at the top of each Telegram helper above. `sendTelegramMessage` skips chunk splitting when diverted. `setTelegramBotCommands` and the raw `callTelegram` are untouched.
- [ ] **Step 5: Run** `npm run test:app-channel` and `npm run test:ego`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(app): output channel behind the Telegram helpers`.

### Task 2: App auth

**Files:**
- Create: `lib/app/auth.ts`, `app/api/ego/login/route.ts`, `scripts/test-app-auth.ts`
- Modify: `package.json`, `scripts/test-all.ts`

**Interfaces:**
- Consumes: `safeCompare` from `lib/security.ts`.
- Produces:
  ```ts
  export const SESSION_COOKIE = "ego_session";
  export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
  export function signSession(secret: string, now: number): string;
  export function verifySession(token: string | undefined, secret: string, now: number): boolean;
  export function isSameOrigin(request: Request): boolean;      // POST needs an Origin header whose host equals the request host
  export function requireOwner(request: Request): Response | null; // null = allowed; else 401 or 403 Response
  export const MAX_INPUT_CHARS = 4000;
  ```

- [ ] **Step 1: Write failing tests**: a signed token verifies; a tampered token, a token signed with another secret, and a token older than `SESSION_TTL_MS` all fail; `isSameOrigin` rejects a missing Origin and a different host and accepts a matching one; `requireOwner` returns 401 with no cookie, 403 on a bad Origin, and null for a valid cookie plus matching Origin; with `EGO_APP_SECRET` unset, or `EGO_APP_TOKEN` shorter than 32 characters, everything fails closed; login with the wrong token returns 401 and sets no cookie; login with the right token sets `ego_session` as httpOnly, SameSite=Strict, Path=/, Max-Age 2592000 (and Secure when `NODE_ENV=production`).
- [ ] **Step 2: Run** `npm run test:app-auth`. Expected: FAIL.
- [ ] **Step 3: Implement** with HMAC-SHA256 over `"<expiresAtMs>"`, base64url, constant-time compare. `POST /api/ego/login` accepts `{ token }` JSON.
- [ ] **Step 4: Run** `npm run test:app-auth`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(app): token sign-in with signed session cookie`.

### Task 3: Neutral turn seam and app turn runner

**Files:**
- Create: `lib/app/events.ts`, `lib/app/turn.ts`, `scripts/test-app-turn.ts`
- Modify: `lib/telegram/ego-pipeline.ts`, `package.json`, `scripts/test-all.ts`

**Interfaces:**
- Consumes: `OutputChannel`, `runInChannel` (Task 1).
- Produces:
  ```ts
  // events.ts
  export type AppButton = { text: string; data: string };
  export type AppEvent =
    | { type: "thinking" }
    | { type: "transcript"; text: string }
    | { type: "message"; id: number; text: string; buttons?: AppButton[][] }
    | { type: "edit"; id: number; text: string; buttons?: AppButton[][] }
    | { type: "buttons_removed"; id: number }
    | { type: "toast"; text?: string }
    | { type: "document"; filename: string; content: string; caption?: string }
    | { type: "done"; status?: string }
    | { type: "error"; message: string };
  export function encodeSse(event: AppEvent): string;     // "data: <json>\n\n"
  // ego-pipeline.ts
  export interface EgoTurn { chatId: number; userId: number; updateId: number; text: string;
    inputMode: InputMode; date: Date; replyTo?: TelegramMessage["reply_to_message"] }
  export function handleEgoTurn(turn: EgoTurn): Promise<{ completionStatus?: string }>;
  // turn.ts
  export function appUpdateId(requestId: string): number;
  export interface AppTurnDeps { alreadyProcessed(id: number): Promise<boolean>;
    markStarted(id: number): Promise<void>; markCompleted(id: number, status: string): Promise<void>;
    markFailed(id: number, message: string): Promise<void>;
    turn(t: EgoTurn): Promise<{ completionStatus?: string }>;
    logUserMessage(text: string, inputMode: InputMode, requestId: string): Promise<void> }
  export function runAppTurn(deps: AppTurnDeps, input: { text: string; inputMode: InputMode; requestId: string },
    emit: (e: AppEvent) => void): Promise<void>;
  ```

- [ ] **Step 1: Write failing tests**:
  - `appUpdateId_is_deterministic_and_disjoint`: same requestId gives the same id; different requestIds differ; every id is a safe integer at or above `1e13` (Telegram update ids are far below).
  - `emits_thinking_then_messages_then_done`: a stub `turn` that calls `sendTelegramMessage(1, "a")` then `sendTelegramMessage(1, "b")` yields events `thinking`, `message(id n, "a")`, `message(id n+1, "b")`, `done`.
  - `edit_and_buttons_map_to_events`: edit, keyboard removal, callback answer and document become `edit`, `buttons_removed`, `toast`, `document`.
  - `duplicate_request_runs_once` (Review Focus 4): with `alreadyProcessed` true, `turn` is not called and the stream emits `done` with status `duplicate`.
  - `turn_throw_emits_error_and_marks_failed`.
  - `encodeSse_frames`: output starts with `data: ` and ends with a blank line.
- [ ] **Step 2: Run** `npm run test:app-turn`. Expected: FAIL.
- [ ] **Step 3: Refactor `handleEgoText` into `handleEgoTurn`** in `lib/telegram/ego-pipeline.ts`: the body takes `EgoTurn`; `replyTo` replaces `message.reply_to_message`; `date` replaces `message.date`. `handleEgoText` becomes a thin mapper from the Telegram message, so the webhook route is unchanged.
- [ ] **Step 4: Implement `appUpdateId`** (1e13 plus the first five bytes of SHA-256 of `requestId` as an integer) and `runAppTurn` (inside `runInChannel` with a channel that emits events and assigns incrementing message ids; chat id and user id are `Number(process.env.TELEGRAM_ALLOWED_USER_ID)`). Before writing `logUserMessage`, grep `logChatMessage` call sites to see how Telegram logs assistant replies, and mirror that for app replies so history stays shared. Note `ChatHistory` rows store the message id as text, so synthetic ids (at or above `1e13`) cannot collide with Telegram's.
- [ ] **Step 5: Run** `npm run test:app-turn` and `npm run test:ego`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(app): neutral EGO turn and app turn runner`.

### Task 4: Chat and callback endpoints

**Files:**
- Create: `app/api/ego/chat/route.ts`, `app/api/ego/callback/route.ts`, `scripts/test-app-routes.ts`
- Modify: `package.json`, `scripts/test-all.ts`

**Interfaces:**
- Consumes: `requireOwner`, `MAX_INPUT_CHARS` (Task 2); `runAppTurn`, `encodeSse`, `handleEgoTurn` (Task 3); `dispatchCallback` from `lib/telegram/callback-router.ts`.
- Produces: `POST /api/ego/chat` body `{ text: string; requestId: string }`, `POST /api/ego/callback` body `{ data: string; messageId: number; requestId: string }`. Both respond `text/event-stream` with `AppEvent` frames. `export const maxDuration = 120`.

- [ ] **Step 1: Write failing tests** by calling the exported `POST` with `Request` objects: no cookie gives 401; wrong Origin gives 403; non-JSON content type gives 415; text over `MAX_INPUT_CHARS` gives 413; empty text gives 400; missing `requestId` gives 400. (Authorised paths are covered by Task 3's runner tests.)
- [ ] **Step 2: Run** `npm run test:app-routes`. Expected: FAIL.
- [ ] **Step 3: Implement both routes**: validate, then return a `ReadableStream` response (`Content-Type: text/event-stream`, `Cache-Control: no-store`) whose controller calls `emit` for each event. The callback route runs `dispatchCallback` with `callbackId: "app"` inside the same channel (read the head of `callback-router.ts` for the exact parameter object).
- [ ] **Step 4: Run** `npm run test:app-routes`. Expected: PASS.
- [ ] **Step 5: Verify streaming early.** With `npm run dev`, sign in and `curl -N` the chat endpoint with a trivial message. Expected: the `thinking` frame arrives before the reply, not all at once at the end. Then repeat against a Vercel preview deployment (the production limit is 120 s). If frames are buffered, fix before continuing.
- [ ] **Step 6: Commit** `feat(app): streaming chat and callback endpoints`.

### Task 5: Avatar state machine and message rendering (pure logic)

**Files:**
- Create: `lib/app/avatar-state.ts`, `lib/app/markdown.ts`, `scripts/test-app-pure.ts`
- Modify: `package.json`, `scripts/test-all.ts`

**Interfaces:**
- Produces:
  ```ts
  export type Activity = "idle" | "listening" | "thinking" | "speaking";
  export type Mood = "neutral" | "warm" | "focused" | "concerned";
  export type Mouth = "closed" | "small" | "open" | "wide";
  export interface AvatarState { activity: Activity; mood: Mood; blinking: boolean; mouth: Mouth }
  export type AvatarEvent =
    | { type: "listen_start" } | { type: "listen_end" } | { type: "request_sent" }
    | { type: "turn_done"; status?: string } | { type: "turn_error" }
    | { type: "speech_start" } | { type: "speech_end" } | { type: "speech_interrupted" }
    | { type: "level"; value: number } | { type: "blink"; on: boolean } | { type: "mood_decay" };
  export const initialAvatarState: AvatarState;
  export function reduceAvatar(state: AvatarState, event: AvatarEvent): AvatarState;
  export function mouthForLevel(level: number): Mouth;   // thresholds: <0.05 closed, <0.2 small, <0.45 open, else wide
  // markdown.ts
  export type Segment = { kind: "text" | "bold" | "italic" | "code"; text: string };
  export function parseInlineMarkdown(text: string): Segment[];
  ```
  A `turn_done` whose status matches `/(_failed|_not_found|_empty)$/` sets mood `concerned`; any other done sets `warm`; `request_sent` sets `thinking` and `focused`; `speech_end` returns to `idle`; `mood_decay` returns `warm` or `concerned` to `neutral`; `level` only changes `mouth` while `speaking` (otherwise `closed`).

- [ ] **Step 1: Write failing tests** for each transition above, plus `mouthForLevel` at 0, 0.05, 0.2, 0.45 and 1; `parseInlineMarkdown("*a* _b_ `c`")` yields bold, italic, code segments; `parseInlineMarkdown("<script>alert(1)</script>")` yields one `text` segment equal to the input (Review Focus 3); unbalanced `*x` and `_` yield plain text with no throw; empty string yields `[]`.
- [ ] **Step 2: Run** `npm run test:app-pure`. Expected: FAIL.
- [ ] **Step 3: Implement** both modules. `parseInlineMarkdown` returns segments only, so rendering never needs `dangerouslySetInnerHTML`.
- [ ] **Step 4: Run** `npm run test:app-pure`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(app): avatar state machine and safe inline markdown`.

### Task 6: Avatar assets from Dreamina

**Files:**
- Create: `docs/avatar/reference-sheet.png` (copy of the owner's sheet from the conversation's image attachment), `docs/avatar/shot-list.md`, `public/avatar/*.png`, `lib/app/avatar-layout.ts`

**Interfaces:**
- Produces: `AVATAR_FRAMES: Record<"neutral" | "warm" | "focused" | "concerned" | "blink" | "mouth-closed" | "mouth-small" | "mouth-open" | "mouth-wide", string>` (public paths), and `AVATAR_REGIONS: { eyes: Rect; mouth: Rect }` where `Rect = { x: number; y: number; w: number; h: number }` as fractions of the frame.

- [ ] **Step 1: Write `docs/avatar/shot-list.md`**: nine frames, all the same framing, lighting and background as the front view of the reference, each a prompt that says "same person, same suit, change only: <expression>". Ask the owner to approve the list and the credit cost before generating.
- [ ] **Step 2: Generate in Dreamina** (the owner is signed in; the browser is the Playwright one) using the reference sheet as the reference image. After each batch, show the owner and get a go-ahead before the next.
- [ ] **Step 3: Check consistency**: the nine frames must align when stacked at the same size. If the face drifts between frames, regenerate with the neutral frame as the reference. If layer drift persists, fall back to full-frame expression images with crossfades (spec allows it); then `AVATAR_REGIONS` is unused.
- [ ] **Step 4: Save** under `public/avatar/` with the names in `AVATAR_FRAMES`, and measure `AVATAR_REGIONS` from the neutral frame.
- [ ] **Step 5: Commit** `feat(app): avatar frames and layout`.

### Task 7: App shell UI (`/ego`)

**Files:**
- Create: `app/ego/page.tsx`, `app/ego/login/page.tsx`, `components/ego/Avatar.tsx`, `components/ego/Conversation.tsx`, `components/ego/Composer.tsx`, `components/ego/useEgoChat.ts`
- Modify: none outside these (do not touch `app/page.tsx`)

**Interfaces:**
- Consumes: `AvatarState`, `reduceAvatar`, `parseInlineMarkdown` (Task 5); `AVATAR_FRAMES`, `AVATAR_REGIONS` (Task 6); `AppEvent` (Task 3).
- Produces: `useEgoChat(): { messages: ChatMessage[]; send(text: string): void; pressButton(messageId: number, data: string): void; avatar: AvatarState; dispatchAvatar(e: AvatarEvent): void; busy: boolean }`, and `<Avatar state={AvatarState} />`.

- [ ] **Step 1: Show the owner a mockup first** (the spec requires it). Use `impeccable` and `ui-ux-pro-max` for the layout: avatar large at the top, conversation below, composer fixed at the bottom, phone-first, works wide on desktop. Get approval before building the full UI.
- [ ] **Step 2: Implement** the three screens. `Avatar` stacks the base mood frame and crops the blink and mouth frames to `AVATAR_REGIONS`, crossfading with CSS transitions, and runs a randomised blink timer (every 3 to 6 seconds) plus a slow breathing transform. `useEgoChat` reads the SSE stream with `fetch` and a stream reader, builds messages from events, and dispatches avatar events (`request_sent`, `turn_done`, `turn_error`). Message cards render buttons that call `pressButton`, which posts to `/api/ego/callback`. Unauthenticated users are redirected to `/ego/login`.
- [ ] **Step 3: Verify in a real browser** (`run` skill, Playwright screenshots) at phone width (390 px) and desktop (1280 px): login, send a message, see the thinking state, then a reply, then press an undo button.
- [ ] **Step 4: Run** `npm run check`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(app): avatar chat UI at /ego`.

### Task 8: Installable PWA

**Files:**
- Create: `app/manifest.ts`, `public/sw.js`, `public/icons/icon-192.png`, `public/icons/icon-512.png`, `components/ego/InstallPrompt.tsx`, `scripts/test-app-manifest.ts`
- Modify: `next.config.ts` (headers for `/sw.js`), `app/ego/page.tsx`, `package.json`, `scripts/test-all.ts`

**Interfaces:**
- Produces: manifest with `start_url: "/ego"`, `scope: "/ego"`, `display: "standalone"`, 192 and 512 icons (cut from the neutral frame); `sw.js` caches the app shell and shows an "EGO is offline" page when a navigation fails; it never caches `/api/*`.

- [ ] **Step 1: Write failing test**: the manifest function returns `start_url` `/ego`, `display` `standalone`, and both icon sizes.
- [ ] **Step 2: Run** `npm run test:app-manifest`. Expected: FAIL.
- [ ] **Step 3: Implement** the manifest, service worker, icons and the `/sw.js` headers from the Next PWA guide. `InstallPrompt` shows the iOS "Add to Home Screen" instructions only on iOS and only when not already standalone.
- [ ] **Step 4: Run** `npm run test:app-manifest`, then `npm run build` and confirm the manifest is served at `/manifest.webmanifest`. Test install on a phone over HTTPS (Vercel preview) and on desktop Chrome.
- [ ] **Step 5: Commit** `feat(app): installable PWA`.

### Task 9: Push notifications

**Files:**
- Create: `lib/app/push-store.ts`, `lib/app/push.ts`, `app/api/ego/push/route.ts`, `components/ego/PushToggle.tsx`, `scripts/test-app-push.ts`
- Modify: `package.json` (add `web-push` and `@types/web-push`), `public/sw.js` (push and notificationclick handlers), the cron routes under `app/api/cron/` that send the briefing, calendar reminders, rest timer and to-do nags (find them with `vercel.json`), `lib/proactive.ts` if present, `scripts/test-all.ts`

**Interfaces:**
- Produces:
  ```ts
  // push-store.ts (Google Sheets, sheet "PushSubscriptions": endpoint, p256dh, auth, createdAt ISO-8601)
  export interface StoredSubscription { endpoint: string; keys: { p256dh: string; auth: string } }
  export function saveSubscription(sub: StoredSubscription): Promise<void>;
  export function removeSubscription(endpoint: string): Promise<void>;
  export function listSubscriptions(): Promise<StoredSubscription[]>;
  // push.ts
  export interface PushDeps { list(): Promise<StoredSubscription[]>; remove(endpoint: string): Promise<void>;
    send(sub: StoredSubscription, payload: string): Promise<void> }
  export function pushOwner(deps: PushDeps, title: string, body: string, url?: string): Promise<void>; // never throws
  ```

- [ ] **Step 1: Write failing tests** with fake deps: `pushOwner` sends to every subscription; a send that rejects with status 404 or 410 removes that endpoint and still sends to the rest; any other send error is swallowed (no throw); an empty subscription list is a no-op; `POST /api/ego/push` without a cookie returns 401.
- [ ] **Step 2: Run** `npm run test:app-push`. Expected: FAIL.
- [ ] **Step 3: Implement** the store, `pushOwner` (a default-wired wrapper using `web-push` with `VAPID_*` env), the subscribe/unsubscribe route, and the service worker handlers. After each existing Telegram notification in the cron and proactive call sites, add a `pushOwner(...)` call with the same message text.
- [ ] **Step 4: Run** `npm run test:app-push` and `npm run test:cron-auth`. Expected: PASS. Then with `next dev --experimental-https`, subscribe from the UI and trigger a briefing; the notification must appear and Telegram must still receive its copy.
- [ ] **Step 5: Commit** `feat(app): web push for proactive messages`.

### Task 10: Voice in (hold to talk)

**Files:**
- Create: `lib/app/audio.ts`, `app/api/ego/voice/route.ts`, `components/ego/HoldToTalk.tsx`, `scripts/test-app-audio.ts`
- Modify: `components/ego/Composer.tsx`, `components/ego/useEgoChat.ts`, `package.json`, `scripts/test-all.ts`

**Interfaces:**
- Consumes: `transcribeTelegramVoiceNote` from `lib/voice-transcribe.ts`; `runAppTurn` (Task 3).
- Produces:
  ```ts
  // audio.ts
  export function downsample(samples: Float32Array, fromRate: number, toRate: number): Float32Array;
  export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array;  // 16-bit mono PCM WAV
  export const VOICE_MAX_BYTES = 4_000_000;
  export const VOICE_MIN_SAMPLES_16K = 4_800;   // 0.3 s
  ```
  `POST /api/ego/voice` takes `multipart/form-data` with an `audio` WAV file and a `requestId`, and streams the same SSE events with a first `transcript` event.

- [ ] **Step 1: Write failing tests**: `encodeWav` output starts with `RIFF`/`WAVE`, has a 44-byte header, and `data` length equals `2 * samples.length`; `downsample(x, 48000, 16000)` has one third the length; `downsample` at an equal rate returns the same samples; the voice route returns 401 without a cookie, 413 above `VOICE_MAX_BYTES`, and an `error` event ("I couldn't hear anything") for audio under `VOICE_MIN_SAMPLES_16K` or an empty transcript (Review Focus 5).
- [ ] **Step 2: Run** `npm run test:app-audio`. Expected: FAIL.
- [ ] **Step 3: Implement** the helpers and the route. The route transcribes with `transcribeTelegramVoiceNote` (`mediaType: "audio/wav"`; check its actual signature first), emits `transcript`, then runs the turn with `inputMode: "voice"`. `HoldToTalk` records PCM with the Web Audio API on pointer down, stops on release, downsamples to 16 kHz, encodes WAV, posts it, and dispatches `listen_start` and `listen_end`. Show a permission-denied message if the microphone is blocked.
- [ ] **Step 4: Run** `npm run test:app-audio`. Expected: PASS. Then verify on a real phone and desktop: hold, speak, release, see the transcript and the reply.
- [ ] **Step 5: Commit** `feat(app): hold-to-talk voice input`.

### Task 11: Voice out and lip sync

**Files:**
- Create: `lib/app/speech-text.ts`, `lib/app/tts.ts`, `app/api/ego/speak/route.ts`, `components/ego/useSpeech.ts`, `scripts/test-app-speech.ts`
- Modify: `docs/benchmarks.md` (new section with the measured latency), `components/ego/Avatar.tsx`, `components/ego/useEgoChat.ts`, `package.json`, `scripts/test-all.ts`

**Interfaces:**
- Consumes: `encodeWav` (Task 10), `mouthForLevel` (Task 5).
- Produces:
  ```ts
  export const SPEECH_MAX_CHARS = 400;
  export function cleanSpeechText(text: string): string;  // strips Markdown and emoji; cuts at a sentence boundary under SPEECH_MAX_CHARS; text with table rows ("|") becomes "The details are on screen."
  export function synthesize(text: string): Promise<{ wav: Uint8Array }>;
  ```
  `POST /api/ego/speak` body `{ text: string }` returns `audio/wav`.

- [ ] **Step 1: Spike with a go/no-go.** Call Gemini text-to-speech with a 20-word sentence ten times and record time to first audio. Record the numbers in `docs/benchmarks.md`. If the median exceeds 2.5 s, stop and bring the owner the numbers and an alternative before building more.
- [ ] **Step 2: Write failing tests**: `cleanSpeechText("*Logged* $14 for lunch 🍜")` equals `"Logged $14 for lunch"`; a 1,000-character reply is cut at a sentence boundary at or under 400 characters; a table reply returns the on-screen line; an empty or emoji-only string returns `""`; the speak route returns 401 without a cookie and 400 when the cleaned text is empty.
- [ ] **Step 3: Run** `npm run test:app-speech`. Expected: FAIL.
- [ ] **Step 4: Implement** the helpers, the route, and `useSpeech` (plays each assistant message, queued in order, with a Web Audio `AnalyserNode` feeding `level` events at about 30 Hz). Replies from voice-mode turns are spoken automatically; typed turns are spoken only when a speaker toggle is on. Tapping the avatar stops playback and dispatches `speech_interrupted`.
- [ ] **Step 5: Run** `npm run test:app-speech`. Expected: PASS. Verify by ear and by eye on phone and desktop: the mouth moves with the audio, stops when audio stops, and a tap interrupts.
- [ ] **Step 6: Commit** `feat(app): spoken replies with lip sync`.

### Task 12: Docs, env, final verification

**Files:**
- Modify: `README.md` (app section, new env vars, install steps), `docs/benchmarks.md` (if not already updated)

- [ ] **Step 1: Document** the new env vars in the README table and the install and sign-in steps for phone and desktop. State plainly that iOS push needs the app on the home screen.
- [ ] **Step 2: Run** `npm run check`. Expected: PASS with every new suite listed in the master runner output.
- [ ] **Step 3: Regression pass on Telegram**: send a text, a voice note, a photo and press an inline button in Telegram; all behave as before.
- [ ] **Step 4: Production smoke test** on the deployed URL: sign in on phone and desktop, install both, send a typed message, a spoken message, receive a push, and confirm a button press (undo) works.
- [ ] **Step 5: Commit** `docs: avatar app setup`.
