/**
 * Benchmarks the REAL, deployed parseAssistantIntent() path end-to-end
 * (including its Flash-Lite -> 3.6-Flash -> Sonar fallback chain exactly as
 * shipped) against a set of representative Telegram messages.
 *
 * This is what a CV bullet like "<750ms classification latency" or
 * "752ms classification latency" should be measured against — the actual
 * production function, not a synthetic reimplementation.
 *
 * Usage (from the repo root, with your real .env.local already filled in
 * exactly as it is for `npm run dev`):
 *   npx tsx scripts/bench/intent-latency.ts
 *
 * (tsx resolves this project's extensionless TypeScript imports the same
 * way Next.js's bundler does; plain `node --experimental-strip-types`
 * cannot resolve them and will fail with ERR_MODULE_NOT_FOUND.)
 *
 * Requires GOOGLE_GENERATIVE_AI_API_KEY (matches the app's normal .env.local).
 * Each run makes one real Gemini call per test message - this costs a small
 * amount of real API credit (a fraction of a cent total for the default
 * fixture list).
 */

import { parseAssistantIntent } from "../../lib/assistant-intent";
import { INTENT_TEST_MESSAGES } from "./fixtures";
import { requireEnv, summarize, printStats, loadEnvLocal } from "./util";

loadEnvLocal();
requireEnv("GOOGLE_GENERATIVE_AI_API_KEY");

const REPEATS = Number(process.env.BENCH_REPEATS || 3);

async function main() {
  console.log(
    `\nBenchmarking parseAssistantIntent() over ${INTENT_TEST_MESSAGES.length} messages x ${REPEATS} repeats ` +
      `(sequential, real API calls)...\n`
  );

  const latencies: number[] = [];
  const failures: Array<{ message: string; error: string }> = [];

  for (let round = 0; round < REPEATS; round++) {
    for (const message of INTENT_TEST_MESSAGES) {
      const start = performance.now();
      try {
        const intent = await parseAssistantIntent(message);
        const elapsed = performance.now() - start;
        latencies.push(elapsed);
        console.log(
          `  [${elapsed.toFixed(0)}ms] "${message}" -> ${intent.action}`
        );
      } catch (err) {
        failures.push({
          message,
          error: err instanceof Error ? err.message : String(err),
        });
        console.log(`  [FAILED] "${message}": ${err}`);
      }
    }
  }

  console.log("\n--- Results ---");
  printStats("parseAssistantIntent()", summarize(latencies));

  if (failures.length > 0) {
    console.log(`\n${failures.length} call(s) failed:`);
    for (const f of failures) console.log(`  - "${f.message}": ${f.error}`);
  }

  console.log(
    "\nCompare the median/p95 above against any latency figure before it goes on a CV."
  );
}

main().catch((err) => {
  console.error("Benchmark crashed:", err);
  process.exit(1);
});
