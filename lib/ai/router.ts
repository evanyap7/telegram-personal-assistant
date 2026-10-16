import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import { perplexity } from "@ai-sdk/perplexity";
import { generateText, type LanguageModel } from "ai";
import { sendTelegramMessage } from "../telegram";
import { createLedger, type Ledger, type LedgerState } from "./ledger";
import {
  candidatesFor,
  classifyError,
  providerFlags,
  type Candidate,
  type Provider,
  type Role,
} from "./mode";
import { costUsd } from "./pricing";
import { createSheetsLedgerStore } from "./sheets-store";

type GenerateTextParams = Parameters<typeof generateText>[0];
export type RoutedParams = Omit<GenerateTextParams, "model">;
type ProviderOptions = Record<string, Record<string, unknown>>;

/** Claude 5.5 models think by default, and thinking counts toward max tokens, so tiny limits cut answers off. */
export const CLAUDE_MIN_OUTPUT_TOKENS = 4096;
const USAGE_WRITE_TIMEOUT_MS = 2000;

export interface ModelHandle {
  model: LanguageModel;
  provider: Provider;
  modelId: string;
  role: Role;
  isClaude: boolean;
  providerOptions?: ProviderOptions;
  /** Sampling settings that are safe for this model (Claude 5.5 rejects non-default temperature). */
  sampling(temperature: number): { temperature?: number };
}

export class NoModelAvailableError extends Error {
  role: Role;
  constructor(role: Role) {
    super(`No AI model is available for "${role}" right now.`);
    this.name = "NoModelAvailableError";
    this.role = role;
  }
}

export function buildHandle(
  c: Candidate,
  role: Role,
  makeModel: (c: Candidate) => LanguageModel
): ModelHandle {
  const isClaude = c.provider === "anthropic";
  return {
    model: makeModel(c),
    provider: c.provider,
    modelId: c.modelId,
    role,
    isClaude,
    providerOptions:
      isClaude && (role === "classifier" || role === "parse") ? { anthropic: { effort: "low" } } : undefined,
    sampling: (temperature) => (isClaude ? {} : { temperature }),
  };
}

