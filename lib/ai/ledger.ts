import {
  SWITCH_THRESHOLD,
  decideMode,
  remainingFraction,
  remainingUsd,
  type Mode,
  type Provider,
  type ProviderStatus,
} from "./mode";
import { PRICING_AS_OF } from "./pricing";

export type CreditProvider = "gemini" | "perplexity";

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

export interface LedgerMeta {
  announcedMode: Mode;
  depletedUntil: Partial<Record<CreditProvider, string>>;
}

export interface LedgerStore {
  readBalances(): Promise<Partial<Record<CreditProvider, BalanceRow>>>;
  readUsage(): Promise<UsageRow[]>;
  readMeta(): Promise<LedgerMeta>;
  setBalance(provider: CreditProvider, usd: number, setAtIso: string): Promise<void>;
  setDepletedUntil(provider: CreditProvider, untilIso: string): Promise<void>;
  writeAnnouncedMode(mode: Mode): Promise<void>;
  appendUsage(row: UsageRow): Promise<void>;
}

export interface LedgerState {
  mode: Mode;
  gemini: ProviderStatus;
  perplexity: ProviderStatus;
}

export interface Ledger {
  getState(): Promise<LedgerState>;
  markDepleted(provider: CreditProvider): Promise<void>;
  recordUsage(row: UsageRow): Promise<void>;
  setBalance(provider: CreditProvider, usd: number): Promise<void>;
  describe(): Promise<string>;
}

export const STATE_TTL_MS = 60_000;
export const DEPLETED_COOLDOWN_MS = 30 * 60_000;

const PROVIDER_NAME: Record<CreditProvider, string> = { gemini: "Gemini", perplexity: "Perplexity" };

/** Sum of recorded cost for one provider at or after `sinceIso` ("" means all time). ISO strings compare lexicographically. */
export function sumSpent(rows: UsageRow[], provider: Provider, sinceIso: string): number {
  let total = 0;
  for (const r of rows) {
    if (r.provider === provider && r.timestamp >= sinceIso) total += r.costUsd;
  }
  return total;
}

function percentLeft(s: ProviderStatus): string {
  if (s.depleted) return "depleted";
  const fraction = remainingFraction(s);
  return fraction === null ? "balance not set" : `${(fraction * 100).toFixed(1)}% left`;
}

export function modeChangeMessage(to: Mode, gemini: ProviderStatus, perplexity: ProviderStatus): string {
  if (to === "claude") {
    return `⚠️ Gemini (${percentLeft(gemini)}) and Perplexity (${percentLeft(perplexity)}) credits are almost used up. EGO is now using Claude (Haiku, Sonnet, Opus). Voice notes still use Gemini. After you top up, send /credits set gemini <balance> and /credits set perplexity <balance> to switch back.`;
  }
  return "✅ Credits topped up. EGO is back on Gemini and Perplexity.";
}

export function depletedMessage(provider: CreditProvider): string {
  const name = PROVIDER_NAME[provider];
  return `⚠️ ${name} says its credits are used up. EGO is sending ${name}'s work to Claude for now. After a top-up, send /credits set ${provider} <balance>.`;
}

export function createLedger(deps: {
  store: LedgerStore;
  now: () => Date;
  notify: (text: string) => Promise<void>;
}): Ledger {
  const { store, now, notify } = deps;
  let cache: { at: number; state: LedgerState } | null = null;

  async function getState(): Promise<LedgerState> {
    const nowMs = now().getTime();
    if (cache && nowMs - cache.at < STATE_TTL_MS) return cache.state;

    const [balances, usage, meta] = await Promise.all([
      store.readBalances(),
      store.readUsage(),
      store.readMeta(),
    ]);
    const nowIso = now().toISOString();

    const statusFor = (provider: CreditProvider): ProviderStatus => {
      const balance = balances[provider];
      const until = meta.depletedUntil[provider];
      return {
        startBalanceUsd: balance ? balance.startBalanceUsd : null,
        spentUsd: balance ? sumSpent(usage, provider, balance.setAt) : 0,
        depleted: Boolean(until && until > nowIso),
      };
    };

    const gemini = statusFor("gemini");
    const perplexity = statusFor("perplexity");
    const state: LedgerState = { mode: decideMode(gemini, perplexity), gemini, perplexity };
    cache = { at: nowMs, state };

    if (state.mode !== meta.announcedMode) {
      // Claim the change before notifying so a second instance is less likely to repeat it.
      await store.writeAnnouncedMode(state.mode);
      await notify(modeChangeMessage(state.mode, gemini, perplexity)).catch(() => {});
    }
    return state;
  }

  async function markDepleted(provider: CreditProvider): Promise<void> {
    const meta = await store.readMeta();
    const nowIso = now().toISOString();
    const existing = meta.depletedUntil[provider];
    if (existing && existing > nowIso) return;
    await store.setDepletedUntil(provider, new Date(now().getTime() + DEPLETED_COOLDOWN_MS).toISOString());
    cache = null;
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
    await getState();
  }

  async function describe(): Promise<string> {
    const [state, usage] = await Promise.all([getState(), store.readUsage()]);
    const line = (name: string, provider: CreditProvider, s: ProviderStatus) => {
      const left = remainingUsd(s);
      const fraction = remainingFraction(s);
      if (left === null || fraction === null || s.startBalanceUsd === null) {
        return `• ${name}: balance not set (send /credits set ${provider} <dashboard balance>)`;
      }
      return `• ${name}: about $${Math.max(0, left).toFixed(2)} left of $${s.startBalanceUsd.toFixed(2)} (${(
        fraction * 100
      ).toFixed(1)}%)${s.depleted ? " - reported depleted" : ""}`;
    };
    return [
      "🧠 AI credits (estimates from tracked usage)",
      `Mode: ${state.mode === "claude" ? "Claude fallback is ON" : "Gemini + Perplexity"}`,
      line("Gemini", "gemini", state.gemini),
      line("Perplexity", "perplexity", state.perplexity),
      `• Claude spend so far: $${sumSpent(usage, "anthropic", "").toFixed(2)}`,
      `A provider moves to Claude when it is at ${SWITCH_THRESHOLD * 100}% or less. Prices assumed as of ${PRICING_AS_OF}.`,
    ].join("\n");
  }

  return { getState, markDepleted, recordUsage, setBalance, describe };
}
