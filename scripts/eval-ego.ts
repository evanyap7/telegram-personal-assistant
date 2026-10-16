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
