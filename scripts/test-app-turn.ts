/**
 * Unit Test Suite for the app turn runner, event types and SSE framing
 *
 * Usage:
 *   node --experimental-strip-types --import ./scripts/bench/register.mjs scripts/test-app-turn.ts
 */

import { isShortLivedUpdateId } from "../lib/update-log-ids";
import { encodeSse, type AppEvent } from "../lib/app/events";
import {
  appUpdateId,
  createAppChannel,
  runAppTurn,
  type AppTurnDeps,
} from "../lib/app/turn";
import { egoTurnFromMessage, type EgoTurn } from "../lib/telegram/ego-turn";
import { runInChannel } from "../lib/channel";
import {
  sendTelegramMessage,
  editTelegramMessage,
  removeTelegramInlineKeyboard,
  answerTelegramCallback,
  sendTelegramDocument,
  sendTelegramChatAction,
  type InlineKeyboardMarkup,
} from "../lib/telegram";

let totalPassed = 0;
let totalFailed = 0;

function assert(condition: boolean, testName: string, detail?: unknown) {
  if (condition) {
    console.log(`  ✅ PASS: ${testName}`);
    totalPassed++;
  } else {
    console.error(`  ❌ FAIL: ${testName}`, detail === undefined ? "" : JSON.stringify(detail));
    totalFailed++;
  }
}

type Calls = {
  started: number[];
  completed: Array<[number, string]>;
  failed: Array<[number, string]>;
  turns: EgoTurn[];
  logged: Array<[string, string, string]>;
};

function makeDeps(
  turn: (t: EgoTurn) => Promise<{ completionStatus?: string }>,
  opts: { processed?: boolean } = {}
): { deps: AppTurnDeps; calls: Calls } {
  const calls: Calls = { started: [], completed: [], failed: [], turns: [], logged: [] };
  const deps: AppTurnDeps = {
    async alreadyProcessed() {
      return opts.processed ?? false;
    },
    async markStarted(id) {
      calls.started.push(id);
    },
    async markCompleted(id, status) {
      calls.completed.push([id, status]);
    },
    async markFailed(id, message) {
      calls.failed.push([id, message]);
    },
    async turn(t) {
      calls.turns.push(t);
      return turn(t);
    },
    async logUserMessage(text, inputMode, requestId) {
      calls.logged.push([text, inputMode, requestId]);
    },
  };
  return { deps, calls };
}

async function collect(
  deps: AppTurnDeps,
  input: { text: string; inputMode: "text" | "voice"; requestId: string }
): Promise<AppEvent[]> {
  const events: AppEvent[] = [];
  await runAppTurn(deps, input, (e) => events.push(e));
  return events;
}

const markup: InlineKeyboardMarkup = {
  inline_keyboard: [[{ text: "Undo", callback_data: "undo:1" }, { text: "Edit", callback_data: "edit:1" }]],
};

