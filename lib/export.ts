import {
  listTransactionsFromSheet,
  resolveMonthSheetName,
} from "./finance";

export interface MonthlyCsvExportResult {
  csvContent: string;
  filename: string;
  monthName: string;
  rowCount: number;
  totalIncome: number;
  totalExpense: number;
  netSavings: number;
}

function escapeCsvField(field: string): string {
  if (field.includes(",") || field.includes('"') || field.includes("\n")) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  return field;
}

/**
 * Exports all finance transactions for a given month as CSV.
 */
export async function generateMonthlyCsvExport(
  monthArg?: string
): Promise<MonthlyCsvExportResult> {
  const targetMonthSheet = await resolveMonthSheetName(monthArg);
  const transactions = await listTransactionsFromSheet(targetMonthSheet);

  let totalIncome = 0;
  let totalExpense = 0;

  const headers = [
    "Transaction ID",
    "Timestamp",
    "Type",
    "Amount",
    "Currency",
    "Category",
    "Description",
    "Status",
  ];

  const lines = [headers.join(",")];

  for (const t of transactions) {
    const numAmount = parseFloat(t.amount) || 0;
    if (t.status !== "deleted") {
      if (t.type === "income") totalIncome += numAmount;
      if (t.type === "expense") totalExpense += numAmount;
    }

    const row = [
      escapeCsvField(t.transactionId),
      escapeCsvField(t.timestamp),
      escapeCsvField(t.type),
      numAmount.toFixed(2),
      escapeCsvField(t.currency),
      escapeCsvField(t.category),
      escapeCsvField(t.description),
      escapeCsvField(t.status),
    ];
    lines.push(row.join(","));
  }

  const csvContent = lines.join("\r\n");
  const filename = `transactions_${targetMonthSheet}.csv`;
  const netSavings = totalIncome - totalExpense;

  return {
    csvContent,
    filename,
    monthName: targetMonthSheet,
    rowCount: transactions.length,
    totalIncome: Math.round(totalIncome * 100) / 100,
    totalExpense: Math.round(totalExpense * 100) / 100,
    netSavings: Math.round(netSavings * 100) / 100,
  };
}
