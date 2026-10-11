/**
 * Unit Test Suite for Memory Store & Contact Nickname Resolution
 *
 * Usage:
 *   node --experimental-strip-types --import ./scripts/bench/register.mjs scripts/test-memory.ts
 */

import {
  scoreMemories,
  parseContactRecord,
  formatMemorySearchResult,
  type MemoryRecord,
} from "../lib/memory";
import { encryptSecret, decryptSecret, isEncryptedValue } from "../lib/secret-box";

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
  console.log("  Unit Tests: Memory Scoring & Contact Parsing");
  console.log("=======================================================\n");

  const mockRecords: MemoryRecord[] = [
    {
      rowNumber: 2,
      memoryId: "mem_1",
      createdAt: "2026-09-28",
      updatedAt: "2026-09-28",
      category: "contact",
      key: "Alice Tan",
      value: "Email: alice.tan@example.com | Phone: 91234567 | Nickname: Ali",
      tags: ["colleague", "work", "contact"],
    },
    {
      rowNumber: 3,
      memoryId: "mem_2",
      createdAt: "2026-09-28",
      updatedAt: "2026-09-28",
      category: "credential",
      key: "Gym Locker Code",
      value: "Code is 4829 at Raffles gym",
      tags: ["gym", "locker", "fitness"],
    },
    {
      rowNumber: 4,
      memoryId: "mem_3",
      createdAt: "2026-09-28",
      updatedAt: "2026-09-28",
      category: "preference",
      key: "Coffee order",
      value: "Oat latte with no sugar",
      tags: ["coffee", "drink"],
    },
    {
      rowNumber: 5,
      memoryId: "mem_4",
      createdAt: "2026-09-28",
      updatedAt: "2026-09-28",
      category: "contact",
      key: "Bob Lim",
      value: "bob.lim@acme.org, mobile: +65 82345678",
      tags: ["client", "sales", "contact"],
    },
  ];

  // Test 1: Exact Key Match
  {
    const results = scoreMemories(mockRecords, "Alice Tan");
    assert(results.length > 0, "Finds Alice Tan");
    assert(results[0].key === "Alice Tan", "Alice Tan ranks first on exact key match");
  }

  // Test 2: Value Substring Match
  {
    const results = scoreMemories(mockRecords, "oat latte");
    assert(results.length > 0, "Finds coffee preference by value substring");
    assert(results[0].key === "Coffee order", "Matches 'Coffee order' from oat latte");
  }

  // Test 3: Tag Search
  {
    const results = scoreMemories(mockRecords, "fitness");
    assert(results.length > 0, "Finds gym locker code via fitness tag");
    assert(results[0].category === "credential", "Matched category is credential");
  }

  // Test 4: Category filter
  {
    const results = scoreMemories(mockRecords, "Alice", { category: "credential" });
    assert(results.length === 0, "Returns 0 when category doesn't match filter");

    const contactResults = scoreMemories(mockRecords, "Alice", { category: "contact" });
    assert(contactResults.length === 1, "Returns 1 when category filter matches");
  }

  // Test 5: parseContactRecord
  {
    const aliceContact = parseContactRecord(mockRecords[0]);
    assert(aliceContact.name === "Alice Tan", "Parsed contact name correctly");
    assert(aliceContact.email === "alice.tan@example.com", "Extracted email accurately");
    assert(aliceContact.phone === "91234567", "Extracted SG 8-digit phone number");

    const bobContact = parseContactRecord(mockRecords[3]);
    assert(bobContact.email === "bob.lim@acme.org", "Extracted Bob's org email");
    assert(bobContact.phone === "+65 82345678", "Extracted Bob's +65 format phone");

    const noContact = parseContactRecord(mockRecords[1]);
    assert(noContact.email === undefined, "Undefined email when none in value");
    assert(noContact.phone === undefined, "Undefined phone when none in value");
  }

  // Test 6: formatMemorySearchResult
  {
    const emptyMsg = formatMemorySearchResult("random term", []);
    assert(emptyMsg.includes("No memories or notes found"), "Formats empty search result");

    const singleMsg = formatMemorySearchResult("Coffee", [mockRecords[2]]);
    assert(singleMsg.includes("Coffee order"), "Formats single result with key");
    assert(singleMsg.includes("Oat latte"), "Formats single result with value");
    assert(singleMsg.includes("⭐"), "Uses star badge for preference");

    const multiMsg = formatMemorySearchResult("contact", [mockRecords[0], mockRecords[3]]);
    assert(multiMsg.includes("Found 2 matching memories"), "Formats multiple results header");
    assert(multiMsg.includes("Alice Tan"), "Includes Alice in list");
    assert(multiMsg.includes("Bob Lim"), "Includes Bob in list");
  }

  // Test 7: Credential encryption round-trip (AES-256-GCM)
  {
    const originalKey = process.env.MEMORY_ENCRYPTION_KEY;

    delete process.env.MEMORY_ENCRYPTION_KEY;
    assert(encryptSecret("1234") === null, "No encryption without MEMORY_ENCRYPTION_KEY");
    assert(decryptSecret("plain value") === "plain value", "Plaintext passes through decrypt");

    process.env.MEMORY_ENCRYPTION_KEY = "test-key-that-is-long-enough-123";
    const sealed = encryptSecret("0123") ?? "";
    assert(isEncryptedValue(sealed), "Encrypted value carries enc:v1 prefix");
    assert(!sealed.includes("0123"), "Ciphertext does not contain plaintext");
    assert(decryptSecret(sealed) === "0123", "Round-trip keeps leading zeros");
    assert(encryptSecret("0123") !== sealed, "Random IV gives distinct ciphertexts");

    process.env.MEMORY_ENCRYPTION_KEY = "a-different-key-that-is-long-456";
    assert(decryptSecret(sealed) === null, "Wrong key fails authentication");

    if (originalKey === undefined) delete process.env.MEMORY_ENCRYPTION_KEY;
    else process.env.MEMORY_ENCRYPTION_KEY = originalKey;
  }

  console.log(`\nResults: ${totalPassed} passed, ${totalFailed} failed.`);
  if (totalFailed > 0) {
    process.exit(1);
  }
}

runTests();
