import assert from "node:assert/strict";
import {
  SPOKEN_INPUT_NOTE,
  spokenInputNote,
} from "../lib/agent/input-mode";
import {
  FALLBACK_REPLY,
  NO_REPLY,
  createReplyTracker,
  resolveFinalReply,
} from "../lib/agent/ego-reply";
import {
  buildConversationContextBlock,
  intentSchemaByAction,
} from "../lib/assistant-intent";
import { defaultRegistry } from "../lib/handlers/dispatcher";
import {
  EXCLUDED_INTENT_ACTIONS,
  TOOL_DESCRIPTIONS,
  buildEgoTools,
  type EgoToolDeps,
} from "../lib/agent/ego-tools";
import type { AssistantIntent } from "../lib/assistant-intent";
import { buildFinanceInstructions } from "../lib/agent/finance-agent";
import { buildWorkoutInstructions } from "../lib/agent/workout-agent";
import {
  buildEgoInstructions,
  describeWorkoutContext,
  dropCurrentTurn,
  toConversationMessages,
} from "../lib/agent/ego-prompt";
import { SECURITY_SYSTEM_GUARDRAIL } from "../lib/security";
import { isEgoEnabled } from "../lib/agent/ego-flag";
import { strictSetEntry } from "../lib/workout/workout-session";
import { buildTranscriptionSystemPrompt } from "../lib/voice-transcribe";

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