export function mergeProviderOptions(
  a: ProviderOptions | undefined,
  b: ProviderOptions | undefined
): ProviderOptions | undefined {
  if (!a && !b) return undefined;
  const out: ProviderOptions = { ...(a ?? {}) };
  for (const [key, value] of Object.entries(b ?? {})) {
    out[key] = { ...(out[key] ?? {}), ...value };
  }
  return out;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export interface RouterDeps {
  ledger: Pick<Ledger, "getState" | "markDepleted" | "recordUsage">;
  available(): Record<Provider, boolean>;
  makeModel(c: Candidate): LanguageModel;
  generate: typeof generateText;
}

const DEFAULT_STATE: LedgerState = {
  mode: "credits",
  gemini: { startBalanceUsd: null, spentUsd: 0, depleted: false },
  perplexity: { startBalanceUsd: null, spentUsd: 0, depleted: false },
};

export function createRouter(deps: RouterDeps) {
  async function currentState(): Promise<LedgerState> {
    try {
      return await deps.ledger.getState();
    } catch (error) {
      console.warn("AI credit ledger unavailable; using default routing:", error);
      return DEFAULT_STATE;
    }
  }

  async function recordModelUsage(
    handle: ModelHandle,
    usage: { inputTokens?: number; outputTokens?: number } | undefined
  ): Promise<void> {
    const inputTokens = usage?.inputTokens ?? 0;
    const outputTokens = usage?.outputTokens ?? 0;
    await withTimeout(
      deps.ledger.recordUsage({
        timestamp: new Date().toISOString(),
        provider: handle.provider,
        model: handle.modelId,
        inputTokens,
        outputTokens,
        costUsd: costUsd(handle.modelId, inputTokens, outputTokens),
        role: handle.role,
      }),
      USAGE_WRITE_TIMEOUT_MS
    ).catch(() => {});
  }

  /** One text generation on one model, with Claude-safe parameters, then usage recording. */
  async function runText(handle: ModelHandle, params: RoutedParams) {
    const { temperature, maxOutputTokens, providerOptions, ...rest } = params as Record<string, unknown> & {
      temperature?: number;
      maxOutputTokens?: number;
      providerOptions?: ProviderOptions;
    };
    const call: Record<string, unknown> = { ...rest, model: handle.model };
    if (temperature !== undefined) Object.assign(call, handle.sampling(temperature));
    if (handle.isClaude) {
      call.maxOutputTokens = Math.max(maxOutputTokens ?? 0, CLAUDE_MIN_OUTPUT_TOKENS);
    } else if (maxOutputTokens !== undefined) {
      call.maxOutputTokens = maxOutputTokens;
    }
    const merged = mergeProviderOptions(providerOptions, handle.providerOptions);
    if (merged) call.providerOptions = merged;

    const result = await deps.generate(call as GenerateTextParams);
    await recordModelUsage(handle, result.usage);
    return result;
  }

  /**
   * Runs `attempt` on each candidate model for the role until one succeeds. Credits-depleted
   * errors mark the provider and skip its remaining models. `canRetry` lets callers forbid a
   * retry once side effects happened (agents that already ran a tool).
   */
  async function withModelFallback<T>(
    role: Role,
    attempt: (handle: ModelHandle) => Promise<T>,
    opts: { canRetry?: () => boolean } = {}
  ): Promise<{ result: T; handle: ModelHandle }> {
    const state = await currentState();
    const available = deps.available();
    const candidates = candidatesFor(
      role,
      state.mode,
      providerFlags(state.gemini, state.perplexity, role, available.anthropic),
      available
    );
    if (candidates.length === 0) throw new NoModelAvailableError(role);

    const skipped = new Set<Provider>();
    let lastError: unknown;
    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];
      if (skipped.has(candidate.provider)) continue;
      const handle = buildHandle(candidate, role, deps.makeModel);
      try {
        return { result: await attempt(handle), handle };
      } catch (error) {
        lastError = error;
        if (classifyError(error) === "depleted") {
          skipped.add(candidate.provider);
          if (candidate.provider !== "anthropic") {
            await deps.ledger.markDepleted(candidate.provider).catch(() => {});
          }
        }
        const hasNext = candidates.slice(i + 1).some((next) => !skipped.has(next.provider));
        if (!hasNext || (opts.canRetry && !opts.canRetry())) throw error;
        console.warn(`AI call failed on ${candidate.provider}/${candidate.modelId} (${role}); trying the next model:`, error);
      }
    }
    throw lastError;
  }

  async function generateTextRouted(
    role: Role,
    params: RoutedParams,
    opts: { canRetry?: () => boolean } = {}
  ) {
    return withModelFallback(role, (handle) => runText(handle, params), opts);
  }

  return { withModelFallback, runText, generateTextRouted, recordModelUsage };
}

// ---- default wiring ----

function makeModel(c: Candidate): LanguageModel {
  switch (c.provider) {
    case "gemini":
      return google(c.modelId);
    case "perplexity":
      return perplexity(c.modelId);
    case "anthropic":
      // @ai-sdk/anthropic bundles a newer copy of @ai-sdk/provider (4.0.28) than the other
      // AI SDK packages (4.0.9). Same v4 spec at runtime; only the nominal types differ.
      return anthropic(c.modelId) as unknown as LanguageModel;
  }
}

async function notifyAllowedUser(text: string): Promise<void> {
  const chatId = Number(process.env.TELEGRAM_ALLOWED_USER_ID);
  if (chatId) await sendTelegramMessage(chatId, text, undefined, null);
}

export const aiLedger: Ledger = createLedger({
  store: createSheetsLedgerStore(),
  now: () => new Date(),
  notify: notifyAllowedUser,
});

const defaultRouter = createRouter({
  ledger: aiLedger,
  available: () => ({
    gemini: Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY),
    perplexity: Boolean(process.env.PERPLEXITY_API_KEY),
    anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
  }),
  makeModel,
  generate: generateText,
});

export const { withModelFallback, runText, generateTextRouted, recordModelUsage } = defaultRouter;
