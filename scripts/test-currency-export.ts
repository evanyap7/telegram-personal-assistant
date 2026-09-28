/**
 * Unit Test Suite for Multi-Currency Conversion & CSV Export Formatting
 *
 * Usage:
 *   node --experimental-strip-types --import ./scripts/bench/register.mjs scripts/test-currency-export.ts
 */

import {
  convertCurrencyToSgd,
  formatCurrencyConversion,
  isSgd,
} from "../lib/currency";
import {
  escapeCsvField,
  buildCsvFromTransactions,
} from "../lib/export";
import type { FinanceTransaction } from "../lib/finance";

let totalPassed = 0;
let totalFailed = 0;

function assert(condition: boolean, testName: string) {
  if (condition) {
    console.log(`  ✅ PASS: ${testName}`);
    totalPassed++;
  } else {
    console.error(`  ❌ FAIL: ${testName}`);
    totalFailed++;
  }
}

async function runTests() {
  console.log("\n=======================================================");
  console.log("  Unit Tests: Currency Conversion & CSV Export");
  console.log("=======================================================\n");

  // Test 1: isSgd helper
  {
    assert(isSgd("SGD") === true, "SGD recognized as SGD");
    assert(isSgd("sgd") === true, "Lowercase sgd recognized as SGD");
    assert(isSgd("USD") === false, "USD recognized as foreign currency");
  }

  // Test 2: SGD Conversion Pass-Through
  {
    const res = await convertCurrencyToSgd(50, "SGD");
    assert(res.sgdAmount === 50, "SGD pass-through returns exact amount");
    assert(res.rate === 1.0, "SGD pass-through rate is 1.0");
    assert(res.isEstimated === false, "SGD pass-through is not estimated");
    const fmt = formatCurrencyConversion(res);
    assert(fmt === "$50.00 SGD", "Formats SGD amount directly");
  }

  // Test 3: Foreign Currency Conversion (USD, JPY)
  {
    const usdRes = await convertCurrencyToSgd(100, "USD");
    assert(usdRes.sgdAmount > 100, "100 USD converts to > 100 SGD");
    assert(usdRes.rate > 1.0, "USD to SGD rate is > 1.0");
    const usdFmt = formatCurrencyConversion(usdRes);
    assert(usdFmt.includes("USD ➔"), "Formats USD conversion with arrow");
    assert(usdFmt.includes("SGD"), "Includes SGD in target string");

    const jpyRes = await convertCurrencyToSgd(10000, "JPY");
    assert(jpyRes.sgdAmount > 0 && jpyRes.sgdAmount < 200, "10000 JPY converts to reasonable SGD range");
  }

  // Test 4: Unknown Currency Fallback
  {
    const unkRes = await convertCurrencyToSgd(75, "XYZ");
    assert(unkRes.sgdAmount === 75, "Unknown currency defaults to 1:1");
    assert(unkRes.isEstimated === true, "Unknown currency flagged as estimated");
  }

  // Test 5: escapeCsvField
  {
    assert(escapeCsvField("Simple") === "Simple", "Plain string not quoted");
    assert(escapeCsvField("Hello, World") === '"Hello, World"', "String with comma is wrapped in quotes");
    assert(escapeCsvField('Quotes "here"') === '"Quotes ""here"""', "Quotes escaped with double quotes");
    assert(escapeCsvField("Line1\nLine2") === '"Line1\nLine2"', "Newlines wrapped in quotes");
  }

  // Test 6: buildCsvFromTransactions
  {
    const mockTxns: FinanceTransaction[] = [
      {
        rowNumber: 2,
        transactionId: "tx_1",
        timestamp: "2026-09-01 12:00:00",
        type: "income",
        amount: "5000.00",
        currency: "SGD",
        category: "Salary",
        description: "Monthly salary",
        status: "confirmed",
        deletedAt: "",
      },
      {
        rowNumber: 3,
        transactionId: "tx_2",
        timestamp: "2026-09-02 13:00:00",
        type: "expense",
        amount: "25.50",
        currency: "SGD",
        category: "Food",
        description: 'Lunch, with "colleagues"',
        status: "confirmed",
        deletedAt: "",
      },
      {
        rowNumber: 4,
        transactionId: "tx_3",
        timestamp: "2026-09-03 14:00:00",
        type: "expense",
        amount: "100.00",
        currency: "SGD",
        category: "Refunded",
        description: "Cancelled order",
        status: "deleted",
        deletedAt: "2026-09-03 14:05:00",
      },
    ];

    const result = buildCsvFromTransactions(mockTxns, "Sep2026");

    assert(result.rowCount === 3, "All 3 records included in CSV output");
    assert(result.totalIncome === 5000, "Total income calculated accurately");
    assert(result.totalExpense === 25.5, "Deleted transaction excluded from total expense");
    assert(result.netSavings === 4974.5, "Net savings calculated accurately");
    assert(result.filename === "transactions_Sep2026.csv", "Filename formatted properly");

    const lines = result.csvContent.split("\r\n");
    assert(lines.length === 4, "CSV has header + 3 data lines");
    assert(lines[0].startsWith("Transaction ID,Timestamp"), "Header contains expected column names");
    assert(lines[2].includes('"Lunch, with ""colleagues"""'), "Escaped commas and quotes in description row");
  }

  console.log(`\nResults: ${totalPassed} passed, ${totalFailed} failed.`);
  if (totalFailed > 0) {
    process.exit(1);
  }
}

runTests();
