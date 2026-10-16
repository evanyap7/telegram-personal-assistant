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
