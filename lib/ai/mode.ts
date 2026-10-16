export type Provider = "anthropic" | "perplexity" | "gemini";
export type Role = "classifier" | "parse" | "agent" | "vision" | "search" | "audio";
export type ErrorKind = "depleted" | "transient" | "other";

export interface BalanceStatus {
  /** What the user said the dashboard balance was when they last ran /credits set; null if never set. */
  startBalanceUsd: number | null;
  /** Estimated spend since that balance was set. */
  spentUsd: number;
}

export interface Candidate {
  provider: Provider;
  modelId: string;
}

/** 0 = no warning yet; 10 = at most 10% left; 5 = at most 5% left. */
export type WarningLevel = 0 | 10 | 5;

const SEVERITY: Record<WarningLevel, number> = { 0: 0, 10: 1, 5: 2 };

export function isMoreSevere(a: WarningLevel, b: WarningLevel): boolean {
  return SEVERITY[a] > SEVERITY[b];
}

export function remainingUsd(s: BalanceStatus): number | null {
  return s.startBalanceUsd === null ? null : s.startBalanceUsd - s.spentUsd;
}

export function remainingFraction(s: BalanceStatus): number | null {
  if (s.startBalanceUsd === null) return null;
  if (s.startBalanceUsd <= 0) return 0;
  return Math.max(0, (s.startBalanceUsd - s.spentUsd) / s.startBalanceUsd);
}

/** The most severe warning level reached. An unknown balance never warns. */
export function warningLevel(s: BalanceStatus): WarningLevel {
  const fraction = remainingFraction(s);
  if (fraction === null) return 0;
  if (fraction <= 0.05 + 1e-9) return 5;
  if (fraction <= 0.1 + 1e-9) return 10;
  return 0;
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

const claude = (modelId: string): Candidate => ({ provider: "anthropic", modelId });

const HAIKU = "claude-haiku-5-5";
const SONNET = "claude-sonnet-5-5";
const OPUS = "claude-opus-5-5";

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
 * Ordered models to try for a role: Claude's tier chain, with Perplexity Sonar first for
 * search unless its breaker is open or its key is missing. Audio is the one job Claude
 * cannot do, so it uses Gemini and never falls to Claude.
 */
export function candidatesFor(
  role: Role,
  available: Record<Provider, boolean>,
  perplexityDown: boolean
): Candidate[] {
  if (role === "audio") {
    return available.gemini ? [{ provider: "gemini", modelId: "gemini-3.6-flash" }] : [];
  }
  const claudeCandidates = available.anthropic ? claudeChain(role) : [];
  const web: Candidate[] =
    role === "search" && available.perplexity && !perplexityDown
      ? [{ provider: "perplexity", modelId: "sonar" }]
      : [];
  return [...web, ...claudeCandidates];
}
