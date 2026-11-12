/**
 * Unit Test Suite for the app output channel (Telegram diversion)
 *
 * Usage:
 *   node --experimental-strip-types --import ./scripts/bench/register.mjs scripts/test-app-channel.ts
 */

import { runInChannel, type OutputChannel } from "../lib/channel";
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

function assert(condition: boolean, testName: string) {
  if (condition) {
    console.log(`  ✅ PASS: ${testName}`);
    totalPassed++;
  } else {
    console.error(`  ❌ FAIL: ${testName}`);
    totalFailed++;
  }
}

function makeChannel(log: string[], tag = "") {
  let closed = false;
  const channel: OutputChannel & { close(): void } = {
    send(text, markup) {
      if (!closed) log.push(`${tag}send:${text}:${markup ? "m" : "-"}`);
      return 7;
    },
    edit(id, text, markup) {
      if (!closed) log.push(`${tag}edit:${id}:${text}:${markup ? "m" : "-"}`);
    },
    removeKeyboard(id) {
      if (!closed) log.push(`${tag}rk:${id}`);
    },
    answerCallback(text) {
      if (!closed) log.push(`${tag}cb:${text ?? ""}`);
    },
    document(filename, content, caption) {
      if (!closed) log.push(`${tag}doc:${filename}:${content}:${caption ?? ""}`);
    },
    action(kind) {
      if (!closed) log.push(`${tag}act:${kind}`);
    },
    close() {
      closed = true;
    },
  };
  return channel;
}

const markup: InlineKeyboardMarkup = { inline_keyboard: [[{ text: "Undo", callback_data: "undo" }]] };

async function runTests() {
  console.log("\n=======================================================");
  console.log("  Unit Tests: App Output Channel");
  console.log("=======================================================\n");

  const originalFetch = globalThis.fetch;
  const originalToken = process.env.TELEGRAM_BOT_TOKEN;
  process.env.TELEGRAM_BOT_TOKEN = "test-token";
  let fetchCalls: string[] = [];
  globalThis.fetch = (async (url: unknown) => {
    fetchCalls.push(String(url));
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;

  try {
    // diverts_send_inside_channel
    {
      fetchCalls = [];
      const log: string[] = [];
      await runInChannel(makeChannel(log), async () => {
        await sendTelegramMessage(1, "hi", markup);
      });
      assert(log.length === 1 && log[0] === "send:hi:m", "diverts_send_inside_channel: channel.send called once with markup");
      assert(fetchCalls.length === 0, "diverts_send_inside_channel: fetch not called");
    }

    // each_helper_diverts
    {
      fetchCalls = [];
      const log: string[] = [];
      await runInChannel(makeChannel(log), async () => {
        await editTelegramMessage(1, 5, "new", markup);
        await removeTelegramInlineKeyboard(1, 5);
        await answerTelegramCallback("cbid", "ok");
        await sendTelegramDocument(1, "a,b", "x.csv", "cap");
        await sendTelegramChatAction(1, "typing");
      });
      assert(
        log.join("|") === "edit:5:new:m|rk:5|cb:ok|doc:x.csv:a,b:cap|act:typing",
        "each_helper_diverts: all helpers reach matching channel methods"
      );
      assert(fetchCalls.length === 0, "each_helper_diverts: fetch not called");
    }

    // no_channel_is_unchanged
    {
      fetchCalls = [];
      await sendTelegramMessage(1, "plain");
      assert(
        fetchCalls.length === 1 && fetchCalls[0].endsWith("/sendMessage"),
        "no_channel_is_unchanged: fetch called once with sendMessage"
      );
    }

    // async_context_survives_promise_all
    {
      fetchCalls = [];
      const logA: string[] = [];
      const logB: string[] = [];
      await Promise.all([
        runInChannel(makeChannel(logA, "A"), async () => {
          await Promise.all([
            sendTelegramMessage(1, "one"),
            (async () => {
              await new Promise((r) => setTimeout(r, 5));
              await sendTelegramMessage(1, "two");
            })(),
          ]);
        }),
        runInChannel(makeChannel(logB, "B"), async () => {
          await new Promise((r) => setTimeout(r, 2));
          await sendTelegramMessage(1, "three");
        }),
      ]);
      assert(
        logA.length === 2 && logA.every((l) => l.startsWith("Asend:")),
        "async_context_survives_promise_all: both concurrent sends reach channel A"
      );
      assert(
        logB.length === 1 && logB[0] === "Bsend:three:-",
        "async_context_survives_promise_all: no cross-talk to channel B"
      );
      assert(fetchCalls.length === 0, "async_context_survives_promise_all: fetch not called");
    }

    // send_after_stream_close_is_safe
    {
      fetchCalls = [];
      const log: string[] = [];
      const ch = makeChannel(log);
      let threw = false;
      try {
        await runInChannel(ch, async () => {
          ch.close();
          await new Promise((r) => setTimeout(r, 2));
          await sendTelegramMessage(1, "late");
        });
      } catch {
        threw = true;
      }
      assert(!threw && log.length === 0 && fetchCalls.length === 0, "send_after_stream_close_is_safe: late send does not throw");
    }
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = originalToken;
  }

  console.log(`\nPassed: ${totalPassed}, Failed: ${totalFailed}`);
  if (totalFailed > 0) process.exit(1);
}

runTests();
