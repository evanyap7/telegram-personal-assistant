# EGO Orchestrator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the assistant EGO ("Everything Gets Optimized") and replace the Telegram route's regex and intent-classifier routing with one tool-calling orchestrator agent that manages the existing finance agent, workout agent and handler functions, in text and by voice.

**Architecture:** A new `runEgo()` (`ToolLoopAgent`, Gemini Flash) sits behind the route's input stage (auth, dedupe, photo/voice intake, slash commands). Its tools are generated from `defaultRegistry` (one tool per registered intent, minus the finance/budget/workout intents), plus delegate tools for the finance and workout agents, `webSearch` and `processPendingImage`. Handlers keep sending their own Telegram messages; a per-run reply tracker suppresses duplicate replies. Voice notes stay transcribe-then-route, with an `InputMode` flag propagated to every agent. The old pipeline stays behind `EGO_ORCHESTRATOR=off` for rollback.

**Tech Stack:** Next.js 16 route handlers, TypeScript, Vercel AI SDK v7 (`ai`: `ToolLoopAgent`, `tool`, `isStepCount`), `@ai-sdk/google` (`gemini-3.6-flash`), zod 4.5, Node `--experimental-strip-types` test scripts (no test framework; `node:assert`).

**Spec:** `docs/superpowers/specs/2026-10-16-ego-orchestrator-design.md`

## Global Constraints

- Model is `google("gemini-3.6-flash")`, `temperature: 0`, `stopWhen: isStepCount(10)` for the orchestrator; delegate agents keep their existing `isStepCount(8)`.
- Every agent prompt ends with `SECURITY_SYSTEM_GUARDRAIL` (from `lib/security`).
- Timezone is `Asia/Singapore` (+08:00); default currency SGD.
- Rename is user-facing only. Do not change the repo name, `package.json` `name`, GitHub or Vercel URLs.
- No change to slash commands, inline-button callbacks, cron routes, Gmail and Apple Wallet webhook behavior.
- Tests run with `node --experimental-strip-types`: type-only imports MUST use `import type` (strip-types does not elide them), no enums, no constructor parameter properties. Relative and `@/` imports are resolved by `scripts/bench/ts-loader.mjs`.
- Test commands run from the repo root (`/Users/evanyap7/telegram-personal-assistant`).
- Feature flag `EGO_ORCHESTRATOR`: default on; the value `off` (any case, trimmed) restores the old pipeline unchanged.
- Commit messages are conventional (`feat(ego): ...`) and carry NO `Co-Authored-By` trailer (user preference). Only run the commit steps if the user has authorised commits for the execution session.
- `AGENTS.md`: this Next.js version has breaking changes. Before editing anything under `app/`, skim the relevant guide in `node_modules/next/dist/docs/`. The `app/` edits here are a route-handler insertion and plain text changes.

## Review Focus

Failure modes the spec implies but a first read would miss, most likely first. Each has a test in the owning task.

- **A handler throws, or returns "not handled", inside a tool:** the tool must return `ok: false` with the reason and must NOT mark the user as notified, so EGO never claims success. (Task 4)
- **The model sends malformed tool arguments** (timed calendar event with no `end`, datetime without `+08:00`, missing required field): the tool returns a readable `ok: false` error the model can retry from; the handler is never called. (Task 4)
- **The model replies with nothing, or only `NO_REPLY`, when no tool messaged the user:** the user must still get a reply, never silence. (Task 2)
- **Plain "weight x reps" messages while a workout session is active:** the direct-record shortcut fires only with an active session and a strict match, so "hello", "100" and any non-session message still go through the orchestrator. (Task 7)
- **Late-night UTC messages:** at 01:00 SGT the UTC date is still "yesterday"; the prompt's "today" must be the Singapore date. (Task 6)

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/agent/input-mode.ts` (create) | `InputMode` type and the spoken-input note shared by every agent prompt |
| `lib/agent/ego-reply.ts` (create) | Per-run reply tracker and the rule for what final text gets sent |
| `lib/agent/ego-tools.ts` (create) | Builds the orchestrator's tools from the intent registry plus delegates; exclusion list; descriptions |
| `lib/agent/ego-prompt.ts` (create) | Pure prompt and message builders for the orchestrator |
| `lib/agent/ego-orchestrator.ts` (create) | `runEgo()`: wires deps, runs the `ToolLoopAgent`, sends the final reply |
| `lib/agent/ego-flag.ts` (create) | `isEgoEnabled()` |
| `lib/telegram/ego-pipeline.ts` (create) | EGO-mode text handling for the route: workout slash, commands, set shortcut, context gathering, `runEgo` |
| `scripts/test-ego.ts` (create) | Offline unit tests for everything above |
| `scripts/ego-eval-cases.ts` (create) | Routing eval fixtures (pure data) |
| `scripts/eval-ego.ts` (create) | Routing eval runner (live model, `--dry-run` offline) |
| `lib/assistant-intent.ts` (modify) | Export schemas, add `intentSchemaByAction`, extract `buildConversationContextBlock` |
| `lib/handlers/dispatcher.ts` (modify) | `HandlerRegistry.registeredActions()` |
| `lib/agent/finance-agent.ts` (modify) | Export instruction builder, voice note, ported finance rules, budget notice |
| `lib/agent/workout-agent.ts` (modify) | Export instruction builder, voice note |
| `lib/workout/workout-session.ts` (modify) | `strictSetEntry`, `handleStrictSetShortcut` |
| `lib/voice-transcribe.ts` (modify) | Vocabulary hints for transcription |
| `app/api/telegram/route.ts` (modify) | Voice flag and EGO-mode branch |
| rename touchpoints (modify) | menu, landing page, metadata, README, prompts, wallet label |
| `package.json`, `scripts/test-all.ts` (modify) | `test:ego`, `eval:ego` scripts; register the suite |

---

### Task 1: Input mode primitives and test harness

**Files:**
- Create: `lib/agent/input-mode.ts`
- Create: `scripts/test-ego.ts`
- Modify: `package.json` (scripts)
- Modify: `scripts/test-all.ts` (SUITES)

**Interfaces:**
- Produces: `type InputMode = "text" | "voice"`; `const SPOKEN_INPUT_NOTE: string`; `spokenInputNote(mode?: InputMode): string` (returns `SPOKEN_INPUT_NOTE` for `"voice"`, `""` otherwise).
- Produces: the `scripts/test-ego.ts` harness. Later tasks add `section("name", () => {...})` blocks above the `// ---- runner ----` line and add imports at the top.

- [ ] **Step 1: Create the test harness with the first failing test**

Create `scripts/test-ego.ts`:

```ts
import assert from "node:assert/strict";
import {
  SPOKEN_INPUT_NOTE,
  spokenInputNote,
} from "../lib/agent/input-mode";

const sections: Array<{ name: string; run: () => void | Promise<void> }> = [];
function section(name: string, run: () => void | Promise<void>) {
  sections.push({ name, run });
}

// ---- sections ----

section("spoken input note applies only to voice", () => {
  assert.equal(spokenInputNote("voice"), SPOKEN_INPUT_NOTE);
  assert.equal(spokenInputNote("text"), "");
  assert.equal(spokenInputNote(undefined), "");
  assert.match(SPOKEN_INPUT_NOTE, /voice note/i);
  assert.match(SPOKEN_INPUT_NOTE, /confirm/i);
});

// ---- runner ----
async function main() {
  console.log("\n  🧠 EGO Orchestrator Tests\n");
  for (const s of sections) {
    await s.run();
    console.log(`  ✅ ${s.name}`);
  }
  console.log("\n  🎉 All EGO tests passed!\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Add the npm scripts and register the suite**

In `package.json`, in `"scripts"`, add after the `"test:todos-batch"` line:

```json
    "test:ego": "node --experimental-strip-types --import ./scripts/bench/register.mjs scripts/test-ego.ts",
    "eval:ego": "node --experimental-strip-types --import ./scripts/bench/register.mjs scripts/eval-ego.ts",
```

In `scripts/test-all.ts`, add to `SUITES` after the `"Multi-Item To-Do Batch Logging"` entry:

```ts
  { name: "EGO Orchestrator (tools, replies, voice)", command: "npm run test:ego" },
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm run test:ego`
Expected: FAIL with `Cannot find module` / `ERR_MODULE_NOT_FOUND` for `lib/agent/input-mode`.

- [ ] **Step 4: Write the minimal implementation**

Create `lib/agent/input-mode.ts`:

```ts
export type InputMode = "text" | "voice";

export const SPOKEN_INPUT_NOTE =
  'This message was spoken by the user as a voice note and transcribed automatically. Treat it as typed instructions, but expect transcription noise: misheard names, merchants, numbers and units. Turn spoken forms into values ("twelve fifty" is 12.50, "a hundred kilos for five" is 100 kg x 5, "tee bar row" is T-bar row). If a destructive or ambiguous change depends on a single word or number you are not sure you heard correctly, confirm with the user before acting.';

