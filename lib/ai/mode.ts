export type Provider = "gemini" | "perplexity" | "anthropic";
export type Role = "classifier" | "parse" | "agent" | "vision" | "search" | "audio";
export type Mode = "credits" | "claude";
export type ErrorKind = "depleted" | "transient" | "other";

export interface ProviderStatus {
  /** What the user said the dashboard balance was when they last ran /credits set; null if never set. */
  startBalanceUsd: number | null;
  /** Estimated spend since that balance was set. */
  spentUsd: number;
  /** A depletion error was seen recently (circuit breaker). */
  depleted: boolean;
}

export interface Candidate {
  provider: Provider;
  modelId: string;
}

/** A provider at or below this fraction of its balance is treated as nearly out. */
export const SWITCH_THRESHOLD = 0.05;

export function remainingUsd(s: ProviderStatus): number | null {
  return s.startBalanceUsd === null ? null : s.startBalanceUsd - s.spentUsd;
}

export function remainingFraction(s: ProviderStatus): number | null {
  if (s.startBalanceUsd === null) return null;
  if (s.startBalanceUsd <= 0) return 0;
  return Math.max(0, (s.startBalanceUsd - s.spentUsd) / s.startBalanceUsd);
}

export function isNearlyOut(s: ProviderStatus, threshold: number = SWITCH_THRESHOLD): boolean {
  if (s.depleted) return true;
  const fraction = remainingFraction(s);
  return fraction !== null && fraction <= threshold + 1e-9;
}

/** Truly out: a depletion error was seen, or the known balance is spent. */
export function isExhausted(s: ProviderStatus): boolean {
  if (s.depleted) return true;
  const left = remainingUsd(s);
  return left !== null && left <= 0;
}

/** Global Claude mode: both providers nearly out. */
export function decideMode(gemini: ProviderStatus, perplexity: ProviderStatus): Mode {
  return isNearlyOut(gemini) && isNearlyOut(perplexity) ? "claude" : "credits";
}

/**
 * Which providers a role should skip right now. Text jobs skip a provider as soon as it is
 * nearly out, so its work moves to Claude before it starts failing; voice keeps using Gemini
 * until it is truly exhausted (Claude cannot take audio). Without a Claude key there is
 * nowhere to move work, so only real exhaustion skips a provider.
 */
export function providerFlags(
  gemini: ProviderStatus,
  perplexity: ProviderStatus,
  role: Role,
  claudeAvailable: boolean
): { gemini: boolean; perplexity: boolean } {
  const skip = role === "audio" || !claudeAvailable ? isExhausted : isNearlyOut;
  return { gemini: skip(gemini), perplexity: skip(perplexity) };
}

// ---- error classification ----

type ErrorLike = {
  statusCode?: number;
  status?: number;
  message?: string;
  responseBody?: unknown;
  lastError?: unknown;
  cause?: unknown;
};

/** Walks AI SDK RetryError / cause chains, keeping the innermost status code and all message text. */
function inspect(error: unknown): { status: number | undefined; text: string } {
  let status: number | undefined;
  const parts: string[] = [];
  if (typeof error === "string") parts.push(error);
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth++) {
    const e = current as ErrorLike;
    status = e.statusCode ?? e.status ?? status;
    if (e.message) parts.push(String(e.message));
    if (e.responseBody) parts.push(String(e.responseBody));
    current = e.lastError ?? e.cause;
  }
  return { status, text: parts.join(" ") };
}

const DEPLETED_PHRASES =
  /prepayment credits are depleted|insufficient (credits|quota|funds|balance)|out of credits|credit balance is too low|billing (account )?(is )?(not active|disabled)|payment required/i;
const CREDIT_WORDS = /credit|prepayment|quota|billing|insufficient|exhausted/i;
const RATE_LIMIT_WORDS = /per[- ]?(minute|second)|requests? per|rate[- ]?limit|retry in|too many requests/i;
const NETWORK_WORDS = /econnreset|etimedout|fetch failed|network|timeout|socket/i;

export function classifyError(error: unknown): ErrorKind {
  const { status, text } = inspect(error);
  if (status === 402) return "depleted";
  if (DEPLETED_PHRASES.test(text)) return "depleted";
  if (
    (status === 429 || status === 403 || status === 401) &&
    CREDIT_WORDS.test(text) &&
    !RATE_LIMIT_WORDS.test(text)
  ) {
    return "depleted";
  }
  if (status === 429 || status === 408 || (status !== undefined && status >= 500)) return "transient";
  if (status === undefined && NETWORK_WORDS.test(text)) return "transient";
  return "other";
}

// ---- candidate selection ----

const gemini = (modelId: string): Candidate => ({ provider: "gemini", modelId });
const perplexity = (modelId: string): Candidate => ({ provider: "perplexity", modelId });
const claude = (modelId: string): Candidate => ({ provider: "anthropic", modelId });

const HAIKU = "claude-haiku-5-5";
const SONNET = "claude-sonnet-5-5";
const OPUS = "claude-opus-5-5";

const PRIMARY: Record<Role, Candidate[]> = {
  classifier: [gemini("gemini-flash-lite-latest"), gemini("gemini-3.6-flash")],
  parse: [gemini("gemini-flash-lite-latest"), gemini("gemini-3.6-flash")],
  agent: [gemini("gemini-3.6-flash")],
  vision: [gemini("gemini-3.6-flash")],
  search: [perplexity("sonar"), gemini("gemini-3.6-flash")],
  audio: [gemini("gemini-3.6-flash")],
};

export function claudeChain(role: Role): Candidate[] {
  switch (role) {
    case "classifier":
    case "parse":
      return [claude(HAIKU), claude(SONNET), claude(OPUS)];
    case "agent":
    case "vision":
    case "search":
      return [claude(SONNET), claude(OPUS)];
    case "audio":
      return [];
  }
}

/**
 * Ordered models to try for a role. In claude mode Claude goes first; otherwise
 * Gemini/Perplexity go first with Claude as the tail. Audio never uses Claude.
 * `skipped` marks providers to leave out (see providerFlags).
 */
export function candidatesFor(
  role: Role,
  mode: Mode,
  skipped: { gemini: boolean; perplexity: boolean },
  available: Record<Provider, boolean>
): Candidate[] {
  const claudeCandidates = available.anthropic ? claudeChain(role) : [];
  if (mode === "claude" && claudeCandidates.length > 0) return claudeCandidates;
  const primaries = PRIMARY[role].filter(
    (c) => available[c.provider] && !(c.provider !== "anthropic" && skipped[c.provider])
  );
  return [...primaries, ...claudeCandidates];
}