async function runTests() {
  console.log("\n=======================================================");
  console.log("  Unit Tests: App Turn Runner & SSE Events");
  console.log("=======================================================\n");

  const originalFetch = globalThis.fetch;
  const originalToken = process.env.TELEGRAM_BOT_TOKEN;
  const originalUser = process.env.TELEGRAM_ALLOWED_USER_ID;
  process.env.TELEGRAM_BOT_TOKEN = "test-token";
  process.env.TELEGRAM_ALLOWED_USER_ID = "424242";
  let fetchCalls: string[] = [];
  globalThis.fetch = (async (url: unknown) => {
    fetchCalls.push(String(url));
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;

  try {
    // appUpdateId_is_deterministic_and_disjoint
    {
      const a1 = appUpdateId("req-a");
      const a2 = appUpdateId("req-a");
      const b = appUpdateId("req-b");
      const sample = Array.from({ length: 200 }, (_, i) => appUpdateId(`r-${i}`));
      assert(a1 === a2, "appUpdateId_is_deterministic_and_disjoint: same requestId gives the same id");
      assert(a1 !== b, "appUpdateId_is_deterministic_and_disjoint: different requestIds differ");
      assert(
        sample.every((id) => Number.isSafeInteger(id) && id >= 1e13) && new Set(sample).size === sample.length,
        "appUpdateId_is_deterministic_and_disjoint: every id is a safe integer >= 1e13"
      );
    }

    // emits_thinking_then_messages_then_done
    {
      fetchCalls = [];
      const { deps, calls } = makeDeps(async () => {
        await sendTelegramMessage(1, "a");
        await sendTelegramMessage(1, "b");
        return { completionStatus: "ego_reply" };
      });
      const events = await collect(deps, { text: "hello", inputMode: "text", requestId: "r1" });
      const types = events.map((e) => e.type).join(",");
      assert(types === "thinking,message,message,done", "emits_thinking_then_messages_then_done: event order", events);
      const m1 = events[1];
      const m2 = events[2];
      assert(
        m1.type === "message" && m2.type === "message" && m1.text === "a" && m2.text === "b" && m2.id === m1.id + 1,
        "emits_thinking_then_messages_then_done: messages carry text and incrementing ids",
        events
      );
      const done = events[3];
      assert(done.type === "done" && done.status === "ego_reply", "emits_thinking_then_messages_then_done: done carries status");
      const id = appUpdateId("r1");
      assert(
        calls.started.join() === String(id) && calls.completed.length === 1 && calls.completed[0][0] === id && calls.completed[0][1] === "ego_reply",
        "emits_thinking_then_messages_then_done: update marked started and completed under the app id",
        calls
      );
      const t = calls.turns[0];
      assert(
        t.chatId === 424242 && t.userId === 424242 && t.updateId === id && t.text === "hello" && t.inputMode === "text" && t.date instanceof Date && t.replyTo === undefined,
        "emits_thinking_then_messages_then_done: turn gets owner ids, app update id and input",
        t
      );
      assert(
        calls.logged.length === 1 && calls.logged[0].join("|") === "hello|text|r1",
        "emits_thinking_then_messages_then_done: user message logged to shared history",
        calls.logged
      );
      assert(fetchCalls.length === 0, "emits_thinking_then_messages_then_done: no Telegram API call");
    }

    // edit_and_buttons_map_to_events
    {
      fetchCalls = [];
      const { deps } = makeDeps(async () => {
        await sendTelegramMessage(1, "card", markup);
        await editTelegramMessage(1, 99, "edited", markup);
        await removeTelegramInlineKeyboard(1, 99);
        await answerTelegramCallback("cb", "Undone");
        await sendTelegramDocument(1, "a,b\n1,2", "export.csv", "Your export");
        return { completionStatus: "ok" };
      });
      const events = await collect(deps, { text: "x", inputMode: "text", requestId: "r2" });
      const expectedButtons = [[{ text: "Undo", data: "undo:1" }, { text: "Edit", data: "edit:1" }]];
      assert(
        events.map((e) => e.type).join(",") === "thinking,message,edit,buttons_removed,toast,document,done",
        "edit_and_buttons_map_to_events: event order",
        events
      );
      const msg = events[1];
      assert(
        msg.type === "message" && JSON.stringify(msg.buttons) === JSON.stringify(expectedButtons),
        "edit_and_buttons_map_to_events: inline keyboard becomes buttons",
        msg
      );
      const edit = events[2];
      assert(
        edit.type === "edit" && edit.id === 99 && edit.text === "edited" && JSON.stringify(edit.buttons) === JSON.stringify(expectedButtons),
        "edit_and_buttons_map_to_events: edit carries id, text and buttons",
        edit
      );
      const rk = events[3];
      assert(rk.type === "buttons_removed" && rk.id === 99, "edit_and_buttons_map_to_events: keyboard removal", rk);
      const toast = events[4];
      assert(toast.type === "toast" && toast.text === "Undone", "edit_and_buttons_map_to_events: callback answer becomes toast", toast);
      const doc = events[5];
      assert(
        doc.type === "document" && doc.filename === "export.csv" && doc.content === "a,b\n1,2" && doc.caption === "Your export",
        "edit_and_buttons_map_to_events: document",
        doc
      );
      assert(fetchCalls.length === 0, "edit_and_buttons_map_to_events: no Telegram API call");
    }

    // typing_action_becomes_thinking
    {
      const { deps } = makeDeps(async () => {
        await sendTelegramChatAction(1, "typing");
        return { completionStatus: "ok" };
      });
      const events = await collect(deps, { text: "x", inputMode: "text", requestId: "r-typing" });
      assert(
        events.map((e) => e.type).join(",") === "thinking,thinking,done",
        "typing_action_becomes_thinking: chat action emits thinking",
        events
      );
    }

    // duplicate_request_runs_once
    {
      const { deps, calls } = makeDeps(async () => ({ completionStatus: "ok" }), { processed: true });
      const events = await collect(deps, { text: "x", inputMode: "text", requestId: "r3" });
      assert(calls.turns.length === 0, "duplicate_request_runs_once: turn not called");
      assert(
        events.map((e) => e.type).join(",") === "thinking,done" &&
          events[1].type === "done" && events[1].status === "duplicate",
        "duplicate_request_runs_once: stream emits thinking then done with status duplicate",
        events
      );
      assert(
        calls.started.length === 0 && calls.completed.length === 0 && calls.logged.length === 0,
        "duplicate_request_runs_once: nothing marked or logged",
        calls
      );
    }

    // turn_throw_emits_error_and_marks_failed
    {
      const { deps, calls } = makeDeps(async () => {
        await sendTelegramMessage(1, "partial");
        throw new Error("boom");
      });
      const events = await collect(deps, { text: "x", inputMode: "voice", requestId: "r4" });
      const last = events[events.length - 1];
      assert(
        events.map((e) => e.type).join(",") === "thinking,message,error",
        "turn_throw_emits_error_and_marks_failed: stream ends with error",
        events
      );
      assert(last.type === "error" && last.message.length > 0, "turn_throw_emits_error_and_marks_failed: error has a message");
      assert(
        calls.failed.length === 1 && calls.failed[0][0] === appUpdateId("r4") && calls.failed[0][1] === "boom",
        "turn_throw_emits_error_and_marks_failed: update marked failed with the error",
        calls
      );
      assert(calls.completed.length === 0, "turn_throw_emits_error_and_marks_failed: not marked completed");
    }

    // dedupe_store_failure_emits_error
    {
      const { deps, calls } = makeDeps(async () => ({ completionStatus: "ok" }));
      deps.alreadyProcessed = async () => {
        throw new Error("sheets down");
      };
      let threw = false;
      let events: AppEvent[] = [];
      try {
        events = await collect(deps, { text: "x", inputMode: "text", requestId: "r5" });
      } catch {
        threw = true;
      }
      assert(
        !threw && calls.turns.length === 0 && calls.failed.length === 0 &&
          events.map((e) => e.type).join(",") === "thinking,error",
        "dedupe_store_failure_emits_error: no throw, turn not run, not marked failed, error emitted",
        events
      );
    }

    // missing_owner_id_fails_closed
    {
      process.env.TELEGRAM_ALLOWED_USER_ID = "";
      const { deps, calls } = makeDeps(async () => ({ completionStatus: "ok" }));
      const events = await collect(deps, { text: "x", inputMode: "text", requestId: "r6" });
      process.env.TELEGRAM_ALLOWED_USER_ID = "424242";
      assert(
        calls.turns.length === 0 && events.length === 1 && events[0].type === "error",
        "missing_owner_id_fails_closed: turn not run, error emitted",
        events
      );
    }

    // app_channel_late_send_after_close_is_noop
    {
      fetchCalls = [];
      const events: AppEvent[] = [];
      const ch = createAppChannel((e) => events.push(e));
      let threw = false;
      try {
        await runInChannel(ch, async () => {
          await sendTelegramMessage(1, "before");
          ch.close();
          await new Promise((r) => setTimeout(r, 2));
          await sendTelegramMessage(1, "late");
          await editTelegramMessage(1, 5, "late edit");
          await removeTelegramInlineKeyboard(1, 5);
          await answerTelegramCallback("cb", "late");
          await sendTelegramDocument(1, "x", "x.csv");
          await sendTelegramChatAction(1, "typing");
        });
      } catch {
        threw = true;
      }
      assert(
        !threw && events.length === 1 && events[0].type === "message" && fetchCalls.length === 0,
        "app_channel_late_send_after_close_is_noop: nothing emitted or sent after close",
        events
      );
    }

    // app_channel_survives_throwing_emit
    {
      const ch = createAppChannel(() => {
        throw new Error("controller closed");
      });
      let threw = false;
      try {
        await runInChannel(ch, async () => {
          await sendTelegramMessage(1, "x");
        });
      } catch {
        threw = true;
      }
      assert(!threw, "app_channel_survives_throwing_emit: a failing sink does not break the turn");
    }

    // late_send_after_runAppTurn_returns_is_noop
    {
      let lateSend: Promise<void> | undefined;
      const { deps } = makeDeps(async () => {
        lateSend = (async () => {
          await new Promise((r) => setTimeout(r, 5));
          await sendTelegramMessage(1, "after done");
        })();
        return { completionStatus: "ok" };
      });
      const events = await collect(deps, { text: "x", inputMode: "text", requestId: "r7" });
      await lateSend;
      assert(
        events.map((e) => e.type).join(",") === "thinking,done",
        "late_send_after_runAppTurn_returns_is_noop: fire-and-forget send after done is dropped",
        events
      );
    }

    // html_parse_mode_is_stripped
    {
      const { deps } = makeDeps(async () => {
        await sendTelegramMessage(1, "<b>Total</b>: 5 &lt; 6 &amp; <i>ok</i>", undefined, "HTML");
        await editTelegramMessage(1, 3, "<code>x</code> &gt; y", undefined, "HTML");
        await sendTelegramMessage(1, "a <b> literal in Markdown");
        return { completionStatus: "ok" };
      });
      const events = await collect(deps, { text: "x", inputMode: "text", requestId: "r8" });
      const m = events[1];
      const e = events[2];
      const md = events[3];
      assert(
        m.type === "message" && m.text === "Total: 5 < 6 & ok",
        "html_parse_mode_is_stripped: HTML tags removed and entities decoded on send",
        m
      );
      assert(e.type === "edit" && e.text === "x > y", "html_parse_mode_is_stripped: same on edit", e);
      assert(
        md.type === "message" && md.text === "a <b> literal in Markdown",
        "html_parse_mode_is_stripped: Markdown text left untouched",
        md
      );
    }

    // encodeSse_frames
    {
      const frame = encodeSse({ type: "message", id: 1, text: "line1\nline2" });
      assert(frame.startsWith("data: "), "encodeSse_frames: starts with data:");
      assert(frame.endsWith("\n\n"), "encodeSse_frames: ends with a blank line");
      assert(
        frame.split("\n").length === 3 && JSON.parse(frame.slice(6).trim()).text === "line1\nline2",
        "encodeSse_frames: one data line holding the JSON (newlines escaped)"
      );
    }

    // egoTurnFromMessage_maps_telegram_message
    {
      const reply = { message_id: 7, text: "earlier", date: 1 } as unknown as NonNullable<EgoTurn["replyTo"]>;
      const message = {
        message_id: 10,
        date: 1_700_000_000,
        chat: { id: 555 },
        from: { id: 777 },
        reply_to_message: reply,
      } as unknown as Parameters<typeof egoTurnFromMessage>[0]["message"];
      const t = egoTurnFromMessage({ message, chatId: 555, updateId: 12, text: "hi", inputMode: "voice" });
      assert(
        t.chatId === 555 && t.userId === 777 && t.updateId === 12 && t.text === "hi" && t.inputMode === "voice" &&
          t.date.getTime() === 1_700_000_000_000 && t.replyTo === reply,
        "egoTurnFromMessage_maps_telegram_message: ids, date and reply mapped",
        t
      );
    }
    {
      const real = appUpdateId("req-prune-1");
      assert(isShortLivedUpdateId(String(real)), "prune: a real app update id is pruned", real);
      assert(isShortLivedUpdateId(String(1e13)) && isShortLivedUpdateId(String(1e13 + 2 ** 40 - 1)), "prune: app id range bounds are pruned");
      assert(isShortLivedUpdateId("123456789012"), "prune: 12-digit Telegram id still pruned");
      assert(!isShortLivedUpdateId("9999999999999"), "prune: 13-digit id kept");
      assert(!isShortLivedUpdateId(String(1e13 + 2 ** 40)), "prune: 14-digit id past the app range kept");
      assert(!isShortLivedUpdateId("1234567890123456"), "prune: all-digit 16-char Gmail id kept");
      assert(!isShortLivedUpdateId("18c2f1a9b3d4e5f6") && !isShortLivedUpdateId("") && !isShortLivedUpdateId("leave_now:1"), "prune: hex, empty and prefixed ids not matched by the numeric rule");
    }
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = originalToken;
    if (originalUser === undefined) delete process.env.TELEGRAM_ALLOWED_USER_ID;
    else process.env.TELEGRAM_ALLOWED_USER_ID = originalUser;
  }

  console.log(`\nPassed: ${totalPassed}, Failed: ${totalFailed}`);
  if (totalFailed > 0) process.exit(1);
}

runTests();
