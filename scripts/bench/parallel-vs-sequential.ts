/**
 * Measures the real wall-clock benefit of the Promise.allSettled() batch
 * pattern used in lib/paylah-sync.ts (syncPayLahTransactions), by running
 * the SAME real Gemini receipt-parsing calls (buildEmailParsingSystemPrompt,
 * the exact production prompt) once sequentially and once in parallel over
 * an identical batch of fixture emails.
 *
 * This is what backs a CV claim like "parallel batch execution reduced
 * synchronization latency by X%".
 *
 * Usage:
 *   npx tsx scripts/bench/parallel-vs-sequential.ts
 *
 * Requires GOOGLE_GENERATIVE_AI_API_KEY.
 */

import { generateText } from "ai";
import { google } from "@ai-sdk/google";
import { buildEmailParsingSystemPrompt } from "../../lib/paylah-sync";
import { RECEIPT_EMAIL_FIXTURES } from "./fixtures";
import { requireEnv, loadEnvLocal } from "./util";

loadEnvLocal();
requireEnv("GOOGLE_GENERATIVE_AI_API_KEY");

const systemPrompt = buildEmailParsingSystemPrompt();
const model = google("gemini-flash-lite-latest");

async function classifyOne(fixture: { subject: string; body: string }) {
  const prompt = `Email Subject: "${fixture.subject}"\nEmail Body/Snippet:\n"""\n${fixture.body}\n"""`;
  const result = await generateText({
    model,
    system: systemPrompt,
    prompt,
    temperature: 0,
  });
  return result.text;
}

async function runSequential() {
  const start = performance.now();
  for (const fixture of RECEIPT_EMAIL_FIXTURES) {
    await classifyOne(fixture);
  }
  return performance.now() - start;
}

async function runParallel() {
  const start = performance.now();
  await Promise.allSettled(RECEIPT_EMAIL_FIXTURES.map((f) => classifyOne(f)));
  return performance.now() - start;
}

async function main() {
  const n = RECEIPT_EMAIL_FIXTURES.length;
  console.log(`Benchmarking ${n} real Gemini receipt-parsing calls: sequential vs Promise.allSettled...\n`);

  console.log("Running sequential batch (for-loop with await, one at a time)...");
  const sequentialMs = await runSequential();
  console.log(`  sequential total: ${sequentialMs.toFixed(0)}ms\n`);

  console.log("Running parallel batch (Promise.allSettled, as in lib/paylah-sync.ts)...");
  const parallelMs = await runParallel();
  console.log(`  parallel total:   ${parallelMs.toFixed(0)}ms\n`);

  const reduction = (1 - parallelMs / sequentialMs) * 100;
  console.log("--- Result ---");
  console.log(`Batch size:            ${n} emails`);
  console.log(`Sequential:            ${sequentialMs.toFixed(0)}ms (${(sequentialMs / n).toFixed(0)}ms/email avg)`);
  console.log(`Parallel (allSettled): ${parallelMs.toFixed(0)}ms`);
  console.log(`Latency reduction:     ${reduction.toFixed(1)}%`);
  console.log(
    "\nRun this a few times and with a larger fixture batch (edit RECEIPT_EMAIL_FIXTURES in " +
      "scripts/bench/fixtures.ts) - single-run numbers are noisy due to normal API latency variance."
  );
}

main().catch((err) => {
  console.error("Benchmark crashed:", err);
  process.exit(1);
});
