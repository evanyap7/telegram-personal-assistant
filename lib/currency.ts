/**
 * Multi-currency conversion module targeting SGD.
 * Uses cached live FX rates with reliable offline Singapore-centric fallback table.
 */

export interface CurrencyConversionResult {
  originalAmount: number;
  originalCurrency: string;
  sgdAmount: number;
  rate: number; // 1 fromCurrency = rate SGD
  isEstimated: boolean;
}

// Fallback rates: units of SGD per 1 unit of foreign currency
const FALLBACK_RATES_TO_SGD: Record<string, number> = {
  SGD: 1.0,
  USD: 1.34,
  EUR: 1.46,
  GBP: 1.73,
  JPY: 0.0089, // 1 JPY = 0.0089 SGD
  MYR: 0.30,
  THB: 0.0395,
  AUD: 0.88,
  KRW: 0.00098,
  TWD: 0.0418,
  IDR: 0.000084,
  CNY: 0.19,
  HKD: 0.17,
  NZD: 0.81,
  CAD: 0.98,
  CHF: 1.55,
};

let cachedRates: Record<string, number> | null = null;
let lastFetchTime = 0;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

async function fetchLiveSgdRates(): Promise<Record<string, number> | null> {
  const now = Date.now();
  if (cachedRates && now - lastFetchTime < CACHE_TTL_MS) {
    return cachedRates;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);

    const res = await fetch("https://open.er-api.com/v6/latest/SGD", {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!res.ok) return null;

    const data = (await res.json()) as {
      result?: string;
      rates?: Record<string, number>;
    };

    if (data.rates) {
      // The API returns rates as 1 SGD = X foreign currency.
      // We convert this to: 1 foreign currency = (1 / X) SGD.
      const toSgdMap: Record<string, number> = { SGD: 1.0 };
      for (const [curr, rateAgainstSgd] of Object.entries(data.rates)) {
        if (rateAgainstSgd > 0) {
          toSgdMap[curr.toUpperCase()] = 1 / rateAgainstSgd;
        }
      }

      cachedRates = toSgdMap;
      lastFetchTime = now;
      return cachedRates;
    }
  } catch (err) {
    console.warn("Live currency rate fetch failed, using fallback rates:", err);
  }

  return null;
}

/**
 * Checks if a currency code is SGD.
 */
export function isSgd(currency: string): boolean {
  return currency.trim().toUpperCase() === "SGD";
}

/**
 * Converts any supported currency amount to Singapore Dollars (SGD).
 */
export async function convertCurrencyToSgd(
  amount: number,
  fromCurrency: string
): Promise<CurrencyConversionResult> {
  const curr = fromCurrency.trim().toUpperCase();

  if (curr === "SGD" || amount === 0) {
    return {
      originalAmount: amount,
      originalCurrency: "SGD",
      sgdAmount: amount,
      rate: 1.0,
      isEstimated: false,
    };
  }

  const liveRates = await fetchLiveSgdRates();
  let rate = liveRates ? liveRates[curr] : undefined;
  let isEstimated = false;

  if (rate === undefined) {
    rate = FALLBACK_RATES_TO_SGD[curr];
    isEstimated = true;
  }

  if (rate === undefined) {
    // Unknown currency, default 1:1 with warning flag
    rate = 1.0;
    isEstimated = true;
  }

  const sgdAmount = Math.round(amount * rate * 100) / 100;

  return {
    originalAmount: amount,
    originalCurrency: curr,
    sgdAmount,
    rate,
    isEstimated,
  };
}

/**
 * Formats a currency conversion result into a user-friendly string.
 */
export function formatCurrencyConversion(res: CurrencyConversionResult): string {
  if (res.originalCurrency === "SGD") {
    return `$${res.sgdAmount.toFixed(2)} SGD`;
  }
  const estNote = res.isEstimated ? " (approx)" : "";
  return `${res.originalAmount.toFixed(2)} ${res.originalCurrency} ➔ *$${res.sgdAmount.toFixed(2)} SGD*${estNote}`;
}

/**
 * Returns list of popular supported currencies.
 */
export function getSupportedCurrencies(): string[] {
  return Object.keys(FALLBACK_RATES_TO_SGD);
}
