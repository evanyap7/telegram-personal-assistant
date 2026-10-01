/**
 * Master Verification & E2E Test Suite Runner
 *
 * Runs all domain test suites:
 * 1. Bill Splitting & IOU Calculations (test-split.ts)
 * 2. Calendar Free Slots & Travel Buffers (test-calendar-slots.ts)
 * 3. Personal Memory Store & Contacts (test-memory.ts)
 * 4. Multi-Currency Conversion & CSV Export (test-currency-export.ts)
 * 5. Natural Language Intent Fixture Validation (test-intents.ts)
 *
 * Usage:
 *   npm test
 */

import { execSync } from "child_process";

interface SuiteResult {
  name: string;
  command: string;
  passed: boolean;
  output: string;
  durationMs: number;
}

const SUITES = [
  { name: "Bill Splitting & IOU Ledger", command: "npm run test:split" },
  { name: "Calendar Free Slots & Travel Buffers", command: "npm run test:calendar" },
  { name: "Personal Memory & Contact Resolution", command: "npm run test:memory" },
  { name: "Currency Conversion & CSV Export", command: "npm run test:currency-export" },
  { name: "Cron Endpoint Request Authorization", command: "npm run test:cron-auth" },
  { name: "Workout Progressive Overload Engine", command: "npm run test:workout" },
  { name: "Multi-Item To-Do Batch Logging", command: "npm run test:todos-batch" },
  { name: "Assistant Intent Classification Fixtures", command: "npm run test:intents" },
];

function runMasterTest() {
  console.log("\n=======================================================");
  console.log("  🚀 Master Verification & E2E Test Suite Runner");
  console.log("=======================================================\n");

  const results: SuiteResult[] = [];
  let allPassed = true;

  for (const suite of SUITES) {
    process.stdout.write(`▶ Running ${suite.name}... `);
    const start = Date.now();
    try {
      const output = execSync(suite.command, { encoding: "utf8", stdio: "pipe" });
      const durationMs = Date.now() - start;
      console.log(`✅ PASSED (${durationMs}ms)`);
      results.push({
        name: suite.name,
        command: suite.command,
        passed: true,
        output,
        durationMs,
      });
    } catch (err: unknown) {
      const durationMs = Date.now() - start;
      console.log(`❌ FAILED (${durationMs}ms)`);
      allPassed = false;
      results.push({
        name: suite.name,
        command: suite.command,
        passed: false,
        output:
          (err as { stdout?: string }).stdout ||
          (err instanceof Error ? err.message : String(err)),
        durationMs,
      });
    }
  }

  console.log("\n=======================================================");
  console.log("  📊 Master Test Summary Report");
  console.log("=======================================================");

  for (const r of results) {
    const status = r.passed ? "✅ PASS" : "❌ FAIL";
    console.log(`  ${status} | ${r.name.padEnd(45)} | ${r.durationMs}ms`);
  }

  console.log("=======================================================\n");

  if (!allPassed) {
    console.error("💥 One or more test suites failed. Review logs above.\n");
    process.exit(1);
  } else {
    console.log("🎉 All 5 domain test suites passed successfully with zero errors!\n");
  }
}

runMasterTest();
