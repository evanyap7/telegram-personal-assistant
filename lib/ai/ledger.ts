import {
  isMoreSevere,
  remainingFraction,
  remainingUsd,
  warningLevel,
  type BalanceStatus,
  type Provider,
  type WarningLevel,
} from "./mode";
import { PRICING_AS_OF } from "./pricing";

/** Providers whose credit balance EGO tracks and warns about. */
export type CreditProvider = "anthropic" | "perplexity";
export const CREDIT_PROVIDERS: CreditProvider[] = ["anthropic", "perplexity"];

export interface UsageRow {
  timestamp: string;
  provider: Provider;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  role: string;
}

export interface BalanceRow {
  startBalanceUsd: number;
  setAt: string;
}

export interface AlertState {
  warnedLevel: WarningLevel;
  /** When the last real-depletion alert was sent (ISO). */
  alertedAt?: string;
}

export interface LedgerStore {
  readBalances(): Promise<Partial<Record<CreditProvider, BalanceRow>>>;
  readUsage(): Promise<UsageRow[]>;
  readAlertState(): Promise<Record<CreditProvider, AlertState>>;
  /** Sets a new balance and re-arms the warnings (warnedLevel back to 0, alertedAt cleared). */
  setBalance(provider: CreditProvider, usd: number, setAtIso: string): Promise<void>;
  setWarnedLevel(provider: CreditProvider, level: WarningLevel): Promise<void>;
  setAlertedAt(provider: CreditProvider, iso: string): Promise<void>;
  appendUsage(row: UsageRow): Promise<void>;
}

export interface Ledger {
  recordUsage(row: UsageRow): Promise<void>;
  /** Sends a Telegram warning when a balance first reaches 10% or 5% left. */
  checkWarnings(): Promise<void>;
  /** Urgent alert after a real "credits depleted" error; at most one per 30 minutes per provider. */
  alertDepleted(provider: CreditProvider): Promise<void>;
  setBalance(provider: CreditProvider, usd: number): Promise<void>;
  describe(): Promise<string>;
}

export const STATE_TTL_MS = 60_000;
export const ALERT_COOLDOWN_MS = 30 * 60_000;

const NAME: Record<CreditProvider, string> = { anthropic: "Claude", perplexity: "Perplexity" };
const COMMAND_NAME: Record<CreditProvider, string> = { anthropic: "claude", perplexity: "perplexity" };

/** Sum of recorded cost for one provider at or after `sinceIso` ("" means all time). ISO strings compare lexicographically. */
export function sumSpent(rows: UsageRow[], provider: Provider, sinceIso: string): number {
  let total = 0;
  for (const r of rows) {
    if (r.provider === provider && r.timestamp >= sinceIso) total += r.costUsd;
  }
  return total;
}

export function warningMessage(provider: CreditProvider, level: WarningLevel, status: BalanceStatus): string {
  const left = remainingUsd(status);
  const dollars = left === null ? "" : ` (about $${Math.max(0, left).toFixed(2)})`;
  return `⚠️ ${NAME[provider]} credits are down to ${level}% or less${dollars}. Top up soon, then send /credits set ${COMMAND_NAME[provider]} <new balance> so EGO keeps counting from the right number.`;
}

export function depletedMessage(provider: CreditProvider): string {
  if (provider === "anthropic") {
    return "🚨 Claude says its credits are used up, so EGO cannot answer right now. Top up in the Anthropic console, then send /credits set claude <new balance>.";
  }
  return "⚠️ Perplexity says its credits are used up. EGO will answer web questions from Claude's own knowledge until you top up. After topping up, send /credits set perplexity <new balance>.";
}

export function createLedger(deps: {
  store: LedgerStore;
  now: () => Date;
  notify: (text: string) => Promise<void>;
}): Ledger {
  const { store, now, notify } = deps;
  let cache: {
    at: number;
    setAt: Record<CreditProvider, string | undefined>;
    statuses: Record<CreditProvider, BalanceStatus>;
  } | null = null;

  async function loadStatuses(): Promise<Record<CreditProvider, BalanceStatus>> {
    const nowMs = now().getTime();
    if (cache && nowMs - cache.at < STATE_TTL_MS) return cache.statuses;
    const [balances, usage] = await Promise.all([store.readBalances(), store.readUsage()]);
    const statuses = {} as Record<CreditProvider, BalanceStatus>;
    for (const provider of CREDIT_PROVIDERS) {
      const balance = balances[provider];
      statuses[provider] = {
        startBalanceUsd: balance ? balance.startBalanceUsd : null,
        spentUsd: balance ? sumSpent(usage, provider, balance.setAt) : 0,
      };
    }
    cache = {
      at: nowMs,
      setAt: { anthropic: balances.anthropic?.setAt, perplexity: balances.perplexity?.setAt },
      statuses,
    };
    return statuses;
  }

  async function checkWarnings(): Promise<void> {
    // Balances are one cheap read; if another instance re-set one, the cached spend is stale.
    if (cache) {
      const fresh = await store.readBalances();
      if (CREDIT_PROVIDERS.some((p) => fresh[p]?.setAt !== cache?.setAt[p])) cache = null;
    }
    const statuses = await loadStatuses();
    const alertState = await store.readAlertState();
    for (const provider of CREDIT_PROVIDERS) {
      const level = warningLevel(statuses[provider]);
      if (isMoreSevere(level, alertState[provider].warnedLevel)) {
        // Claim the level before notifying so a second instance is less likely to repeat it.
        await store.setWarnedLevel(provider, level);
        await notify(warningMessage(provider, level, statuses[provider])).catch(() => {});
      }
    }
  }

  async function alertDepleted(provider: CreditProvider): Promise<void> {
    const state = await store.readAlertState();
    const last = state[provider].alertedAt;
    if (last && new Date(last).getTime() + ALERT_COOLDOWN_MS > now().getTime()) return;
    await store.setAlertedAt(provider, now().toISOString());
    await notify(depletedMessage(provider)).catch(() => {});
  }

  async function recordUsage(row: UsageRow): Promise<void> {
    try {
      await store.appendUsage(row);
    } catch (error) {
      console.warn("Could not record AI usage:", error);
    }
  }

  async function setBalance(provider: CreditProvider, usd: number): Promise<void> {
    await store.setBalance(provider, usd, now().toISOString());
    cache = null;
    await checkWarnings();
  }

  async function describe(): Promise<string> {
    const statuses = await loadStatuses();
    const line = (provider: CreditProvider) => {
      const s = statuses[provider];
      const left = remainingUsd(s);
      const fraction = remainingFraction(s);
      if (left === null || fraction === null || s.startBalanceUsd === null) {
        return `• ${NAME[provider]}: balance not set (send /credits set ${COMMAND_NAME[provider]} <dashboard balance>)`;
      }
      return `• ${NAME[provider]}: about $${Math.max(0, left).toFixed(2)} left of $${s.startBalanceUsd.toFixed(2)} (${(
        fraction * 100
      ).toFixed(1)}%)`;
    };
    return [
      "🧠 AI credits (estimates from tracked usage)",
      line("anthropic"),
      line("perplexity"),
      `EGO warns you at 10% and 5% left. Prices assumed as of ${PRICING_AS_OF}.`,
    ].join("\n");
  }

  return { recordUsage, checkWarnings, alertDepleted, setBalance, describe };
}
