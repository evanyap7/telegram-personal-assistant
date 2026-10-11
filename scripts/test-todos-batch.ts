import assert from "node:assert/strict";
import { addTodosBatch } from "../lib/todos";

async function runTodoBatchTests() {
  console.log("\n=======================================================");
  console.log("  📋 Multi-Item To-Do Batch Logging Unit Tests");
  console.log("=======================================================\n");

  // 1. Empty input handling
  console.log("Test 1: Empty batch array...");
  const emptyRes = await addTodosBatch([]);
  assert.equal(emptyRes.length, 0, "Empty array should return empty result");
  console.log("  ✅ Empty batch returned empty array.\n");

  console.log("🎉 All Multi-Item To-Do tests passed!\n");
}

runTodoBatchTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
