/**
 * Compares latency AND real per-call $ cost across the Claude tiers
 * (Haiku, Sonnet, Opus) and Perplexity Sonar, using the EXACT production system prompt from
 * lib/assistant-intent.ts (buildIntentSystemPrompt) against the same set of
 * representative messages for each model.
 *
 * This is what backs a CV claim like "~80% lower inference cost" - it
 * measures real token usage from real API responses, combined with each
 * vendor's published per-token pricing (see scripts/bench/util.ts for the
 * pricing sources/date - re-verify before quoting on a CV, prices change).
 *
 * Usage:
 *   npx tsx scripts/bench/model-cost.ts
 *
 * Requires ANTHROPIC_API_KEY and, to include Sonar in the
 * comparison, PERPLEXITY_API_KEY. Missing the Perplexity key just skips
 * that column instead of failing the whole run.
 */

import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { perplexity } from "@ai-sdk/perplexity";
import { buildIntentSystemPrompt } from "../../lib/assistant-intent";
import { INTENT_TEST_MESSAGES } from "./fixtures";
import {
  requireEnv,
  summarize,
  printStats,
  estimateCostUsd,
  normalizeUsage,
  loadEnvLocal,
  PRICING_PER_MILLION_TOKENS_USD,
} from "./util";

loadEnvLocal();
requireEnv("ANTHROPIC_API_KEY");

const currentDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Singapore",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());
const currentTime = new Intl.DateTimeFormat("en-SG", {
  timeZone: "Asia/Singapore",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
  hour12: true,
}).format(new Date());

const systemPrompt = buildIntentSystemPrompt(currentDate, currentTime, "");

type ModelKey = keyof typeof PRICING_PER_MILLION_TOKENS_USD;

function resolveModel(key: ModelKey) {
  if (key === "sonar") return perplexity("sonar");
  return anthropic(key) as never;
}

async function benchModel(key: ModelKey) {
  const model = resolveModel(key);
  const latencies: number[] = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let calls = 0;

  for (const message of INTENT_TEST_MESSAGES) {
    const start = performance.now();
    try {
      const result = await generateText({
        model,
        system: systemPrompt,
        prompt: message,
        maxOutputTokens: 4096,
        ...(key === "sonar" ? { temperature: 0 } : {}),
      });
      const elapsed = performance.now() - start;
      latencies.push(elapsed);
      const usage = normalizeUsage(result.usage);
      totalInputTokens += usage.inputTokens;
      totalOutputTokens += usage.outputTokens;
      calls++;
    } catch (err) {
      console.log(`  [${key}] FAILED on "${message}": ${err}`);
    }
  }

  const avgInputTokens = calls ? totalInputTokens / calls : 0;
  const avgOutputTokens = calls ? totalOutputTokens / calls : 0;
  const avgCostUsd = calls
    ? estimateCostUsd(key, avgInputTokens, avgOutputTokens)
    : NaN;

  return {
    key,
    stats: summarize(latencies),
    avgInputTokens,
    avgOutputTokens,
    avgCostUsd,
    calls,
  };
}

async function main() {
  const keysToRun: ModelKey[] = ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"];
  if (process.env.PERPLEXITY_API_KEY) {
    keysToRun.push("sonar");
  } else {
    console.log("PERPLEXITY_API_KEY not set - skipping Sonar in this comparison.\n");
  }

  console.log(
    `Benchmarking ${keysToRun.length} model(s) over ${INTENT_TEST_MESSAGES.length} messages each (real API calls)...\n`
  );

  const results = [];
  for (const key of keysToRun) {
    console.log(`Running ${key}...`);
    results.push(await benchModel(key));
  }

  console.log("\n--- Latency ---");
  for (const r of results) printStats(r.key, r.stats);

  console.log("\n--- Cost per classification call (avg tokens x published pricing) ---");
  for (const r of results) {
    console.log(
      `${r.key.padEnd(28)} avg_input=${r.avgInputTokens.toFixed(0).padEnd(5)} ` +
        `avg_output=${r.avgOutputTokens.toFixed(0).padEnd(4)} ` +
        `avg_cost=$${r.avgCostUsd.toFixed(6)}`
    );
  }

  const baseline = results.find((r) => r.key === "claude-haiku-5-5");
  if (baseline) {
    console.log("\n--- Cost reduction vs each other model ---");
    for (const r of results) {
      if (r.key === baseline.key) continue;
      const reduction = (1 - baseline.avgCostUsd / r.avgCostUsd) * 100;
      console.log(
        `Haiku is ${reduction.toFixed(1)}% cheaper per call than ${r.key}`
      );
    }
  }

  console.log(
    "\nNote: pricing constants are hardcoded in scripts/bench/util.ts with a source " +
      "and date - re-check the vendor pricing pages before quoting a % figure publicly."
  );
}

main().catch((err) => {
  console.error("Benchmark crashed:", err);
  process.exit(1);
});
