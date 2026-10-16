/**
 * USD per 1M tokens. These are ESTIMATES used to track credit spend; the vendor
 * dashboards are the source of truth.
 *  - Gemini and Sonar: copied from scripts/bench/util.ts (vendor pages checked 2026-09-12).
 *  - Claude: Claude API model table, checked 2026-10-16 (Haiku 5.5 is $0.10/$0.50 for
 *    prompts up to 100K tokens).
 */
export const PRICING_AS_OF = "2026-10-16";

export const PRICING_PER_MILLION_TOKENS_USD: Record<string, { input: number; output: number }> = {
  "gemini-flash-lite-latest": { input: 0.3, output: 2.5 },
  "gemini-3.6-flash": { input: 0.75, output: 3.75 },
  sonar: { input: 1.0, output: 1.0 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "claude-sonnet-5-5": { input: 2.0, output: 10.0 },
  "claude-opus-5-5": { input: 4.0, output: 20.0 },
};

/**
 * Perplexity bills a per-request search fee ($5-12 per 1,000 requests). The top of the
 * range is used so the estimate errs toward switching early rather than late.
 */
export const PERPLEXITY_REQUEST_FEE_USD = 0.012;

/** Used for a model with no entry: deliberately expensive so spend is never under-counted. */
const CONSERVATIVE_DEFAULT = { input: 2.0, output: 10.0 };

export function costUsd(modelId: string, inputTokens: number, outputTokens: number): number {
  const price = PRICING_PER_MILLION_TOKENS_USD[modelId] ?? CONSERVATIVE_DEFAULT;
  const tokens = (inputTokens / 1_000_000) * price.input + (outputTokens / 1_000_000) * price.output;
  return modelId === "sonar" ? tokens + PERPLEXITY_REQUEST_FEE_USD : tokens;
}
