/**
 * Small shared helpers for the benchmark scripts in scripts/bench/.
 * No external dependencies — only what's already in package.json.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Minimal .env.local loader so these scripts work the same way regardless
 * of how they're invoked (plain node, tsx, ts-node) without depending on
 * `node --env-file` support or adding a dotenv dependency. Mirrors what
 * Next.js already does for the app itself. Existing process.env values win.
 */
export function loadEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!existsSync(envPath)) return;

  const content = readFileSync(envPath, "utf-8");
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) continue;

    const key = line.slice(0, eqIdx).trim();
    let value = line.slice(eqIdx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

export function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return NaN;
  const idx = Math.ceil((p / 100) * sortedAsc.length) - 1;
  return sortedAsc[Math.min(Math.max(idx, 0), sortedAsc.length - 1)];
}

export type LatencyStats = {
  n: number;
  minMs: number;
  meanMs: number;
  medianMs: number;
  p95Ms: number;
  maxMs: number;
};

export function summarize(latenciesMs: number[]): LatencyStats {
  const sorted = [...latenciesMs].sort((a, b) => a - b);
  const mean = sorted.reduce((a, b) => a + b, 0) / (sorted.length || 1);
  return {
    n: sorted.length,
    minMs: sorted[0] ?? NaN,
    meanMs: mean,
    medianMs: percentile(sorted, 50),
    p95Ms: percentile(sorted, 95),
    maxMs: sorted[sorted.length - 1] ?? NaN,
  };
}

export function fmt(ms: number): string {
  return `${ms.toFixed(0)}ms`;
}

export function printStats(label: string, stats: LatencyStats): void {
  console.log(
    `${label.padEnd(28)} n=${String(stats.n).padEnd(3)} min=${fmt(stats.minMs).padEnd(7)} ` +
      `mean=${fmt(stats.meanMs).padEnd(7)} median=${fmt(stats.medianMs).padEnd(7)} ` +
      `p95=${fmt(stats.p95Ms).padEnd(7)} max=${fmt(stats.maxMs)}`
  );
}

/**
 * Published per-1M-token pricing (paid tier), checked against the vendors'
 * own pricing pages on 2026-09-12. Re-verify before quoting these on a CV —
 * these prices change.
 *   - Gemini: https://ai.google.dev/gemini-api/docs/pricing
 *   - Perplexity Sonar: https://docs.perplexity.ai/getting-started/pricing
 *
 * "gemini-flash-lite-latest" aliases to the newest Flash-Lite release
 * (Gemini 3.5 Flash-Lite as of this writing). "gemini-3.6-flash" is pinned
 * to that specific version in the code, priced the same as 3.7/3.8 Flash
 * through end of 2026 per Google's page.
 */
export const PRICING_PER_MILLION_TOKENS_USD: Record<
  string,
  { input: number; output: number; note: string }
> = {
  "gemini-flash-lite-latest": {
    input: 0.3,
    output: 2.5,
    note: "Gemini 3.5 Flash-Lite pricing (alias target as of 2026-09-12)",
  },
  "gemini-3.6-flash": {
    input: 0.75,
    output: 3.75,
    note: "Through Dec 31, 2026; rises to $1.50 / $7.50 from 2027-01-01",
  },
  sonar: {
    input: 1.0,
    output: 1.0,
    note: "Excludes Perplexity's $5-12 per 1,000-request search-context fee",
  },
};

export function estimateCostUsd(
  model: keyof typeof PRICING_PER_MILLION_TOKENS_USD,
  inputTokens: number,
  outputTokens: number
): number {
  const pricing = PRICING_PER_MILLION_TOKENS_USD[model];
  if (!pricing) throw new Error(`No pricing entry for model "${model}"`);
  return (
    (inputTokens / 1_000_000) * pricing.input +
    (outputTokens / 1_000_000) * pricing.output
  );
}

/**
 * Normalizes token usage across ai-sdk versions/providers, which have used
 * both {promptTokens, completionTokens} and {inputTokens, outputTokens}.
 */
export function normalizeUsage(
  usage:
    | {
        inputTokens?: number;
        outputTokens?: number;
        promptTokens?: number;
        completionTokens?: number;
      }
    | null
    | undefined
): {
  inputTokens: number;
  outputTokens: number;
} {
  return {
    inputTokens: usage?.inputTokens ?? usage?.promptTokens ?? 0,
    outputTokens: usage?.outputTokens ?? usage?.completionTokens ?? 0,
  };
}

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(
      `\nMissing required env var ${name}.\n` +
        `Run this script with your real .env.local loaded, e.g.:\n` +
        `  node --env-file=.env.local --experimental-strip-types scripts/bench/<script>.ts\n`
    );
    process.exit(1);
  }
  return v;
}
