import type { MonthlyBudgetStatus } from "@/lib/budget";
import {
  convertCurrencyToSgd,
  formatCurrencyConversion,
  isSgd,
  type CurrencyConversionResult,
} from "@/lib/currency";
import { addTransaction, type TransactionInput } from "@/lib/finance";

export interface FinanceAddDeps {
  convert(amount: number, currency: string): Promise<CurrencyConversionResult>;
  add(input: TransactionInput): ReturnType<typeof addTransaction>;
}

const defaultDeps: FinanceAddDeps = {
  convert: convertCurrencyToSgd,
  add: addTransaction,
};

/**
 * Records a transaction the way the legacy finance_add handler did: the ledger is in
 * SGD, so a foreign-currency amount is converted first and the conversion is noted in
 * the description.
 */
export async function addTransactionWithConversion(
  input: TransactionInput,
  deps: FinanceAddDeps = defaultDeps
) {
  let effectiveAmount = input.amount;
  let effectiveCurrency = input.currency;
  let effectiveDescription = input.description;
  let conversionNotice = "";

  if (input.currency && !isSgd(input.currency)) {
    const conversion = await deps.convert(input.amount, input.currency);
    effectiveAmount = conversion.sgdAmount;
    effectiveCurrency = "SGD";
    effectiveDescription = `${input.description} (${formatCurrencyConversion(conversion)})`;
    conversionNotice = `💱 Converted: ${formatCurrencyConversion(conversion)}`;
  }

  const added = await deps.add({
    ...input,
    amount: effectiveAmount,
    currency: effectiveCurrency,
    description: effectiveDescription,
  });

  return { added, effectiveAmount, effectiveCurrency, effectiveDescription, conversionNotice };
}

/** The 50/80/100% threshold and category-cap alerts the legacy handler appended to an expense reply. */
export function buildBudgetAlertLines(
  status: MonthlyBudgetStatus | undefined,
  type: "income" | "expense"
): string[] {
  if (!status?.hasBudget || type !== "expense") return [];
  const lines: string[] = [];
  if (status.thresholdCrossed === 100) {
    lines.push("🚨 Alert: You have exceeded 100% of your monthly budget!");
  } else if (status.thresholdCrossed === 80) {
    lines.push(
      `⚠️ Alert: You have reached 80% of your monthly budget ($${status.remaining.toFixed(2)} remaining).`
    );
  } else if (status.thresholdCrossed === 50) {
    lines.push("ℹ️ Note: You have reached 50% of your monthly budget.");
  }
  if (status.categoryCapAlerts?.length) {
    lines.push(...status.categoryCapAlerts);
  }
  return lines;
}