export function spokenInputNote(mode?: InputMode): string {
  return mode === "voice" ? SPOKEN_INPUT_NOTE : "";
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test:ego`
Expected: PASS, prints `✅ spoken input note applies only to voice` and `🎉 All EGO tests passed!`.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers lib/agent/input-mode.ts scripts/test-ego.ts package.json scripts/test-all.ts
git commit -m "feat(ego): add input-mode primitives, test harness and design docs"
```

---

### Task 2: Reply tracker and final-reply rule

**Files:**
- Create: `lib/agent/ego-reply.ts`
- Test: `scripts/test-ego.ts`

**Interfaces:**
- Produces: `const NO_REPLY = "NO_REPLY"`; `const FALLBACK_REPLY: string`; `interface ReplyTracker { markNotified(): void; readonly notified: boolean }`; `createReplyTracker(): ReplyTracker`; `resolveFinalReply(input: { text: string; notified: boolean }): string | null` (a string to send, or `null` for "send nothing").

- [ ] **Step 1: Write the failing tests**

Add to the imports at the top of `scripts/test-ego.ts`:

```ts
import {
  FALLBACK_REPLY,
  NO_REPLY,
  createReplyTracker,
  resolveFinalReply,
} from "../lib/agent/ego-reply";
```

Add above `// ---- runner ----`:

```ts
section("reply tracker starts un-notified and remembers a notification", () => {
  const tracker = createReplyTracker();
  assert.equal(tracker.notified, false);
  tracker.markNotified();
  assert.equal(tracker.notified, true);
});

section("final reply: never silent when no tool messaged the user", () => {
  assert.equal(resolveFinalReply({ text: "", notified: false }), FALLBACK_REPLY);
  assert.equal(resolveFinalReply({ text: "   ", notified: false }), FALLBACK_REPLY);
  assert.equal(resolveFinalReply({ text: NO_REPLY, notified: false }), FALLBACK_REPLY);
  assert.equal(resolveFinalReply({ text: "  hello there ", notified: false }), "hello there");
});

section("final reply: suppresses empty or NO_REPLY after tools already notified", () => {
  assert.equal(resolveFinalReply({ text: "", notified: true }), null);
  assert.equal(resolveFinalReply({ text: NO_REPLY, notified: true }), null);
  assert.equal(resolveFinalReply({ text: "NO_REPLY.", notified: true }), null);
  assert.equal(resolveFinalReply({ text: "Logged both.", notified: true }), "Logged both.");
  assert.equal(resolveFinalReply({ text: "Done. NO_REPLY", notified: true }), "Done.");
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:ego`
Expected: FAIL, `Cannot find module` for `lib/agent/ego-reply`.

- [ ] **Step 3: Implement**

Create `lib/agent/ego-reply.ts`:

```ts
/** The orchestrator replies with this when tools already told the user everything. */
export const NO_REPLY = "NO_REPLY";

export const FALLBACK_REPLY =
  "I'm not sure how to help with that. Try /help to see what I can do.";

export interface ReplyTracker {
  /** Called whenever a tool, handler or sub-agent has sent the user a message. */
  markNotified(): void;
  readonly notified: boolean;
}

export function createReplyTracker(): ReplyTracker {
  let notified = false;
  return {
    markNotified() {
      notified = true;
    },
    get notified() {
      return notified;
    },
  };
}

/**
 * Decides what the orchestrator's final text should send. Returns null when
 * nothing should be sent (tools already messaged the user and the model had
 * nothing to add). Never returns null when the user has heard nothing yet.
 */
export function resolveFinalReply(input: { text: string; notified: boolean }): string | null {
  const text = input.text.replace(/\bNO_REPLY\b\.?/g, "").trim();
  if (text === "") {
    return input.notified ? null : FALLBACK_REPLY;
  }
  return text;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm run test:ego`
Expected: PASS for all sections so far.

- [ ] **Step 5: Commit**

```bash
git add lib/agent/ego-reply.ts scripts/test-ego.ts
git commit -m "feat(ego): add reply tracker and final-reply rule"
```

---

### Task 3: Intent schema exports, shared context block, registry introspection

**Files:**
- Modify: `lib/assistant-intent.ts` (`const intentSchema` at ~line 60; `parseAssistantIntent` context block at ~lines 331-367)
- Modify: `lib/handlers/dispatcher.ts` (`HandlerRegistry` class)
- Test: `scripts/test-ego.ts`

**Interfaces:**
- Produces: `export const intentSchema` (was private); `export const intentSchemaByAction: Record<string, z.ZodType>` (action name to its schema, 30 entries including `unknown`); `export function buildConversationContextBlock(context?: ConversationContext): string` (byte-for-byte the block `parseAssistantIntent` used to build inline; `""` when there is nothing to show).
- Produces: `HandlerRegistry.registeredActions(): string[]`.

- [ ] **Step 1: Write the failing tests**

Add to the imports at the top of `scripts/test-ego.ts`:

```ts
import {
  buildConversationContextBlock,
  intentSchemaByAction,
} from "../lib/assistant-intent";
import { defaultRegistry } from "../lib/handlers/dispatcher";
```

Add above `// ---- runner ----`:

```ts
section("intentSchemaByAction maps every action to a schema that parses its own shape", () => {
  const actions = Object.keys(intentSchemaByAction);
  for (const expected of ["calendar_add", "calendar_batch_add", "finance_add", "undo", "unknown"]) {
    assert.ok(actions.includes(expected), `missing ${expected}`);
  }
  assert.ok(intentSchemaByAction.undo.safeParse({ action: "undo" }).success);
  assert.ok(
    intentSchemaByAction.calendar_add.safeParse({
      action: "calendar_add",
      calendarName: "personal",
      allDay: true,
      title: "Gym",
      date: "2026-10-17",
    }).success
  );
});

section("conversation context block is empty without context and includes what is given", () => {
  assert.equal(buildConversationContextBlock(undefined), "");
  assert.equal(buildConversationContextBlock({ recentChatHistory: [] }), "");
  const block = buildConversationContextBlock({
    repliedMessageText: "Created event Gym",
    activePendingCalendar: {
      calendarName: "personal",
      title: "Dentist",
      allDay: true,
      date: "2026-10-20",
    },
  });
  assert.match(block, /--- Conversation Context ---/);
  assert.match(block, /Replied-to message/);
  assert.match(block, /Active pending calendar confirmation/);
  assert.match(block, /Dentist/);
});

section("registry exposes its registered actions and each has a schema", () => {
  const registered = defaultRegistry.registeredActions();
  assert.ok(registered.includes("calendar_add"));
  assert.ok(registered.includes("undo"));
  for (const action of registered) {
    assert.ok(action in intentSchemaByAction, `${action} is registered but has no schema`);
  }
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:ego`
Expected: FAIL (`intentSchemaByAction` / `buildConversationContextBlock` is not exported, or `registeredActions` is not a function).

- [ ] **Step 3: Export the schema and add `intentSchemaByAction`**

In `lib/assistant-intent.ts` change `const intentSchema = z.union([` to:

```ts
export const intentSchema = z.union([
```

Immediately after the line `export type AssistantIntent = z.infer<typeof intentSchema>;` add:

```ts
type SchemaWithAction = { shape: { action: { value: string } } };

function actionOf(option: unknown): string {
  const o = option as Partial<SchemaWithAction> & { options?: SchemaWithAction[] };
  const object = o.shape ? (o as SchemaWithAction) : (o.options as SchemaWithAction[])[0];
  return object.shape.action.value;
}

/** Action name to its zod schema, derived from the union so it can never drift from it. */
export const intentSchemaByAction: Record<string, z.ZodType> = Object.fromEntries(
  intentSchema.options.map((option) => [actionOf(option), option as z.ZodType])
);
```

- [ ] **Step 4: Extract the context block**

In `lib/assistant-intent.ts`, immediately above `export async function parseAssistantIntent(`, add:

```ts
export function buildConversationContextBlock(context?: ConversationContext): string {
  if (!context) return "";
  const items: string[] = [];
  if (context.recentChatHistory && context.recentChatHistory.length > 0) {
    const historyLines = context.recentChatHistory
      .map((h) => `${h.role === "user" ? "User" : "Assistant"}: ${h.text}`)
      .join("\n");
    items.push(`Recent conversation turns:\n${historyLines}`);
  }
  if (context.repliedMessageText) {
    items.push(`Replied-to message:\n"""\n${context.repliedMessageText}\n"""`);
  }
  if (context.activePendingCalendar) {
    const p = context.activePendingCalendar;
    const loc = p.location ? `\n- Location: "${p.location}"` : "";
    const rem = p.reminderMinutes ? `\n- Reminder: ${p.reminderMinutes} minutes before` : "";
    items.push(
      `Active pending calendar confirmation:\n- Calendar: ${p.calendarName}\n- Title: "${p.title}"\n- All-day: ${p.allDay}\n- Timing: ${p.allDay ? p.date : `${p.start} to ${p.end}`}${loc}${rem}`
    );
  }
  if (context.recentCalendarEvent) {
    const r = context.recentCalendarEvent;
    const loc = r.location ? `\n- Location: "${r.location}"` : "";
    items.push(
      `Most recently created calendar event:\n- Calendar: ${r.calendarName}\n- Title: "${r.title}"\n- Timing: ${r.allDay ? r.date : `${r.start} to ${r.end}`}${loc}\n- Event ID: ${r.eventId ?? "none"}`
    );
  }
  if (context.recentTransaction) {
    const t = context.recentTransaction;
    items.push(
      `Most recently created/modified finance transaction:\n- Transaction ID: ${t.transactionId}\n- Type: ${t.type}\n- Amount: ${t.amount} ${t.currency}\n- Category: ${t.category}\n- Description: "${t.description}"\n- Timestamp: ${t.timestamp}`
    );
  }
  if (items.length === 0) return "";
  return `\n\n--- Conversation Context ---\n${items.join("\n\n")}\n-----------------------------`;
}
```

Then in `parseAssistantIntent`, replace everything from the line `let contextBlock = "";` through the closing brace of the `if (context) { ... }` block (the last line before `const systemPrompt = buildIntentSystemPrompt(`) with:

```ts
  const contextBlock = buildConversationContextBlock(context);
```

- [ ] **Step 5: Add `registeredActions` to the registry**

In `lib/handlers/dispatcher.ts`, inside `class HandlerRegistry`, add after `registerCallback(...)`:

```ts
  registeredActions(): string[] {
    return [...this.intentHandlers.keys()];
  }
```

- [ ] **Step 6: Run to verify pass**

Run: `npm run test:ego`
Expected: PASS for all sections. If importing `lib/handlers/dispatcher` fails because a handler module reads an env var at import time, stop and report it instead of working around it (the module-load side effect must be fixed in that handler).

- [ ] **Step 7: Confirm the refactor changed nothing else**

Run: `npx tsc --noEmit && npm run test:intents`
Expected: tsc exits 0 with no output; `test:intents` passes (dry-run if no API key).

- [ ] **Step 8: Commit**

```bash
git add lib/assistant-intent.ts lib/handlers/dispatcher.ts scripts/test-ego.ts
git commit -m "refactor(intent): export intent schemas, share context block, expose registry actions"
```

---

### Task 4: Orchestrator tool builder

**Files:**
- Create: `lib/agent/ego-tools.ts`
- Test: `scripts/test-ego.ts`

**Interfaces:**
- Consumes: `intentSchemaByAction`, `AssistantIntent` (Task 3).
- Produces:
  - `type WorkoutDelegateKind = "session_message" | "start" | "log" | "view"`
  - `interface EgoToolDeps { dispatchIntent(intent: AssistantIntent): Promise<{ handled: boolean; completionStatus?: string }>; askFinance(request: string): Promise<boolean>; askWorkout(input: { kind: WorkoutDelegateKind; request: string; location?: "school" | "csc" }): Promise<boolean>; search(query: string): Promise<string>; processPendingImage(instruction: string): Promise<boolean>; markNotified(): void; onToolCall?(name: string): void }`
  - `const EXCLUDED_INTENT_ACTIONS: ReadonlySet<string>`
  - `const TOOL_DESCRIPTIONS: Record<string, string>`
  - `buildEgoTools(deps: EgoToolDeps): ToolSet` containing one tool per non-excluded schema action, plus `askFinanceAgent`, `askWorkoutAgent`, `webSearch`, `processPendingImage`.
  - Every tool returns `{ ok: true, ... }` or `{ ok: false, error: string }`; tools that message the user include `userNotified: true` and call `deps.markNotified()`.

- [ ] **Step 1: Write the failing tests**

Add to the imports at the top of `scripts/test-ego.ts`:

```ts
import {
  EXCLUDED_INTENT_ACTIONS,
  TOOL_DESCRIPTIONS,
  buildEgoTools,
  type EgoToolDeps,
} from "../lib/agent/ego-tools";
import type { AssistantIntent } from "../lib/assistant-intent";
```

Add above `// ---- runner ----`:

```ts
type ToolResult = Record<string, unknown>;

function makeDeps(overrides: Partial<EgoToolDeps> = {}) {
  const calls = {
    dispatched: [] as AssistantIntent[],
    notified: 0,
    toolCalls: [] as string[],
    finance: [] as string[],
    workout: [] as Array<{ kind: string; request: string; location?: string }>,
  };
  const deps: EgoToolDeps = {
    dispatchIntent: async (intent) => {
      calls.dispatched.push(intent);
      return { handled: true, completionStatus: "stub_status" };
    },
    askFinance: async (request) => {
      calls.finance.push(request);
      return true;
    },
    askWorkout: async (input) => {
      calls.workout.push(input);
      return true;
    },
    search: async () => "Canberra is the capital of Australia.",
    processPendingImage: async () => true,
    markNotified: () => {
      calls.notified += 1;
    },
    onToolCall: (name) => calls.toolCalls.push(name),
    ...overrides,
  };
  return { deps, calls };
}

async function runTool(
  tools: ReturnType<typeof buildEgoTools>,
  name: string,
  input: Record<string, unknown>
): Promise<ToolResult> {
  const t = tools[name] as unknown as {
    execute: (i: unknown, o: unknown) => Promise<ToolResult>;
  };
  assert.ok(t, `tool ${name} should exist`);
  return t.execute(input, { toolCallId: "test", messages: [] });
}

section("every registered intent is a tool or explicitly excluded (drift check)", () => {
  const { deps } = makeDeps();
  const tools = buildEgoTools(deps);
  for (const action of defaultRegistry.registeredActions()) {
    assert.ok(
      action in tools || EXCLUDED_INTENT_ACTIONS.has(action),
      `${action} is registered in the dispatcher but has no EGO tool and is not excluded`
    );
  }
  for (const action of EXCLUDED_INTENT_ACTIONS) {
    assert.ok(!(action in tools), `${action} is excluded but still has a tool`);
  }
  for (const action of ["finance_add", "budget_set", "workout_start", "workout_log", "workout_view"]) {
    assert.ok(EXCLUDED_INTENT_ACTIONS.has(action), `${action} must go through a delegate agent`);
  }
});

section("delegate and utility tools exist and every tool has a description", () => {
  const { deps } = makeDeps();
  const tools = buildEgoTools(deps);
  for (const name of ["askFinanceAgent", "askWorkoutAgent", "webSearch", "processPendingImage"]) {
    assert.ok(name in tools, `missing ${name}`);
  }
  for (const [name, t] of Object.entries(tools)) {
    const description = (t as { description?: string }).description;
    assert.ok(description && description.length > 10, `${name} needs a description`);
  }
  for (const action of Object.keys(TOOL_DESCRIPTIONS)) {
    assert.ok(action in tools, `TOOL_DESCRIPTIONS has ${action} but there is no such tool`);
  }
});

section("registry tool validates, applies defaults, dispatches and marks notified", async () => {
  const { deps, calls } = makeDeps();
  const tools = buildEgoTools(deps);
  const result = await runTool(tools, "todo_add", { task: "buy milk" });
  assert.equal(result.ok, true);
  assert.equal(result.userNotified, true);
  assert.equal(calls.dispatched.length, 1);
  const dispatched = calls.dispatched[0] as Extract<AssistantIntent, { action: "todo_add" }>;
  assert.equal(dispatched.action, "todo_add");
  assert.equal(dispatched.task, "buy milk");
  assert.equal(dispatched.priority, "medium");
  assert.equal(calls.notified, 1);
  assert.deepEqual(calls.toolCalls, ["todo_add"]);
});

section("tool failure honesty: handler throw or not-handled returns ok:false and does not notify", async () => {
  const throwing = makeDeps({
    dispatchIntent: async () => {
      throw new Error("sheets is down");
    },
  });
  const r1 = await runTool(buildEgoTools(throwing.deps), "todo_view", { timeframe: "today" });
  assert.equal(r1.ok, false);
  assert.match(String(r1.error), /sheets is down/);
  assert.equal(throwing.calls.notified, 0);

  const unhandled = makeDeps({ dispatchIntent: async () => ({ handled: false }) });
  const r2 = await runTool(buildEgoTools(unhandled.deps), "todo_view", { timeframe: "today" });
  assert.equal(r2.ok, false);
  assert.equal(unhandled.calls.notified, 0);
});

section("malformed model arguments return a readable error and never reach the handler", async () => {
  const { deps, calls } = makeDeps();
  const tools = buildEgoTools(deps);

  const missingRequired = await runTool(tools, "todo_complete", {});
  assert.equal(missingRequired.ok, false);
  assert.match(String(missingRequired.error), /query/);

  const timedNoEnd = await runTool(tools, "calendar_add", {
    calendarName: "personal",
    allDay: false,
    title: "Dentist",
    start: "2026-10-17T15:00:00+08:00",
  });
  assert.equal(timedNoEnd.ok, false);
  assert.match(String(timedNoEnd.error), /end/);

  const badOffset = await runTool(tools, "calendar_add", {
    calendarName: "personal",
    allDay: false,
    title: "Dentist",
    start: "2026-10-17T15:00:00Z",
    end: "2026-10-17T16:00:00Z",
  });
  assert.equal(badOffset.ok, false);

  assert.equal(calls.dispatched.length, 0);
  assert.equal(calls.notified, 0);
});

section("calendar tools accept the flat model-friendly shapes", async () => {
  const { deps, calls } = makeDeps();
  const tools = buildEgoTools(deps);

  const allDay = await runTool(tools, "calendar_add", {
    calendarName: "personal",
    allDay: true,
    title: "Gym",
    date: "2026-10-17",
  });
  assert.equal(allDay.ok, true);

  const timed = await runTool(tools, "calendar_add", {
    calendarName: "work",
    allDay: false,
    title: "Standup",
    start: "2026-10-17T09:00:00+08:00",
    end: "2026-10-17T09:30:00+08:00",
  });
  assert.equal(timed.ok, true);

  const batch = await runTool(tools, "calendar_batch_add", {
    calendarName: "personal",
    events: [
      { allDay: true, title: "Trip", date: "2026-10-20" },
      {
        allDay: false,
        title: "Dinner",
        start: "2026-10-21T19:00:00+08:00",
        end: "2026-10-21T20:00:00+08:00",
      },
    ],
  });
  assert.equal(batch.ok, true);
  assert.deepEqual(
    calls.dispatched.map((i) => i.action),
    ["calendar_add", "calendar_add", "calendar_batch_add"]
  );
});

section("delegate tools: finance and workout report handled / not handled correctly", async () => {
  const { deps, calls } = makeDeps();
  const tools = buildEgoTools(deps);

  const fin = await runTool(tools, "askFinanceAgent", { request: "log $6 lunch" });
  assert.equal(fin.ok, true);
  assert.deepEqual(calls.finance, ["log $6 lunch"]);
  assert.equal(calls.notified, 1);

  const wo = await runTool(tools, "askWorkoutAgent", {
    kind: "start",
    request: "going to the gym",
    location: "school",
  });
  assert.equal(wo.ok, true);
  assert.deepEqual(calls.workout[0], { kind: "start", request: "going to the gym", location: "school" });
  assert.equal(calls.notified, 2);

  const declined = makeDeps({ askFinance: async () => false });
  const notFinance = await runTool(buildEgoTools(declined.deps), "askFinanceAgent", {
    request: "what's the weather",
  });
  assert.equal(notFinance.ok, false);
  assert.equal(declined.calls.notified, 0);
});

section("webSearch returns the answer without notifying; pending image notifies only when handled", async () => {
  const { deps, calls } = makeDeps();
  const tools = buildEgoTools(deps);
  const search = await runTool(tools, "webSearch", { query: "capital of Australia" });
  assert.equal(search.ok, true);
  assert.match(String(search.answer), /Canberra/);
  assert.equal(calls.notified, 0);

  const img = await runTool(tools, "processPendingImage", { instruction: "log this receipt" });
  assert.equal(img.ok, true);
  assert.equal(calls.notified, 1);

  const none = makeDeps({ processPendingImage: async () => false });
  const noImg = await runTool(buildEgoTools(none.deps), "processPendingImage", {
    instruction: "log this",
  });
  assert.equal(noImg.ok, false);
  assert.equal(none.calls.notified, 0);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:ego`
Expected: FAIL, `Cannot find module` for `lib/agent/ego-tools`.

- [ ] **Step 3: Implement the tool builder**

Create `lib/agent/ego-tools.ts`:

```ts
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { intentSchemaByAction, type AssistantIntent } from "@/lib/assistant-intent";

export type WorkoutDelegateKind = "session_message" | "start" | "log" | "view";

export interface EgoToolDeps {
  /** Runs a validated intent through the handler registry. */
  dispatchIntent(
    intent: AssistantIntent
  ): Promise<{ handled: boolean; completionStatus?: string }>;
  /** True when the finance agent handled the request and replied to the user. */
  askFinance(request: string): Promise<boolean>;
  /** True when the workout flow handled the request and replied to the user. */
  askWorkout(input: {
    kind: WorkoutDelegateKind;
    request: string;
    location?: "school" | "csc";
  }): Promise<boolean>;
  /** Returns the answer text; the orchestrator writes the reply itself. */
  search(query: string): Promise<string>;
  /** True when a waiting or replied-to photo was processed. */
  processPendingImage(instruction: string): Promise<boolean>;
  /** Called whenever a tool caused the user to be messaged. */
  markNotified(): void;
  /** Called with a tool's name each time it runs (completion status, routing eval). */
  onToolCall?(name: string): void;
}

/**
 * Registered intents that are deliberately NOT direct tools: money and workout
 * requests go through the delegate agents, and `unknown` is a classifier output.
 * A test fails if a registered intent is neither a tool nor listed here.
 */
export const EXCLUDED_INTENT_ACTIONS: ReadonlySet<string> = new Set([
  "finance_add",
  "finance_summary",
  "finance_query",
  "finance_delete_search",
  "finance_modify",
  "budget_set",
  "workout_start",
  "workout_log",
  "workout_view",
  "unknown",
]);

export const TOOL_DESCRIPTIONS: Record<string, string> = {
  calendar_add:
    "Draft ONE calendar event; the user confirms it with buttons. Use allDay true with date when the user gave a date but no time; allDay false with start and end otherwise. Also use it to adjust a pending draft (resend with the changed fields).",
  calendar_batch_add:
    "Draft several calendar events at once (up to 30) in one calendar; the user confirms with buttons.",
  calendar_view:
    "Show the user's calendar agenda for today, tomorrow, this week or upcoming, for personal, work or all calendars.",
  calendar_delete_search:
    "Find a calendar event by a short title keyword so the user can confirm deleting it. Never deletes directly.",
  calendar_reschedule:
    "Change the date and/or time of an EXISTING calendar event found by a short title keyword (move, postpone, push, shift).",
  calendar_free_slots:
    "List the free gaps between events on a given day. Use for 'when am I free'. Do not use it to list events.",
  calendar_move:
    "Move an already-created calendar event between the personal and work calendars. Never use it on a pending draft.",
  calendar_rename:
    "Change only the title of an already-created calendar event. Never use it on a pending draft.",
  todo_add:
    "Add one task (task) or several (tasks). For 'remind me to ...' set remindIntervalMinutes to 30 unless the user named another interval.",
  todo_view: "Show the to-do list: timeframe today or all.",
  todo_complete: "Mark a to-do done, found by a task description or keyword.",
  todo_delete_search:
    "Find a to-do by description so the user can confirm removing it. Never deletes directly.",
  email_draft:
    "Prepare a Gmail draft with a recipient, subject and full body (greeting and sign-off); the user confirms sending with a button.",
  split_bill:
    "Split a bill among people, optionally with tip and tax percentages, and record who owes whom.",
  iou_summary: "Show who owes the user money and who the user owes, optionally for one person.",
  memory_save:
    "Save a note, fact, contact, preference or credential the user wants remembered, as a key and a value.",
  memory_recall: "Look up something the user previously asked to remember.",
  recurring_add:
    "Create a recurring subscription (with amount) or recurring task that repeats daily, weekly, monthly or yearly.",
  recurring_view: "Show the user's recurring subscriptions and tasks.",
  undo: "Undo the user's most recent undoable action (a logged expense, edit, delete and similar).",
};

const flatEventFields = {
  allDay: z.boolean().describe("true when the user gave a date but no time"),
  title: z.string().min(1).max(100),
  start: z
    .string()
    .optional()
    .describe("YYYY-MM-DDTHH:mm:ss+08:00; required when allDay is false"),
  end: z
    .string()
    .optional()
    .describe("YYYY-MM-DDTHH:mm:ss+08:00, after start; required when allDay is false"),
  date: z.string().optional().describe("YYYY-MM-DD; required when allDay is true"),
  location: z.string().max(200).optional(),
  reminderMinutes: z.number().int().positive().optional(),
};

/**
 * The calendar schemas contain unions, which model tool-calling handles poorly.
 * The model fills these flat shapes; the strict schema still validates in execute.
 */
const FLAT_INPUT_SCHEMAS: Record<string, z.ZodType> = {
  calendar_add: z.object({
    calendarName: z.enum(["personal", "work"]),
    ...flatEventFields,
  }),
  calendar_batch_add: z.object({
    calendarName: z.enum(["personal", "work"]),
    events: z.array(z.object(flatEventFields)).min(1).max(30),
  }),
};

function inputSchemaFor(action: string): z.ZodType {
  const flat = FLAT_INPUT_SCHEMAS[action];
  if (flat) return flat;
  const schema = intentSchemaByAction[action];
  if (!(schema instanceof z.ZodObject)) {
    throw new Error(`No tool input schema available for intent "${action}".`);
  }
  return (schema as z.ZodObject<Record<string, z.ZodType>>).omit({ action: true });
}

function describeIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`)
    .join("; ");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function buildEgoTools(deps: EgoToolDeps): ToolSet {
  const tools: ToolSet = {};

  for (const action of Object.keys(intentSchemaByAction)) {
    if (EXCLUDED_INTENT_ACTIONS.has(action)) continue;
    const description = TOOL_DESCRIPTIONS[action];
    if (!description) {
      throw new Error(`Intent "${action}" has no EGO tool description. Add one or exclude it.`);
    }

    tools[action] = tool({
      description,
      inputSchema: inputSchemaFor(action),
      execute: async (input) => {
        deps.onToolCall?.(action);
        const parsed = intentSchemaByAction[action].safeParse({
          action,
          ...(input as Record<string, unknown>),
        });
        if (!parsed.success) {
          return { ok: false, error: `Invalid arguments: ${describeIssues(parsed.error)}` };
        }
        try {
          const result = await deps.dispatchIntent(parsed.data as AssistantIntent);
          if (!result.handled) {
            return { ok: false, error: `No handler is registered for ${action}.` };
          }
          deps.markNotified();
          return { ok: true, userNotified: true, status: result.completionStatus ?? "done" };
        } catch (error) {
          return { ok: false, error: errorMessage(error) };
        }
      },
    });
  }

  tools.askFinanceAgent = tool({
    description:
      "Hand a money request to the finance agent: log income or an expense, edit or delete a transaction, spending summaries and questions ('how much on Grab'), budgets and category caps. It replies to the user itself. Also use it when the user swipe-replies to a transaction card.",
    inputSchema: z.object({
      request: z
        .string()
        .min(1)
        .describe("The user's finance request, restated so it makes sense on its own"),
    }),
    execute: async ({ request }) => {
      deps.onToolCall?.("askFinanceAgent");
      try {
        const handled = await deps.askFinance(request);
        if (!handled) {
          return { ok: false, error: "The finance agent said this is not a finance request." };
        }
        deps.markNotified();
        return { ok: true, userNotified: true };
      } catch (error) {
        return { ok: false, error: errorMessage(error) };
      }
    },
  });

  tools.askWorkoutAgent = tool({
    description:
      'Hand a workout request to the workout flow. kind "session_message": anything about the ACTIVE guided workout (log, fix, skip, reorder, end, switch day). kind "start": the user is heading to the gym / wants to start a workout. kind "log": raw sets or exercise notes outside a guided session. kind "view": workout stats and progress. It replies to the user itself.',
    inputSchema: z.object({
      kind: z.enum(["session_message", "start", "log", "view"]),
      request: z.string().min(1).describe("The user's words, restated if needed"),
      location: z.enum(["school", "csc"]).optional().describe("Gym location if the user named one"),
    }),
    execute: async ({ kind, request, location }) => {
      deps.onToolCall?.("askWorkoutAgent");
      try {
        const handled = await deps.askWorkout({ kind, request, location });
        if (!handled) {
          return { ok: false, error: "The workout flow did not handle this request." };
        }
        deps.markNotified();
        return { ok: true, userNotified: true };
      } catch (error) {
        return { ok: false, error: errorMessage(error) };
      }
    },
  });

  tools.webSearch = tool({
    description:
      "Look up general knowledge, news, places, opening hours or anything needing the web. Returns an answer; write the reply to the user from it.",
    inputSchema: z.object({ query: z.string().min(1) }),
    execute: async ({ query }) => {
      deps.onToolCall?.("webSearch");
      try {
        return { ok: true, answer: await deps.search(query) };
      } catch (error) {
        return { ok: false, error: errorMessage(error) };
      }
    },
  });

  tools.processPendingImage = tool({
    description:
      "Process the photo(s) the user sent earlier (or is replying to) according to their instruction, e.g. log a receipt or add dates to the calendar. Use only when the context says a photo is waiting or being replied to.",
    inputSchema: z.object({
      instruction: z.string().min(1).describe("What the user wants done with the image"),
    }),
    execute: async ({ instruction }) => {
      deps.onToolCall?.("processPendingImage");
      try {
        const handled = await deps.processPendingImage(instruction);
        if (!handled) return { ok: false, error: "There is no photo waiting to be processed." };
        deps.markNotified();
        return { ok: true, userNotified: true };
      } catch (error) {
        return { ok: false, error: errorMessage(error) };
      }
    },
  });

  return tools;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm run test:ego`
Expected: PASS for all sections.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: exit 0. If TypeScript complains about the `execute` input type of a tool created with a `z.ZodType` input schema, keep the runtime code and cast the argument inside `execute` (`(input as Record<string, unknown>)` is already used); if it complains about `.omit` on `ZodObject`, adjust only the cast in `inputSchemaFor`.

- [ ] **Step 6: Commit**

```bash
git add lib/agent/ego-tools.ts scripts/test-ego.ts
git commit -m "feat(ego): build orchestrator tools from the handler registry plus delegates"
```

---

### Task 5: Voice and parity in the finance and workout agents

**Files:**
- Modify: `lib/agent/finance-agent.ts` (`buildInstructions` ~lines 38-68; `runFinanceAgent` params ~line 74; `addTransaction` tool ~lines 178-198; `new ToolLoopAgent` ~line 241)
- Modify: `lib/agent/workout-agent.ts` (`buildInstructions` ~line 104; `runWorkoutAgent` ~line 126; `new ToolLoopAgent` ~line 411)
- Test: `scripts/test-ego.ts`

**Interfaces:**
- Consumes: `InputMode`, `spokenInputNote` (Task 1).
- Produces: `buildFinanceInstructions(input: { today: string; targetTransaction: FinanceTransaction | null; repliedToText?: string; inputMode?: InputMode }): string`; `buildWorkoutInstructions(plan: PH3DayPlan, state: WorkoutSessionState, inputMode?: InputMode): string`; `runFinanceAgent` and `runWorkoutAgent` accept an optional `inputMode?: InputMode` param.
- The finance agent absorbs the finance rules the old classifier carried (SGD, categories, no invented descriptions, date discipline, budget phrasing), because `finance_add` and `budget_set` no longer reach a handler directly.

- [ ] **Step 1: Write the failing tests**

Add to the imports at the top of `scripts/test-ego.ts`:

```ts
import { buildFinanceInstructions } from "../lib/agent/finance-agent";
import { buildWorkoutInstructions } from "../lib/agent/workout-agent";
```

Add above `// ---- runner ----`:

```ts
section("finance agent instructions: voice note only for voice, plus ported finance rules", () => {
  const base = { today: "2026-10-16", targetTransaction: null };
  const voice = buildFinanceInstructions({ ...base, inputMode: "voice" });
  const text = buildFinanceInstructions({ ...base, inputMode: "text" });
  const unset = buildFinanceInstructions(base);
  assert.ok(voice.includes(SPOKEN_INPUT_NOTE));
  assert.ok(!text.includes(SPOKEN_INPUT_NOTE));
  assert.ok(!unset.includes(SPOKEN_INPUT_NOTE));
  assert.match(text, /inside EGO/);
  assert.match(text, /treat "\$" as SGD/i);
  assert.match(text, /NEVER invent/);
  assert.match(text, /budgetNotice/);
  assert.match(text, /NOT_FINANCE/);
});

section("workout agent instructions: voice note only for voice", () => {
  const plan = {
    day: 1,
    week: 1,
    blockTab: "Accumulation Block",
    dayTitle: "Day 1 Upper",
    isRestDay: false,
    exercises: [
      {
        exercise: "Bench",
        sets: [1, 2].map((n) => ({
          setNumber: n,
          weight: "",
          reps: "",
          weightCell: `A${n}`,
          repsCell: `B${n}`,
        })),
      },
    ],
  };
  const state = {
    day: 1,
    week: 1,
    dayTitle: "Day 1 Upper",
    exIdx: 0,
    setIdx: 0,
    logged: [],
    startedAt: "2026-10-16T12:00:00+08:00",
  };
  const voice = buildWorkoutInstructions(plan, state, "voice");
  const text = buildWorkoutInstructions(plan, state, "text");
  assert.ok(voice.includes(SPOKEN_INPUT_NOTE));
  assert.ok(!text.includes(SPOKEN_INPUT_NOTE));
  assert.match(text, /inside EGO/);
  assert.match(text, /NOT_WORKOUT/);
});
```

(`SPOKEN_INPUT_NOTE` is already imported at the top from Task 1.)

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:ego`
Expected: FAIL (`buildFinanceInstructions` / `buildWorkoutInstructions` is not exported).

- [ ] **Step 3: Update the finance agent instructions**

In `lib/agent/finance-agent.ts` add to the imports:

```ts
import { spokenInputNote, type InputMode } from "@/lib/agent/input-mode";
```

Replace the whole `function buildInstructions(...) { ... }` (from `function buildInstructions(input: {` through its closing `}` before `export type FinanceAgentResult`) with:

```ts
export function buildFinanceInstructions(input: {
  today: string;
  targetTransaction: FinanceTransaction | null;
  repliedToText?: string;
  inputMode?: InputMode;
}): string {
  const focus = input.targetTransaction
    ? `The transaction the user most likely means by "this", "that" or "the last one" (they swipe-replied to it, or it is the most recent):\n${JSON.stringify(
        compactTransaction(input.targetTransaction)
      )}`
    : "There is no obvious 'current' transaction.";
  const spoken = spokenInputNote(input.inputMode);

  return `You are the finance agent inside EGO, a personal Telegram assistant. The user tracks money in a Google Sheet. You log, fix and answer questions by calling tools.

Today is ${input.today} (Singapore time). Default currency is SGD.

${focus}
${input.repliedToText ? `The user is replying to this message: "${input.repliedToText}"` : ""}
${spoken ? `\n${spoken}\n` : ""}
How to work:
- Never guess a transactionId. Take it from the focus transaction above or from searchTransactions.
- To edit or delete something, find it first. If several transactions plausibly match and the user's words don't settle it, ask which one instead of picking.
- If the user says "that" or "the last one", use the focus transaction.
- Make the change with the tool, then reply briefly with what changed (old -> new). Edits and deletes are undoable, so act without asking when the target is clear.
- For anything that touches many transactions at once (e.g. "delete all my food expenses"), list what you'd affect and ask for confirmation before deleting.
- If a description carries a source tag like "(DBS PayLah)" or "(Apple Pay)", or an " @ merchant" suffix, keep it when renaming.
- Only report what tools returned. If a tool fails, say so plainly.
- If the request has nothing to do with money, transactions or the budget, reply with exactly: ${NOT_FINANCE}
- Reply in plain text, short, no Markdown tables. Amounts as $12.50.

Logging rules:
- Treat "$" as SGD unless another currency is named. Use uppercase three-letter currency codes.
- Use a sensible category: Dining, Transport, Groceries, Shopping, Entertainment, Health, Education, Utilities, Salary, or Other.
- Only pass a date to addTransaction or updateTransaction when the user's current message names a specific date or relative day ("yesterday", "last Friday", "on 3 Sep"). Otherwise omit it.
- If the amount is missing, ask for it instead of guessing.
- NEVER invent dishes, items, drinks, products or merchants. If the input is generic ("spent $10", "paid $15"), the description is "Expense" (or "Income") and the category is "Other". Only use a specific description when the user said it ("spent $5 on iced latte" is "iced latte", Dining).
- If addTransaction returns a budgetNotice, add it on its own line after your confirmation.
- A user who replies to a transaction with what it was ("supper", "it was lunch", "make it $12", "it was $12 not $6", "change category to Dining") wants that transaction edited, not a new one logged.

Budget rules:
- "set my budget to $600" or "my budget is $450 a month": setBudget with that amount and no category.
- "increase my budget to $700 instead", "lower the budget to 400": setBudget with the NEW total, not the difference.
- "cap dining at $150", "limit shopping to $100 a month": setBudget with the amount and the category.
- Asking to view the budget is getBudgetStatus, not setBudget.

${SECURITY_SYSTEM_GUARDRAIL}`;
}
```

- [ ] **Step 4: Thread `inputMode` through `runFinanceAgent` and surface the budget notice**

In `runFinanceAgent`'s params type add `inputMode?: InputMode;` after `history: FormattedChatTurn[];`.

Change the `instructions:` line in `new ToolLoopAgent({...})` from `instructions: buildInstructions({` to `instructions: buildFinanceInstructions({` and add `inputMode: params.inputMode,` inside that object after `repliedToText: params.repliedToText,`.

In the `addTransaction` tool's `execute`, change the return line to:

```ts
        return {
          ok: true,
          transactionId: added.transactionId,
          date: added.timestamp,
          budgetNotice: added.budgetStatus?.formattedNotice ?? null,
        };
```

- [ ] **Step 5: Update the workout agent**

In `lib/agent/workout-agent.ts` add to the imports:

```ts
import { spokenInputNote, type InputMode } from "@/lib/agent/input-mode";
```

Replace the signature and first line of the builder:

```ts
export function buildWorkoutInstructions(
  plan: PH3DayPlan,
  state: WorkoutSessionState,
  inputMode?: InputMode
): string {
  const spoken = spokenInputNote(inputMode);
  return `You are the workout agent inside EGO, a personal Telegram assistant. The user is in the middle of a guided lifting session following a fixed program (PH3). You keep the session log correct by calling tools, and you understand natural language about it: logging, fixing, deleting, skipping, reordering.
```

Replace the standalone `How to work:` line in that template with:

```
${spoken ? `${spoken}\n\n` : ""}How to work:
```

In `runWorkoutAgent`'s params type add `inputMode?: InputMode;` after `text: string;`, change `const { chatId, text } = params;` to `const { chatId, text, inputMode } = params;`, and change `instructions: buildInstructions(plan, state),` to `instructions: buildWorkoutInstructions(plan, state, inputMode),`.

- [ ] **Step 6: Run to verify pass, then type-check**

Run: `npm run test:ego && npx tsc --noEmit`
Expected: all sections PASS; tsc exits 0.

- [ ] **Step 7: Regression check on the existing workout tests**

Run: `npm run test:workout-session`
Expected: PASS (unchanged behavior).

- [ ] **Step 8: Commit**

```bash
git add lib/agent/finance-agent.ts lib/agent/workout-agent.ts scripts/test-ego.ts
git commit -m "feat(ego): voice note and ported finance rules in the finance and workout agents"
```

---

### Task 6: Orchestrator prompt and message builders

**Files:**
- Create: `lib/agent/ego-prompt.ts`
- Test: `scripts/test-ego.ts`

**Interfaces:**
- Consumes: `buildConversationContextBlock`, `ConversationContext` (Task 3); `spokenInputNote`, `InputMode` (Task 1); `NO_REPLY` (Task 2); `SECURITY_SYSTEM_GUARDRAIL` (`@/lib/security`); `FormattedChatTurn` (`@/lib/chat-history`).
- Produces: `describeWorkoutContext(state: { day: number; logged: unknown[] } | null): string`; `dropCurrentTurn(history: FormattedChatTurn[], text: string): FormattedChatTurn[]`; `toConversationMessages(history: FormattedChatTurn[], text: string): Array<{ role: "user" | "assistant"; content: string }>`; `interface EgoPromptInput { now: Date; inputMode: InputMode; context: ConversationContext; workoutLine: string; hasPendingImage: boolean; repliedToPhoto: boolean }`; `buildEgoInstructions(input: EgoPromptInput): string`.

- [ ] **Step 1: Write the failing tests**

Add to the imports at the top of `scripts/test-ego.ts`:

```ts
import {
  buildEgoInstructions,
  describeWorkoutContext,
  dropCurrentTurn,
  toConversationMessages,
} from "../lib/agent/ego-prompt";
import { SECURITY_SYSTEM_GUARDRAIL } from "../lib/security";
```

Add above `// ---- runner ----`:

```ts
const promptBase = {
  now: new Date("2026-10-16T04:00:00Z"),
  inputMode: "text" as const,
  context: {},
  workoutLine: describeWorkoutContext(null),
  hasPendingImage: false,
  repliedToPhoto: false,
};

section("ego prompt: identity, routing rules, reply protocol and guardrail", () => {
  const p = buildEgoInstructions(promptBase);
  assert.match(p, /EGO/);
  assert.match(p, /Everything Gets Optimized/);
  for (const name of ["askFinanceAgent", "askWorkoutAgent", "webSearch", "calendar_add", "todo_add"]) {
    assert.ok(p.includes(name), `prompt should mention ${name}`);
  }
  assert.ok(p.includes(NO_REPLY));
  assert.ok(p.includes(SECURITY_SYSTEM_GUARDRAIL));
  assert.match(p, /2026-10-16/);
  assert.match(p, /\+08:00/);
});

section("ego prompt: voice note only for voice, and it asks to confirm uncertain destructive changes", () => {
  const voice = buildEgoInstructions({ ...promptBase, inputMode: "voice" });
  const text = buildEgoInstructions(promptBase);
  assert.ok(voice.includes(SPOKEN_INPUT_NOTE));
  assert.ok(!text.includes(SPOKEN_INPUT_NOTE));
  assert.match(voice, /confirm/i);
});

section("ego prompt: 'today' is the Singapore date even when UTC is still the previous day", () => {
  // 17:00 UTC on the 16th is 01:00 SGT on the 17th.
  const p = buildEgoInstructions({ ...promptBase, now: new Date("2026-10-16T17:00:00Z") });
  assert.match(p, /Current date in Singapore: 2026-10-17/);
  assert.ok(!/Current date in Singapore: 2026-10-16/.test(p));
});

section("ego prompt: includes pending-calendar context, excludes chat history, adds image and workout lines", () => {
  const p = buildEgoInstructions({
    ...promptBase,
    context: {
      recentChatHistory: [{ role: "user", text: "SECRET-HISTORY-LINE" }],
      activePendingCalendar: { calendarName: "personal", title: "Dentist", allDay: true, date: "2026-10-20" },
    },
    workoutLine: describeWorkoutContext({ day: 4, logged: [{}, {}] }),
    hasPendingImage: true,
    repliedToPhoto: false,
  });
  assert.match(p, /Active pending calendar confirmation/);
  assert.match(p, /Dentist/);
  assert.ok(!p.includes("SECRET-HISTORY-LINE"), "history goes in messages, not the prompt");
  assert.match(p, /program day 4, 2 sets logged/);
  assert.match(p, /processPendingImage/);
});

section("workout context line", () => {
  assert.match(describeWorkoutContext(null), /no active workout/i);
  assert.match(describeWorkoutContext({ day: 2, logged: [{}] }), /1 set logged/);
  assert.match(describeWorkoutContext({ day: 2, logged: [] }), /0 sets logged/);
});

section("conversation messages drop the duplicated current turn and end with the user text", () => {
  const history = [
    { role: "assistant" as const, text: "Hi", timestamp: "t1" },
    { role: "user" as const, text: "spent $5", timestamp: "t2" },
  ];
  assert.deepEqual(dropCurrentTurn(history, "spent $5"), [history[0]]);
  assert.deepEqual(dropCurrentTurn(history, "something else"), history);
  assert.deepEqual(dropCurrentTurn([], "x"), []);
  assert.deepEqual(toConversationMessages(history, "spent $5"), [
    { role: "assistant", content: "Hi" },
    { role: "user", content: "spent $5" },
  ]);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:ego`
Expected: FAIL, `Cannot find module` for `lib/agent/ego-prompt`.

- [ ] **Step 3: Implement the prompt module**

Create `lib/agent/ego-prompt.ts`:

```ts
import {
  buildConversationContextBlock,
  type ConversationContext,
} from "@/lib/assistant-intent";
import type { FormattedChatTurn } from "@/lib/chat-history";
import { SECURITY_SYSTEM_GUARDRAIL } from "@/lib/security";
import { spokenInputNote, type InputMode } from "@/lib/agent/input-mode";
import { NO_REPLY } from "@/lib/agent/ego-reply";

export function describeWorkoutContext(
  state: { day: number; logged: unknown[] } | null
): string {
  if (!state) return "There is no active workout session.";
  const sets = state.logged.length;
  return `A guided workout session is active (program day ${state.day}, ${sets} set${
    sets === 1 ? "" : "s"
  } logged so far). Messages about this workout (logging, fixing, skipping, ending, switching day) go to askWorkoutAgent with kind "session_message".`;
}

/** The incoming message is logged to chat history before routing, so it is often the last turn. */
export function dropCurrentTurn(history: FormattedChatTurn[], text: string): FormattedChatTurn[] {
  const last = history[history.length - 1];
  return last?.role === "user" && last.text === text ? history.slice(0, -1) : history;
}

export function toConversationMessages(
  history: FormattedChatTurn[],
  text: string
): Array<{ role: "user" | "assistant"; content: string }> {
  return [
    ...dropCurrentTurn(history, text).map((turn) => ({ role: turn.role, content: turn.text })),
    { role: "user" as const, content: text },
  ];
}

export interface EgoPromptInput {
  now: Date;
  inputMode: InputMode;
  /** recentChatHistory is ignored here; history is sent as messages. */
  context: ConversationContext;
  workoutLine: string;
  hasPendingImage: boolean;
  repliedToPhoto: boolean;
}

const EGO_DOMAIN_RULES = `Calendar rules:
- Calendars are "personal" or "work". Default to personal when the user doesn't say.
- Resolve relative dates from the Singapore date above. Never invent a date or time that wasn't mentioned or implied; if no date can be determined, ask.
- A date with no time is an ALL-DAY event (allDay true, date only). "Add gym tomorrow" is all-day.
- A date with a time is a TIMED event (allDay false) with start and end as YYYY-MM-DDTHH:mm:ss+08:00. If only a start time is given, the event lasts 1 hour. End must be after start. "Meeting tomorrow at 3 pm" is 15:00:00 to 16:00:00.
- Several events in one message: use calendar_batch_add (up to 30 events).
- Put a location ("at Starbucks Raffles City", "on Zoom") in the location field, not in the title.
- "Notify me 2 hours before", "remind me 30 mins before": reminderMinutes (120, 30). Omit it when no reminder was asked for.
- calendar_add only drafts the event and the user confirms with buttons. That is expected.
- "What do I have today / tomorrow / this week", "what's on my calendar": calendar_view (calendarName "all" unless one is named; timeframe today, tomorrow, week or upcoming).
- "When am I free ...": calendar_free_slots (lists the gaps). calendar_view lists events. They are different.
- Move, reschedule, postpone, push or shift an EXISTING event ("move my gym session to 5pm tomorrow"): calendar_reschedule with a short title keyword as query, newDate only if the date changes, newStartTime as HH:mm 24-hour. It is not calendar_add.
- Delete, cancel or remove a calendar event: calendar_delete_search with a short title keyword (personal when no calendar is named). Never delete directly; the tool asks the user to confirm.
- If "Active pending calendar confirmation" is in the context and the user adjusts it ("make it 7pm", "rename it to ...", "put it in work", "change to 8 Sept"), call calendar_add again with the changed fields and everything else copied from the pending event. Never use calendar_move or calendar_rename for a pending draft.
- If "Most recently created calendar event" is in the context, or the user replied to a "Created event" message: switching calendars is calendar_move; a title-only change is calendar_rename (same calendar and timing); "delete that event" is calendar_delete_search.
- "That", "it", "what about tomorrow?" refer to the recent conversation turns.

To-do rules:
- Add to the to-do list: todo_add. Several tasks in one message ("1. buy milk 2. do laundry", "add milk, car wash and desk to my tasks"): one todo_add call with the tasks array.
- "Remind me to ...", "nag me to ...", "remind me every 15 minutes to ...": todo_add with remindIntervalMinutes 30, or the interval the user named. A plain "add buy milk to my todo list" has NO remindIntervalMinutes.
- "Remind me to call John today": task "call John", dueDate today, remindIntervalMinutes 30.
- "What do I have to do today?": todo_view timeframe today. "Show my tasks", "what's on my to-do list?": todo_view timeframe all.
- "I'm done with buy milk", "finished buying groceries", "mark buy milk as done": todo_complete with a keyword query.
- "Remove buy milk from my list", "delete task call John": todo_delete_search.
- Something that repeats on a schedule ("every month", "every Sunday", "monthly", "on the 1st of each month") is recurring_add, not todo_add. A repeating payment is a subscription (with amount); a repeating chore is a recurring_task. "Remind me to pay rent on the 1st every month" is recurring_task, title "Pay rent", monthly, dayOfMonth 1. "Show my subscriptions" is recurring_view.

Money:
- Everything about money goes to askFinanceAgent: logging income or expenses, "spent $6 on lunch", editing or deleting a transaction, a reply to a transaction card, spending questions ("how much did I spend this month", "how much on Grab in September"), budgets and category caps.
- Splitting a bill ("split $60 with Alice and Bob") is split_bill with people ["Me", "Alice", "Bob"], not a finance entry. "Who owes me money?" is iou_summary.

Memory:
- "Remember that ...", "save contact ...", "note: wifi password is ...": memory_save with a short key, the value, and a category (note, contact, fact, preference or credential). Questions about things the user may have saved ("what's Alice's birthday?", "what's my locker code?") are memory_recall, not a web search.

Email:
- "Draft an email to ... saying ...": email_draft with a clear subject and a polite body that has a greeting and a sign-off. The user confirms sending with a button.

Workout:
- "I'm going to the gym", "gym time", "heading to school gym": askWorkoutAgent kind "start" (location "school" or "csc" only if named). Do not treat it as a calendar event unless the user asks to schedule it.
- Raw sets or exercise notes outside a guided session ("incline smith 100 x 5, 100 x 4"): kind "log". Stats, PRs or progress: kind "view".

Undo:
- A standalone "undo", "revert that", "cancel that" is the undo tool. Deleting a specific item by name is not undo (it is a finance or calendar delete).`;

export function buildEgoInstructions(input: EgoPromptInput): string {
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(input.now);
  const time = new Intl.DateTimeFormat("en-SG", {
    timeZone: "Asia/Singapore",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(input.now);

  const contextBlock = buildConversationContextBlock({
    ...input.context,
    recentChatHistory: undefined,
  });
  const spoken = spokenInputNote(input.inputMode);
  const imageLine = input.repliedToPhoto
    ? "The user is replying to a photo. If they want it processed (log a receipt, add dates to the calendar), call processPendingImage."
    : input.hasPendingImage
      ? "A photo the user sent earlier is waiting for instructions. If this message tells you what to do with it (log it, add it to the calendar), call processPendingImage."
      : "";

  return `You are EGO ("Everything Gets Optimized"), the user's private personal assistant inside Telegram. You are the orchestrator: you read each message, decide what to do, and act by calling tools. You manage a finance agent, a workout agent and a set of functions (calendar, to-dos, email drafts, bill splitting, memory, recurring items, undo, web search).

Current date in Singapore: ${date}.
Current time in Singapore: ${time} (Asia/Singapore, +08:00).
Timezone: Asia/Singapore (+08:00).
${spoken ? `\n${spoken}\n` : ""}
${input.workoutLine}
${imageLine}
${contextBlock}

How to work:
- Work out what the user wants, then call the tool(s) that do it. One message can need several tools ("log lunch and move my 3pm"): call each one.
- Tools and the finance and workout agents send their own messages to the user. Do not repeat what they sent. When tools already told the user everything, reply with exactly: ${NO_REPLY}. Add a short line only when it genuinely adds something, such as a summary of a multi-step request or a failure.
- If a tool returns ok:false, tell the user plainly what failed. Never say something was done unless a tool returned ok:true.
- Greetings, chit-chat and questions that need no tool: answer directly in one to three plain sentences. Facts, news, places or anything that needs the web: call webSearch, then answer in your own words.
- If something essential is missing and cannot be inferred (an amount, a date, which item), ask one short question instead of guessing.
- Reply in plain text, short, no tables.

${EGO_DOMAIN_RULES}

${SECURITY_SYSTEM_GUARDRAIL}`;
}
```

- [ ] **Step 4: Run to verify pass, then type-check**

Run: `npm run test:ego && npx tsc --noEmit`
Expected: all sections PASS; tsc exits 0.

- [ ] **Step 5: Commit**

```bash
git add lib/agent/ego-prompt.ts scripts/test-ego.ts
git commit -m "feat(ego): add orchestrator prompt and message builders"
```

---

### Task 7: Orchestrator runner, flag and workout set shortcut

**Files:**
- Create: `lib/agent/ego-flag.ts`
- Create: `lib/agent/ego-orchestrator.ts`
- Modify: `lib/workout/workout-session.ts` (append at end of file)
- Test: `scripts/test-ego.ts`

**Interfaces:**
- Consumes: everything from Tasks 1-6; `runFinanceAgent`, `runWorkoutAgent` (Task 5 signatures); `defaultRegistry`, `IntentContext` (`lib/handlers/dispatcher`); `answerWithSearch` (`lib/search`); `processAssistantImages` (`lib/handlers/media-handler`); `getLatestPendingImage`, `consumePendingImage`, `UserCalendarContext` (`lib/pending-actions`); `loadSession` (`lib/workout/workout-session`); `sendTelegramMessage` (`lib/telegram`).
- Produces: `isEgoEnabled(env?: Record<string, string | undefined>): boolean`; `interface EgoRunInput { chatId: number; userId: number; updateId: number; text: string; inputMode: InputMode; messageDate: Date; history: FormattedChatTurn[]; userCalendarContext: UserCalendarContext; targetTransaction: FinanceTransaction | null; repliedToText?: string; repliedPhotoFileIds?: string[]; hasPendingImage: boolean }`; `runEgo(input: EgoRunInput): Promise<{ completionStatus: string }>`; `strictSetEntry(text: string, state: WorkoutSessionState | null): { weightKg: number; reps: number } | null`; `handleStrictSetShortcut(params: { chatId: number; text: string }): Promise<boolean>`.

- [ ] **Step 1: Write the failing tests**

Add to the imports at the top of `scripts/test-ego.ts`:

```ts
import { isEgoEnabled } from "../lib/agent/ego-flag";
import { strictSetEntry } from "../lib/workout/workout-session";
```

Add above `// ---- runner ----`:

```ts
section("EGO_ORCHESTRATOR flag: on by default, off only when set to off", () => {
  assert.equal(isEgoEnabled({}), true);
  assert.equal(isEgoEnabled({ EGO_ORCHESTRATOR: "" }), true);
  assert.equal(isEgoEnabled({ EGO_ORCHESTRATOR: "on" }), true);
  assert.equal(isEgoEnabled({ EGO_ORCHESTRATOR: "off" }), false);
  assert.equal(isEgoEnabled({ EGO_ORCHESTRATOR: " OFF " }), false);
});

section("workout set shortcut: fires only with an active session and a strict weight x reps match", () => {
  const state = {
    day: 1,
    week: 1,
    dayTitle: "Day 1 Upper",
    exIdx: 0,
    setIdx: 0,
    logged: [],
    startedAt: "2026-10-16T12:00:00+08:00",
  };
  assert.deepEqual(strictSetEntry("100 x 5", state), { weightKg: 100, reps: 5 });
  assert.deepEqual(strictSetEntry(" bw x 10 ", state), { weightKg: 0, reps: 10 });
  assert.equal(strictSetEntry("100 x 5", null), null, "no session means no shortcut");
  for (const notASet of ["hello", "100", "fix my last set", "what's the weather", "skip squats", ""]) {
    assert.equal(strictSetEntry(notASet, state), null, `"${notASet}" must go to the orchestrator`);
  }
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:ego`
Expected: FAIL (`lib/agent/ego-flag` not found).

- [ ] **Step 3: Implement the flag**

Create `lib/agent/ego-flag.ts`:

```ts
/** EGO is on unless EGO_ORCHESTRATOR is set to "off" (the rollback to the old pipeline). */
export function isEgoEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return (env.EGO_ORCHESTRATOR ?? "").trim().toLowerCase() !== "off";
}
```

- [ ] **Step 4: Implement the set shortcut**

Append to the end of `lib/workout/workout-session.ts`:

```ts

/** A plain "weight x reps" message while a session is active; null otherwise. */
export function strictSetEntry(
  text: string,
  state: WorkoutSessionState | null
): { weightKg: number; reps: number } | null {
  return state ? parseSetInput(text.trim()) : null;
}

/**
 * Records a plain "weight x reps" message straight into the active session, skipping
 * the orchestrator (the most frequent message in a workout). Returns true if consumed.
 */
export async function handleStrictSetShortcut(params: {
  chatId: number;
  text: string;
}): Promise<boolean> {
  // Cheap check first: most messages are not sets, so don't load the session for them.
  if (!parseSetInput(params.text.trim())) return false;
  const state = await loadSession();
  const entry = strictSetEntry(params.text, state);
  if (!state || !entry) return false;
  await handleLoggedSet(params.chatId, state, entry);
  return true;
}
```

- [ ] **Step 5: Run to verify pass**

Run: `npm run test:ego`
Expected: PASS for all sections.

- [ ] **Step 6: Implement the orchestrator runner**

Create `lib/agent/ego-orchestrator.ts`:

```ts
import { google } from "@ai-sdk/google";
import { ToolLoopAgent, isStepCount } from "ai";
import { runFinanceAgent } from "@/lib/agent/finance-agent";
import { runWorkoutAgent } from "@/lib/agent/workout-agent";
import { buildEgoTools } from "@/lib/agent/ego-tools";
import {
  buildEgoInstructions,
  describeWorkoutContext,
  dropCurrentTurn,
  toConversationMessages,
} from "@/lib/agent/ego-prompt";
import { createReplyTracker, resolveFinalReply } from "@/lib/agent/ego-reply";
import type { InputMode } from "@/lib/agent/input-mode";
import type { ConversationContext } from "@/lib/assistant-intent";
import type { FormattedChatTurn } from "@/lib/chat-history";
import type { FinanceTransaction } from "@/lib/finance";
import { defaultRegistry, type IntentContext } from "@/lib/handlers/dispatcher";
import { processAssistantImages } from "@/lib/handlers/media-handler";
import {
  consumePendingImage,
  getLatestPendingImage,
  type UserCalendarContext,
} from "@/lib/pending-actions";
import { answerWithSearch } from "@/lib/search";
import { sendTelegramMessage } from "@/lib/telegram";
import { loadSession } from "@/lib/workout/workout-session";

export interface EgoRunInput {
  chatId: number;
  userId: number;
  updateId: number;
  text: string;
  inputMode: InputMode;
  messageDate: Date;
  history: FormattedChatTurn[];
  userCalendarContext: UserCalendarContext;
  targetTransaction: FinanceTransaction | null;
  repliedToText?: string;
  repliedPhotoFileIds?: string[];
  hasPendingImage: boolean;
}

const MAX_STATUS_LENGTH = 100;

export async function runEgo(input: EgoRunInput): Promise<{ completionStatus: string }> {
  const { chatId, userId, updateId, text, inputMode } = input;
  const tracker = createReplyTracker();
  const toolsUsed: string[] = [];

  const workoutState = await loadSession().catch(() => null);

  const intentContext: IntentContext = {
    chatId,
    userId,
    updateId,
    text,
    messageDateObj: input.messageDate,
    userCalendarContext: input.userCalendarContext,
    targetTransaction: input.targetTransaction,
  };
  const priorHistory = dropCurrentTurn(input.history, text);

  const tools = buildEgoTools({
    dispatchIntent: (intent) => defaultRegistry.dispatchIntent(intentContext, intent),
    askFinance: async (request) => {
      const result = await runFinanceAgent({
        chatId,
        userId,
        text: request,
        targetTransaction: input.targetTransaction,
        repliedToText: input.repliedToText,
        history: priorHistory,
        inputMode,
      });
      return result.handled;
    },
    askWorkout: async ({ kind, request, location }) => {
      if (kind === "session_message") {
        const result = await runWorkoutAgent({ chatId, text: request, inputMode });
        return result.handled;
      }
      const intent =
        kind === "start"
          ? ({ action: "workout_start", location } as const)
          : kind === "log"
            ? ({ action: "workout_log", text: request, location } as const)
            : ({ action: "workout_view" } as const);
      const result = await defaultRegistry.dispatchIntent(intentContext, intent);
      return result.handled;
    },
    search: async (query) => (await answerWithSearch(query)).answer,
    processPendingImage: async (instruction) => {
      let fileIds = input.repliedPhotoFileIds;
      if (!fileIds?.length) {
        const pending = await getLatestPendingImage(userId);
        if (!pending) return false;
        fileIds = pending.payload.fileIds?.length
          ? pending.payload.fileIds
          : [pending.payload.fileId];
        await consumePendingImage(pending.token);
      }
      return processAssistantImages({ chatId, userId, fileIds, instruction, updateId });
    },
    markNotified: () => tracker.markNotified(),
    onToolCall: (name) => toolsUsed.push(name),
  });

  const context: ConversationContext = {
    messageTime: input.messageDate,
    repliedMessageText: input.repliedToText,
    activePendingCalendar: input.userCalendarContext.activePending?.payload,
    recentCalendarEvent: input.userCalendarContext.recentConfirmed,
    recentTransaction: input.targetTransaction
      ? {
          transactionId: input.targetTransaction.transactionId,
          type: input.targetTransaction.type,
          amount: input.targetTransaction.amount,
          currency: input.targetTransaction.currency,
          category: input.targetTransaction.category,
          description: input.targetTransaction.description,
          timestamp: input.targetTransaction.timestamp,
        }
      : undefined,
  };

  const agent = new ToolLoopAgent({
    model: google("gemini-3.6-flash"),
    instructions: buildEgoInstructions({
      now: input.messageDate,
      inputMode,
      context,
      workoutLine: describeWorkoutContext(workoutState),
      hasPendingImage: input.hasPendingImage,
      repliedToPhoto: Boolean(input.repliedPhotoFileIds?.length),
    }),
    tools,
    stopWhen: isStepCount(10),
    temperature: 0,
  });

  const result = await agent.generate({ messages: toConversationMessages(input.history, text) });

  const reply = resolveFinalReply({ text: result.text, notified: tracker.notified });
  if (reply) {
    await sendTelegramMessage(chatId, reply, undefined, null);
  }

  const status = toolsUsed.length
    ? `ego:${[...new Set(toolsUsed)].join(",")}`
    : "ego_replied";
  return { completionStatus: status.slice(0, MAX_STATUS_LENGTH) };
}
```

- [ ] **Step 7: Type-check**

Run: `npx tsc --noEmit`
Expected: exit 0. Likely adjustments if not: `userCalendarContext.activePending?.payload` / `recentConfirmed` must match `ConversationContext` (they are what `app/api/telegram/route.ts` already passes today, so copy its exact property access if the shapes differ); the `as const` workout intents must satisfy `AssistantIntent` (add `priority` etc. only if tsc demands, none are needed for these three actions).

- [ ] **Step 8: Commit**

```bash
git add lib/agent/ego-flag.ts lib/agent/ego-orchestrator.ts lib/workout/workout-session.ts scripts/test-ego.ts
git commit -m "feat(ego): add orchestrator runner, rollback flag and workout set shortcut"
```

---

### Task 8: Voice transcription hints, EGO pipeline and route integration

**Files:**
- Modify: `lib/voice-transcribe.ts`
- Create: `lib/telegram/ego-pipeline.ts`
- Modify: `app/api/telegram/route.ts` (imports ~lines 1-36; voice block ~lines 220-248; insertion after the `logChatMessage(...)` call ~line 261)
- Test: `scripts/test-ego.ts`

**Interfaces:**
- Consumes: `runEgo`, `EgoRunInput` (Task 7); `handleStrictSetShortcut` (Task 7); `isEgoEnabled` (Task 7); `InputMode` (Task 1); `dispatchCommand`, `handleWorkoutSessionMessage`.
- Produces: `buildTranscriptionSystemPrompt(contactNames: string[]): string` and an optional `contactNames?: string[]` on `transcribeTelegramVoiceNote`'s input in `lib/voice-transcribe.ts`; `handleEgoText(params: { message: NonNullable<TelegramUpdate["message"]>; chatId: number; updateId: number; text: string; inputMode: InputMode }): Promise<{ completionStatus?: string }>` in `lib/telegram/ego-pipeline.ts`.

- [ ] **Step 1: Write the failing test for the transcription prompt**

Add to the imports at the top of `scripts/test-ego.ts`:

```ts
import { buildTranscriptionSystemPrompt } from "../lib/voice-transcribe";
```

Add above `// ---- runner ----`:

```ts
section("transcription prompt carries domain vocabulary and the user's contact names", () => {
  const p = buildTranscriptionSystemPrompt(["Priya", "Wei Jie"]);
  assert.match(p, /PayLah/);
  assert.match(p, /T-bar row/);
  assert.match(p, /Priya/);
  assert.match(p, /Wei Jie/);
  assert.match(p, /Output ONLY the transcribed text/);
  const bare = buildTranscriptionSystemPrompt([]);
  assert.match(bare, /PayLah/);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:ego`
Expected: FAIL (`buildTranscriptionSystemPrompt` is not exported).

- [ ] **Step 3: Implement the transcription hints**

In `lib/voice-transcribe.ts` add to the imports:

```ts
import { listAllMemories } from "./memory";
```

Add above `transcribeTelegramVoiceNote`:

```ts
const STATIC_VOCABULARY = [
  "EGO",
  "PayLah",
  "Apple Pay",
  "Grab",
  "SGD",
  "kg",
  "reps",
  "bench press",
  "incline Smith",
  "T-bar row",
  "lat pulldown",
  "personal calendar",
  "work calendar",
  "to-do list",
];

export function buildTranscriptionSystemPrompt(contactNames: string[]): string {
  const vocabulary = [...STATIC_VOCABULARY, ...contactNames].join(", ");
  return `You are an accurate audio transcription engine for EGO, a personal assistant.
Transcribe the user's spoken voice note verbatim into clear, natural text.
Do not add conversational replies, explanations, quotes, or markdown formatting.
If currency or numbers are mentioned, write them naturally (e.g. "$5 for coffee", "tomorrow from 3 pm to 4 pm").
Words and names you may hear (prefer these spellings when the audio matches): ${vocabulary}.
Output ONLY the transcribed text.`;
}

async function loadContactNames(): Promise<string[]> {
  try {
    const memories = await Promise.race([
      listAllMemories(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 1500)),
    ]);
    return memories
      .filter((m) => m.category === "contact")
      .map((m) => m.key)
      .slice(0, 40);
  } catch {
    return [];
  }
}
```

Change `transcribeTelegramVoiceNote`'s input type to add `contactNames?: string[];` and replace its inline `system: \`You are an accurate ... Output ONLY the transcribed text.\`,` with:

```ts
    system: buildTranscriptionSystemPrompt(input.contactNames ?? []),
```

In `handleVoiceNoteAction`, replace

```ts
    const downloaded = await downloadTelegramAudio(fileId, mimeType);
    const transcription = await transcribeTelegramVoiceNote({
      audio: downloaded.data,
      mediaType: downloaded.mediaType,
    });
```

with:

```ts
    const [downloaded, contactNames] = await Promise.all([
      downloadTelegramAudio(fileId, mimeType),
      loadContactNames(),
    ]);
    const transcription = await transcribeTelegramVoiceNote({
      audio: downloaded.data,
      mediaType: downloaded.mediaType,
      contactNames,
    });
```

- [ ] **Step 4: Run to verify pass**

Run: `npm run test:ego`
Expected: PASS for all sections.

- [ ] **Step 5: Create the EGO pipeline**

Create `lib/telegram/ego-pipeline.ts`:

```ts
import type { InputMode } from "@/lib/agent/input-mode";
import { runEgo } from "@/lib/agent/ego-orchestrator";
import { getRecentChatHistory } from "@/lib/chat-history";
import { getLatestTransaction } from "@/lib/finance";
import { resolveRepliedTransaction } from "@/lib/handlers/finance-handler";
import { getLatestPendingImage, getLatestUserCalendarContext } from "@/lib/pending-actions";
import { dispatchCommand } from "@/lib/telegram/command-router";
import type { TelegramUpdate } from "@/lib/telegram-types";
import {
  handleStrictSetShortcut,
  handleWorkoutSessionMessage,
} from "@/lib/workout/workout-session";

type TelegramMessage = NonNullable<TelegramUpdate["message"]>;

/**
 * EGO-mode handling of one text message (typed, a photo caption, or a voice transcript).
 * Photo/voice intake, auth, dedupe and callbacks stay in the route.
 */
export async function handleEgoText(params: {
  message: TelegramMessage;
  chatId: number;
  updateId: number;
  text: string;
  inputMode: InputMode;
}): Promise<{ completionStatus?: string }> {
  const { message, chatId, updateId, text, inputMode } = params;
  const userId = message.from.id;

  // Workout slash commands (/gym, /endworkout, /workoutday ...) are deterministic.
  if (text.startsWith("/") && (await handleWorkoutSessionMessage({ chatId, text }))) {
    return { completionStatus: "workout_session" };
  }

  const commandResult = await dispatchCommand({ chatId, userId, updateId, text });
  if (commandResult.handled) {
    return { completionStatus: commandResult.completionStatus };
  }

  // The most frequent message in a workout skips the model entirely.
  if (await handleStrictSetShortcut({ chatId, text })) {
    return { completionStatus: "workout_set_shortcut" };
  }

  const replyPhotos = message.reply_to_message?.photo;
  const [history, userCalendarContext, latestTxn, repliedTxn, pendingImage] = await Promise.all([
    getRecentChatHistory(userId, 8),
    getLatestUserCalendarContext(userId),
    getLatestTransaction(),
    message.reply_to_message
      ? resolveRepliedTransaction(message.reply_to_message)
      : Promise.resolve(null),
    replyPhotos?.length ? Promise.resolve(null) : getLatestPendingImage(userId),
  ]);

  const result = await runEgo({
    chatId,
    userId,
    updateId,
    text,
    inputMode,
    messageDate: message.date ? new Date(message.date * 1000) : new Date(),
    history,
    userCalendarContext,
    targetTransaction: repliedTxn || latestTxn,
    repliedToText: message.reply_to_message?.text,
    repliedPhotoFileIds: replyPhotos?.length
      ? [replyPhotos[replyPhotos.length - 1].file_id]
      : undefined,
    hasPendingImage: Boolean(pendingImage),
  });
  return { completionStatus: result.completionStatus };
}
```

- [ ] **Step 6: Read the Next.js route-handler docs before editing the route**

Per `AGENTS.md`, skim the route-handler guide under `node_modules/next/dist/docs/` (find it with `ls node_modules/next/dist/docs/` and open the route handlers / app router API page). Confirm that `export async function POST(request: Request)` returning `Response.json(...)` is still the supported shape. The edit below does not change it.

- [ ] **Step 7: Wire the route**

In `app/api/telegram/route.ts` add to the imports (after the `handleWorkoutSessionMessage` import):

```ts
import { isEgoEnabled } from "@/lib/agent/ego-flag";
import type { InputMode } from "@/lib/agent/input-mode";
import { handleEgoText } from "@/lib/telegram/ego-pipeline";
```

Directly after the line `let text = (message.text || message.caption)?.trim() ?? "";` add:

```ts
    let inputMode: InputMode = "text";
```

In the voice block, directly after the line `text = transcription;` add:

```ts
          inputMode = "voice";
```

Directly after the `logChatMessage({ ... }).catch(() => {});` call and before the `// 2.9 Guided PH3 workout` comment, insert:

```ts
    // EGO orchestrator: one tool-calling agent replaces the regex fast-paths and the
    // intent classifier below. Set EGO_ORCHESTRATOR=off to fall back to the old pipeline.
    if (isEgoEnabled()) {
      const egoResult = await handleEgoText({ message, chatId, updateId, text, inputMode });
      if (egoResult.completionStatus) {
        await markUpdateCompleted(updateId, egoResult.completionStatus);
      }
      return Response.json({ ok: true });
    }

```

Do not delete the old pipeline below; it is the rollback path.

- [ ] **Step 8: Type-check, lint and test**

Run: `npx tsc --noEmit && npm run lint && npm run test:ego`
Expected: tsc exits 0; eslint reports no new errors; EGO tests PASS.

- [ ] **Step 9: Build**

Run: `npm run build`
Expected: Next build succeeds with no type or route errors.

- [ ] **Step 10: Commit**

```bash
git add lib/voice-transcribe.ts lib/telegram/ego-pipeline.ts app/api/telegram/route.ts scripts/test-ego.ts
git commit -m "feat(ego): route text and voice messages through the orchestrator"
```

---

### Task 9: Routing eval

**Files:**
- Create: `scripts/ego-eval-cases.ts`
- Create: `scripts/eval-ego.ts`
- Test: `scripts/test-ego.ts`

**Interfaces:**
- Consumes: `buildEgoTools`, `buildEgoInstructions`, `describeWorkoutContext`, `toConversationMessages` (Tasks 4, 6).
- Produces: `interface EgoEvalCase { message: string; expectTools: string[]; expectNone?: boolean; inputMode?: "text" | "voice"; workoutActive?: boolean; description: string }`; `EGO_EVAL_CASES: EgoEvalCase[]`.

- [ ] **Step 1: Write the failing fixture-sanity test**

Add to the imports at the top of `scripts/test-ego.ts`:

```ts
import { EGO_EVAL_CASES } from "./ego-eval-cases";
```

Add above `// ---- runner ----`:

```ts
section("routing eval fixtures only expect tools that exist", () => {
  const { deps } = makeDeps();
  const tools = buildEgoTools(deps);
  assert.ok(EGO_EVAL_CASES.length >= 30, "keep at least 30 routing cases");
  for (const c of EGO_EVAL_CASES) {
    for (const name of c.expectTools) {
      assert.ok(name in tools, `eval case "${c.message}" expects unknown tool ${name}`);
    }
    if (c.expectNone) assert.equal(c.expectTools.length, 0, `"${c.message}" is expectNone`);
  }
  assert.ok(EGO_EVAL_CASES.some((c) => c.inputMode === "voice"), "include voice phrasings");
  assert.ok(EGO_EVAL_CASES.some((c) => c.workoutActive), "include an active-workout case");
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:ego`
Expected: FAIL, `Cannot find module` for `scripts/ego-eval-cases`.

- [ ] **Step 3: Create the fixtures**

Create `scripts/ego-eval-cases.ts`:

```ts
export interface EgoEvalCase {
  message: string;
  /** Tools that must all be called (extra tools are allowed). */
  expectTools: string[];
  /** True when the correct behavior is to answer directly without any tool. */
  expectNone?: boolean;
  inputMode?: "text" | "voice";
  workoutActive?: boolean;
  description: string;
}

export const EGO_EVAL_CASES: EgoEvalCase[] = [
  { message: "spent $6.20 for lunch", expectTools: ["askFinanceAgent"], description: "Log an expense" },
  { message: "earned $100 from freelance work", expectTools: ["askFinanceAgent"], description: "Log income" },
  { message: "how much did I spend this month?", expectTools: ["askFinanceAgent"], description: "Spending summary" },
  { message: "how much did I spend on Grab this month?", expectTools: ["askFinanceAgent"], description: "Merchant query" },
  { message: "delete my coffee expense", expectTools: ["askFinanceAgent"], description: "Delete a transaction" },
  { message: "set my monthly budget to $600", expectTools: ["askFinanceAgent"], description: "Set budget" },
  { message: "cap dining at $150 a month", expectTools: ["askFinanceAgent"], description: "Category cap" },
  { message: "Add gym tomorrow", expectTools: ["calendar_add"], description: "All-day event" },
  { message: "Schedule floorball tomorrow from 8 pm to 9:30 pm", expectTools: ["calendar_add"], description: "Timed event" },
  { message: "What's on my calendar today?", expectTools: ["calendar_view"], description: "Agenda" },
  { message: "when am I free tomorrow?", expectTools: ["calendar_free_slots"], description: "Free slots" },
  { message: "move my gym session to 5pm tomorrow", expectTools: ["calendar_reschedule"], description: "Reschedule" },
  { message: "delete gym tomorrow from personal", expectTools: ["calendar_delete_search"], description: "Delete event" },
  { message: "Add buy groceries to my to-do list", expectTools: ["todo_add"], description: "Add todo" },
  { message: "Remind me to call John today", expectTools: ["todo_add"], description: "Reminder todo" },
  { message: "I'm done with buy groceries", expectTools: ["todo_complete"], description: "Complete todo" },
  { message: "add to my todo list: 1. buy milk 2. do laundry", expectTools: ["todo_add"], description: "Batch todos" },
  { message: "what do I have to do today?", expectTools: ["todo_view"], description: "View todos" },
  { message: "Draft an email to alex@example.com about project update", expectTools: ["email_draft"], description: "Email draft" },
  { message: "split $60 bill with Alice and Bob", expectTools: ["split_bill"], description: "Split bill" },
  { message: "who owes me money?", expectTools: ["iou_summary"], description: "IOU summary" },
  { message: "remember that Alice's birthday is June 15", expectTools: ["memory_save"], description: "Save memory" },
  { message: "what is Alice's birthday?", expectTools: ["memory_recall"], description: "Recall memory" },
  { message: "remind me to pay rent on the 1st every month", expectTools: ["recurring_add"], description: "Recurring task" },
  { message: "show my subscriptions", expectTools: ["recurring_view"], description: "View recurring" },
  { message: "undo", expectTools: ["undo"], description: "Undo" },
  { message: "I'm going to the gym", expectTools: ["askWorkoutAgent"], description: "Start workout" },
  { message: "show my workout stats", expectTools: ["askWorkoutAgent"], description: "Workout stats" },
  { message: "what's the capital of Australia?", expectTools: ["webSearch"], description: "General question" },
  {
    message: "spent $6 on lunch and add gym tomorrow at 7pm",
    expectTools: ["askFinanceAgent", "calendar_add"],
    description: "Multi-step: finance plus calendar",
  },
  { message: "hey", expectTools: [], expectNone: true, description: "Greeting needs no tool" },
  {
    message: "twelve fifty for chicken rice",
    expectTools: ["askFinanceAgent"],
    inputMode: "voice",
    description: "Voice: spoken amount",
  },
  {
    message: "remind me to call mom at five pm",
    expectTools: ["todo_add"],
    inputMode: "voice",
    description: "Voice: reminder",
  },
  {
    message: "one hundred times five",
    expectTools: ["askWorkoutAgent"],
    inputMode: "voice",
    workoutActive: true,
    description: "Voice: spoken set during an active workout",
  },
  {
    message: "skip the next exercise",
    expectTools: ["askWorkoutAgent"],
    workoutActive: true,
    description: "Active workout: skip",
  },
];
```

- [ ] **Step 4: Run to verify pass**

Run: `npm run test:ego`
Expected: PASS for all sections.

- [ ] **Step 5: Create the eval runner**

Create `scripts/eval-ego.ts`:

```ts
/**
 * EGO routing eval.
 *
 * Runs each case through the real orchestrator prompt with STUB tools (nothing is
 * written to Sheets/Calendar/Telegram) and checks which tools the model chose.
 *
 * Usage:
 *   npm run eval:ego             # live model (needs GOOGLE_GENERATIVE_AI_API_KEY)
 *   npm run eval:ego -- --dry-run   # offline: validates fixtures and tool names only
 */
import { google } from "@ai-sdk/google";
import { ToolLoopAgent, isStepCount } from "ai";
import { buildEgoInstructions, describeWorkoutContext, toConversationMessages } from "../lib/agent/ego-prompt";
import { buildEgoTools } from "../lib/agent/ego-tools";
import { EGO_EVAL_CASES } from "./ego-eval-cases";
import { loadEnvLocal } from "./bench/util";

const PASS_THRESHOLD = 0.85;

async function run() {
  loadEnvLocal();
  const dryRun = process.argv.includes("--dry-run") || !process.env.GOOGLE_GENERATIVE_AI_API_KEY;

  console.log("\n=======================================================");
  console.log(`  🧭 EGO Routing Eval ${dryRun ? "(dry run)" : "(live model)"}`);
  console.log("=======================================================\n");

  const used: string[] = [];
  const stubTools = buildEgoTools({
    dispatchIntent: async () => ({ handled: true, completionStatus: "stub" }),
    askFinance: async () => true,
    askWorkout: async () => true,
    search: async () => "Stub search answer.",
    processPendingImage: async () => true,
    markNotified: () => {},
    onToolCall: (name) => used.push(name),
  });

  if (dryRun) {
    for (const c of EGO_EVAL_CASES) {
      for (const name of c.expectTools) {
        if (!(name in stubTools)) {
          console.error(`❌ "${c.message}" expects unknown tool ${name}`);
          process.exit(1);
        }
      }
    }
    console.log(`  ✅ ${EGO_EVAL_CASES.length} cases reference valid tools. Set GOOGLE_GENERATIVE_AI_API_KEY to run live.\n`);
    return;
  }

  let passed = 0;
  let totalMs = 0;
  for (const c of EGO_EVAL_CASES) {
    used.length = 0;
    const agent = new ToolLoopAgent({
      model: google("gemini-3.6-flash"),
      instructions: buildEgoInstructions({
        now: new Date(),
        inputMode: c.inputMode ?? "text",
        context: {},
        workoutLine: describeWorkoutContext(c.workoutActive ? { day: 4, logged: [{}, {}] } : null),
        hasPendingImage: false,
        repliedToPhoto: false,
      }),
      tools: stubTools,
      stopWhen: isStepCount(4),
      temperature: 0,
    });

    const started = Date.now();
    let error: string | null = null;
    try {
      await agent.generate({ messages: toConversationMessages([], c.message) });
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    const elapsed = Date.now() - started;
    totalMs += elapsed;

    const ok =
      !error &&
      c.expectTools.every((t) => used.includes(t)) &&
      (!c.expectNone || used.length === 0);
    if (ok) passed += 1;
    console.log(
      `  ${ok ? "✅" : "❌"} ${c.message.padEnd(58).slice(0, 58)} -> ${used.join(", ") || "(none)"} [${elapsed}ms]${
        ok ? "" : `  expected: ${c.expectTools.join(", ") || "(none)"}${error ? `  error: ${error}` : ""}`
      }`
    );
  }

  const accuracy = passed / EGO_EVAL_CASES.length;
  console.log(
    `\n  Accuracy: ${passed}/${EGO_EVAL_CASES.length} (${(accuracy * 100).toFixed(0)}%), avg ${Math.round(
      totalMs / EGO_EVAL_CASES.length
    )}ms per message\n`
  );
  if (accuracy < PASS_THRESHOLD) {
    console.error(`💥 Accuracy below ${PASS_THRESHOLD * 100}%.\n`);
    process.exit(1);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 6: Run the dry run**

Run: `npm run eval:ego -- --dry-run`
Expected: prints `✅ 35 cases reference valid tools` and exits 0.

- [ ] **Step 7: Run live if an API key is available**

Run: `npm run eval:ego` (requires `GOOGLE_GENERATIVE_AI_API_KEY` in `.env.local`)
Expected: accuracy at or above 85% with a per-message latency column. Record the average latency and compare it with `npm run bench:intent` for the same machine and note both in the PR description. Cases that fail point to prompt rules to tighten in `EGO_DOMAIN_RULES` (`lib/agent/ego-prompt.ts`), then re-run. Do not weaken the expectations to make a case pass.

- [ ] **Step 8: Commit**

```bash
git add scripts/ego-eval-cases.ts scripts/eval-ego.ts scripts/test-ego.ts
git commit -m "test(ego): add routing eval with offline fixture validation"
```

---

### Task 10: Rename to EGO and document

**Files:**
- Modify: `lib/telegram/menu-builder.ts` (lines ~23, ~46)
- Modify: `app/layout.tsx` (lines ~26-28)
- Modify: `app/page.tsx` (lines ~296, ~368, ~1045)
- Modify: `app/api/apple-wallet/route.ts` (line ~572)
- Modify: `lib/search.ts`, `lib/image-intent.ts`, `lib/assistant-intent.ts` (prompt wording)
- Modify: `README.md`

**Interfaces:** none (text only).

- [ ] **Step 1: Confirm nothing parses the strings being renamed**

Run: `grep -rn "Telegram Assistant Apple Wallet Webhook\|Personal Assistant Control Panel\|PERSONAL ASSISTANT" --include=*.ts --include=*.tsx --include=*.mjs --include=*.json . --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.agents`
Expected: only the definition sites listed above (no test or script matches on those strings). If something else matches, update it in the same step.

- [ ] **Step 2: Bot menu**

In `lib/telegram/menu-builder.ts`:
- Change `{ command: "help", description: "Show full assistant guide" },` to `{ command: "help", description: "Show the EGO guide" },`.
- Change `"🤖 *Personal Assistant Control Panel*",` to the two lines:

```ts
    "🤖 *EGO Control Panel*",
    "_Everything Gets Optimized_",
```

- [ ] **Step 3: Metadata**

In `app/layout.tsx` change the title to `"EGO — Everything Gets Optimized"` and the description to:

```
"EGO (Everything Gets Optimized) is a private, serverless Telegram assistant: one orchestrator agent for natural-language finance tracking, Google Calendar, to-dos, workouts, receipt OCR and voice instructions."
```

- [ ] **Step 4: Landing page**

In `app/page.tsx`:
- Replace the text `PERSONAL ASSISTANT` (brand mark, ~line 296) with `EGO`.
- Replace `A serverless assistant orchestrating Apple Pay NFC tap webhooks,` (~line 368) with `EGO, short for Everything Gets Optimized, is a serverless assistant orchestrating Apple Pay NFC tap webhooks,` (keep the following lines unchanged).
- Replace `<span>Private Serverless Assistant</span>` (~line 1045) with `<span>EGO · Everything Gets Optimized</span>`.

- [ ] **Step 5: Wallet webhook label and prompt wording**

- `app/api/apple-wallet/route.ts`: `service: "Telegram Assistant Apple Wallet Webhook",` becomes `service: "EGO Apple Wallet Webhook",`.
- `lib/search.ts`: `You are an intelligent, concise personal assistant for a user in Singapore.` becomes `You are EGO, an intelligent, concise personal assistant for a user in Singapore.`; `You are a helpful, concise personal assistant.` becomes `You are EGO, a helpful, concise personal assistant.`
- `lib/image-intent.ts`: `a private Telegram personal assistant` becomes `EGO, a private Telegram personal assistant`.
- `lib/assistant-intent.ts` (inside `buildIntentSystemPrompt`): `a private Telegram personal assistant` becomes `EGO, a private Telegram personal assistant`.

- [ ] **Step 6: README**

In `README.md`:
- Change the first heading to `# 🤖 EGO — Everything Gets Optimized`.
- Directly under the heading's intro paragraph, add:

```markdown
**EGO** stands for *Everything Gets Optimized*. It is the name of this assistant and of the orchestrator agent at its center. (The repository is still called `telegram-personal-assistant`.)
```

- Add a section before "Agentic layer" (and link it from the intro list):

```markdown
## 🧠 The EGO orchestrator

Every free-text message (typed, a photo caption, or a transcribed voice note) goes to one orchestrator agent. It decides what to do and calls tools: the **finance agent**, the **workout agent**, and one tool per handler (calendar, to-dos, email drafts, bill splitting, memory, recurring items, undo), plus web search and photo processing. A single message can use several tools ("log lunch and move my 3pm").

- **Voice:** voice notes are transcribed (with gym, PayLah and contact-name hints), echoed back as "Heard: …", then handled like typed instructions. Every agent knows the text was spoken, expects mishearings, and confirms before an uncertain destructive change.
- **Deterministic parts stay deterministic:** slash commands, button callbacks, cron jobs, photo intake and plain `weight x reps` set logging during a workout skip the model.
- **Rollback:** set `EGO_ORCHESTRATOR=off` to use the previous regex and intent-classifier pipeline.
- **Tests:** `npm run test:ego` (offline unit tests) and `npm run eval:ego` (routing accuracy and latency against the live model; `-- --dry-run` validates fixtures offline).
```

- [ ] **Step 7: Verify nothing user-facing still says "Personal Assistant"**

Run: `grep -rn "Personal Assistant\|PERSONAL ASSISTANT" app lib README.md`
Expected: no matches. (`Finance Assistant` in `command-router.ts` is a submenu title and intentionally stays.)

- [ ] **Step 8: Type-check, lint, build**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: all succeed.

- [ ] **Step 9: Commit**

```bash
git add lib/telegram/menu-builder.ts app/layout.tsx app/page.tsx app/api/apple-wallet/route.ts lib/search.ts lib/image-intent.ts lib/assistant-intent.ts README.md
git commit -m "feat(ego): rename the assistant to EGO across menu, site, prompts and README"
```

---

### Task 11: Final verification and rollout notes

**Files:** none modified unless verification finds a problem.

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: all suites PASS, including "EGO Orchestrator (tools, replies, voice)".

- [ ] **Step 2: Static checks and build**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: all succeed.

- [ ] **Step 3: Routing eval and cost/latency comparison**

Run: `npm run eval:ego` then `npm run bench:intent` and `npm run bench:cost`
Expected: eval accuracy at or above 85%. Record EGO's average per-message latency next to the classifier benchmark so the latency/cost increase the spec warns about is a measured number, not a guess.

- [ ] **Step 4: Rollback path still compiles**

Run: `EGO_ORCHESTRATOR=off npm run build`
Expected: build succeeds. The flag is read at request time in the route, so this only proves the old pipeline still compiles; confirm the runtime switch with a preview deployment in Step 5.

- [ ] **Step 5: Preview-deployment smoke test (manual, by the user)**

Deploy a preview with `TELEGRAM_WEBHOOK_SECRET` / `TELEGRAM_ALLOWED_USER_ID` set, point a test bot at it, and send:
1. `spent $6 on lunch and add gym tomorrow at 7pm` (two replies: transaction with undo button, then a calendar confirmation).
2. A voice note: "twelve fifty for chicken rice" (a "Heard:" echo, then a $12.50 transaction).
3. Start a workout, send `100 x 5` (instant, no model), then "fix my last set to 105" and a voice note "skip the next exercise".
4. `/help` (EGO control panel) and a swipe-reply to a transaction card with `make it $12`.
5. Set `EGO_ORCHESTRATOR=off`, redeploy, and confirm messages follow the old pipeline.

- [ ] **Step 6: Hand back**

Summarize for the user: what shipped, eval accuracy and latency numbers, and that the old pipeline remains behind `EGO_ORCHESTRATOR=off` until they confirm they want it deleted (a separate cleanup task).

---

## Self-Review

**Spec coverage**
- §1 Rename: Task 10 (menu, `/help` via the control panel text, landing page, metadata, README, prompts, wallet label); finance/workout prompt wording in Task 5; voice prompt wording in Task 8.
- §2 Architecture (what stays, what is replaced, context): Tasks 7 and 8 (`runEgo`, `handleEgoText`, route insertion; the old block remains below as the rollback).
- §3 Tools (registry-generated tools, delegates, `webSearch`, `processPendingImage`, drift test): Tasks 3 and 4 (drift test in Task 4).
- §4 Replies (tracker, `NO_REPLY`, not silent): Task 2, used in Task 7.
- §5 Voice (flag to route, orchestrator note, delegates get the flag, transcription hints, spoken sets fall through): Tasks 1, 5, 6, 8; the route sets `inputMode` in Task 8.
- §6 Workout set shortcut: Task 7 (`strictSetEntry`, `handleStrictSetShortcut`), used in Task 8's pipeline.
- §7 Safety and rollout (guardrail, step cap, thrown error path, flag): Tasks 6 and 7; the thrown-error path is the route's existing outer `catch`, which the new branch inherits because it runs inside the same `try`.
- §8 Testing (routing eval, unit tests, benchmarks): Tasks 4, 6, 9 and 11.
- Spec risk "handler return values are only status strings": acknowledged; no task changes handlers.

**Placeholder scan:** no TBD/TODO steps; every code step shows code. Task 7 Step 7 and Task 4 Step 5 name concrete likely type adjustments rather than "fix types".

**Type consistency:** `InputMode`/`spokenInputNote` (Task 1) are used with the same names in Tasks 5, 6, 7, 8. `EgoToolDeps` fields (`dispatchIntent`, `askFinance`, `askWorkout`, `search`, `processPendingImage`, `markNotified`, `onToolCall`) are identical in Tasks 4, 7 and 9. `WorkoutDelegateKind` values match the `askWorkoutAgent` zod enum and the `switch` logic in `runEgo`. `buildFinanceInstructions`/`buildWorkoutInstructions` are the names used in both the agents and the tests. `EgoRunInput` fields match what `handleEgoText` passes.

**Review Focus coverage:** handler failure honesty and malformed arguments (Task 4 tests), silent-reply fallback (Task 2), set-shortcut strictness (Task 7), SGT date at the UTC boundary (Task 6).
