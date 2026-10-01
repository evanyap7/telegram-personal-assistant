/**
 * Intent Test Runner
 *
 * Runs representative natural language test messages through parseAssistantIntent()
 * and verifies expected action classification, measuring accuracy and latency.
 *
 * Usage:
 *   node --experimental-strip-types --import ./scripts/bench/register.mjs scripts/test-intents.ts
 *   node --experimental-strip-types --import ./scripts/bench/register.mjs scripts/test-intents.ts --dry-run
 */

import { parseAssistantIntent } from "../lib/assistant-intent";
import { loadEnvLocal } from "./bench/util";

export interface IntentTestCase {
  message: string;
  expectedAction: string;
  description?: string;
}

export const TEST_CASES: IntentTestCase[] = [
  { message: "spent $6.20 for lunch", expectedAction: "finance_add", description: "Expense with amount and description" },
  { message: "spent 23.50 SGD on groceries", expectedAction: "finance_add", description: "Expense with explicit currency" },
  { message: "earned $100 from freelance work", expectedAction: "finance_add", description: "Income transaction" },
  { message: "Add gym tomorrow", expectedAction: "calendar_add", description: "All-day calendar event" },
  { message: "Schedule floorball tomorrow from 8 pm to 9:30 pm", expectedAction: "calendar_add", description: "Timed calendar event" },
  { message: "Add a project meeting next Friday from 2 pm to 3 pm in work", expectedAction: "calendar_add", description: "Calendar event in work calendar" },
  { message: "What's on my calendar today?", expectedAction: "calendar_view", description: "Calendar view query" },
  { message: "how much did I spend this month?", expectedAction: "finance_summary", description: "Finance summary query" },
  { message: "delete my coffee expense", expectedAction: "finance_delete_search", description: "Finance delete search" },
  { message: "Add buy groceries to my to-do list", expectedAction: "todo_add", description: "Add todo task" },
  { message: "Remind me to call John today", expectedAction: "todo_add", description: "Add todo reminder" },
  { message: "I'm done with buy groceries", expectedAction: "todo_complete", description: "Complete todo task" },
  { message: "Draft an email to alex@example.com about project update", expectedAction: "email_draft", description: "Compose email draft" },
  { message: "delete gym tomorrow from personal", expectedAction: "calendar_delete_search", description: "Calendar delete search" },
  { message: "split $60 bill with Alice and Bob", expectedAction: "split_bill", description: "Bill splitting calculation" },
  { message: "who owes me money?", expectedAction: "iou_summary", description: "IOU summary check" },
  { message: "when am I free tomorrow?", expectedAction: "calendar_free_slots", description: "Free slot query" },
  { message: "move my gym session to 5pm tomorrow", expectedAction: "calendar_reschedule", description: "Calendar event reschedule" },
  { message: "remember that Alice's birthday is June 15", expectedAction: "memory_save", description: "Personal memory save" },
  { message: "what is Alice's birthday?", expectedAction: "memory_recall", description: "Personal memory recall" },
  { message: "how much did I spend on Grab this month?", expectedAction: "finance_query", description: "Natural language finance query" },
  { message: "remind me to pay rent on the 1st every month", expectedAction: "recurring_add", description: "Recurring monthly task" },
  { message: "log Spotify $11.98 every month", expectedAction: "recurring_add", description: "Recurring subscription" },
  { message: "show my subscriptions", expectedAction: "recurring_view", description: "View recurring schedules" },
  { message: "set my monthly budget to $600", expectedAction: "budget_set", description: "Set overall budget" },
  { message: "cap dining at $150 a month", expectedAction: "budget_set", description: "Set category cap" },
  { message: "I'm going to the gym", expectedAction: "workout_start", description: "Workout start greeting" },
  { message: "going to school gym", expectedAction: "workout_start", description: "Workout start with location" },
  { message: "show my workout stats", expectedAction: "workout_view", description: "Workout progression view" },
  { message: "undo", expectedAction: "undo", description: "Conversational undo" },
  { message: "add to my todo list: 1. buy milk 2. do laundry", expectedAction: "todo_add", description: "Multi-item todo batch add" },
];

async function run() {
  loadEnvLocal();
  const isDryRun = process.argv.includes("--dry-run") || !process.env.GOOGLE_GENERATIVE_AI_API_KEY;

  console.log("\n=======================================================");
  console.log("  Telegram Assistant Intent Test Runner");
  console.log("=======================================================");
  console.log(`Mode: ${isDryRun ? "Dry-run / Fixture Validation" : "Live Model Evaluation"}`);
  console.log(`Test cases: ${TEST_CASES.length}\n`);

  if (isDryRun) {
    console.log("Validating fixture test cases structure...");
    let validCount = 0;
    for (const testCase of TEST_CASES) {
      if (!testCase.message || !testCase.expectedAction) {
        console.error(`❌ Invalid test case: ${JSON.stringify(testCase)}`);
        process.exit(1);
      }
      validCount++;
    }
    console.log(`✅ All ${validCount} test cases validated successfully in dry-run mode.`);
    console.log("To run live intent classification, provide GOOGLE_GENERATIVE_AI_API_KEY in .env.local.\n");
    return;
  }

  let passed = 0;
  let failed = 0;
  const latencies: number[] = [];

  for (const testCase of TEST_CASES) {
    const start = performance.now();
    try {
      const intent = await parseAssistantIntent(testCase.message);
      const elapsed = performance.now() - start;
      latencies.push(elapsed);

      const isMatch = intent.action === testCase.expectedAction;
      if (isMatch) {
        passed++;
        console.log(`  ✅ [${elapsed.toFixed(0)}ms] "${testCase.message}" -> ${intent.action}`);
      } else {
        failed++;
        console.log(
          `  ❌ [${elapsed.toFixed(0)}ms] "${testCase.message}" -> Expected ${testCase.expectedAction}, got ${intent.action}`
        );
      }
    } catch (err) {
      failed++;
      console.log(`  ❌ [FAILED] "${testCase.message}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const avgLatency = latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0;
  console.log("\n-------------------------------------------------------");
  console.log(`Results: ${passed} passed, ${failed} failed (${((passed / TEST_CASES.length) * 100).toFixed(1)}% accuracy)`);
  console.log(`Avg Latency: ${avgLatency.toFixed(0)}ms`);
  console.log("-------------------------------------------------------\n");

  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error("Test runner crashed:", err);
  process.exit(1);
});
