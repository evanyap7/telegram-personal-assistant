/**
 * Unit Test Suite for Bill Splitting & IOU Calculations
 *
 * Usage:
 *   node --experimental-strip-types --import ./scripts/bench/register.mjs scripts/test-split.ts
 */

import {
  calculateBillSplit,
  formatSplitBillMessage,
  formatIOUSummaryMessage,
  type IOUSummary,
} from "../lib/split";

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

function runTests() {
  console.log("\n=======================================================");
  console.log("  Unit Tests: Bill Splitting & IOU Calculations");
  console.log("=======================================================\n");

  // Test 1: Even 3-way split
  {
    const res = calculateBillSplit({
      total: 30,
      people: ["Alice", "Bob", "Charlie"],
    });
    assert(res.totalAmount === 30, "Even split total amount is 30");
    assert(res.shares.length === 3, "Split into 3 shares");
    assert(res.shares[0].amount === 10, "Alice pays 10.00");
    assert(res.shares[1].amount === 10, "Bob pays 10.00");
    assert(res.shares[2].amount === 10, "Charlie pays 10.00");
    const sum = res.shares.reduce((acc, s) => acc + s.amount, 0);
    assert(Math.abs(sum - 30) < 0.0001, "Sum of shares exactly equals 30");
  }

  // Test 2: Penny remainder allocation ($10 split 3 ways)
  {
    const res = calculateBillSplit({
      total: 10,
      people: ["Evan", "Sarah", "Dave"],
    });
    assert(res.totalAmount === 10, "Penny remainder total amount is 10");
    assert(res.shares[0].amount === 3.34, "Evan receives the extra cent ($3.34)");
    assert(res.shares[1].amount === 3.33, "Sarah pays $3.33");
    assert(res.shares[2].amount === 3.33, "Dave pays $3.33");
    const sum = res.shares.reduce((acc, s) => acc + s.amount, 0);
    assert(Math.abs(sum - 10) < 0.0001, "Sum of shares exactly equals 10 without rounding loss");
  }

  // Test 3: Subtotal with Tax & Tip
  {
    const res = calculateBillSplit({
      subtotal: 100,
      taxPercent: 9, // 9% GST
      tipPercent: 10, // 10% Service Charge
      people: ["Alice", "Bob"],
    });
    assert(res.subtotal === 100, "Subtotal is 100");
    assert(res.taxAmount === 9, "9% GST is $9.00");
    assert(res.tipAmount === 10, "10% service charge is $10.00");
    assert(res.totalAmount === 119, "Total amount is $119.00");
    assert(res.shares[0].amount === 59.5, "Alice pays half ($59.50)");
    assert(res.shares[1].amount === 59.5, "Bob pays half ($59.50)");
  }

  // Test 4: formatSplitBillMessage formatting
  {
    const res = calculateBillSplit({
      total: 50,
      people: ["Alice", "Bob"],
    });
    const msg = formatSplitBillMessage(res, "Dinner at HaiDiLao");
    assert(msg.includes("Dinner at HaiDiLao"), "Includes description in message");
    assert(msg.includes("50.00"), "Includes total amount in message");
    assert(msg.includes("Alice"), "Includes Alice in breakdown");
    assert(msg.includes("Bob"), "Includes Bob in breakdown");
  }

  // Test 5: formatIOUSummaryMessage with balances
  {
    const emptySummary: IOUSummary = {
      totalOwedToMe: 0,
      totalIOwe: 0,
      netBalance: 0,
      byPerson: {},
      records: [],
    };
    const emptyMsg = formatIOUSummaryMessage(emptySummary);
    assert(emptyMsg.includes("All settled"), "Handles empty IOU balance correctly");

    const activeSummary: IOUSummary = {
      totalOwedToMe: 45.5,
      totalIOwe: 10.0,
      netBalance: 35.5,
      byPerson: {
        Sarah: { owesMe: 45.5, iOwe: 0, net: 45.5 },
        Tom: { owesMe: 0, iOwe: 10.0, net: -10.0 },
      },
      records: [
        {
          rowNumber: 2,
          iouId: "iou_1",
          createdAt: "2026-09-28 10:00:00",
          payer: "Me",
          debtor: "Sarah",
          amount: 45.5,
          currency: "SGD",
          description: "Lunch",
          status: "unsettled",
        },
      ],
    };
    const activeMsg = formatIOUSummaryMessage(activeSummary);
    assert(activeMsg.includes("45.50"), "Includes owed to you amount");
    assert(activeMsg.includes("Sarah"), "Includes debtor name");
    assert(activeMsg.includes("Tom"), "Includes creditor name");
  }

  console.log(`\nResults: ${totalPassed} passed, ${totalFailed} failed.`);
  if (totalFailed > 0) {
    process.exit(1);
  }
}

runTests();
