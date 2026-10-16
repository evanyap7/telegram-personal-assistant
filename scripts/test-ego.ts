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
