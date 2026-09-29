/**
 * Unit Test Suite for Cron Request Authorization
 *
 * Usage:
 *   node --experimental-strip-types --import ./scripts/bench/register.mjs scripts/test-cron-auth.ts
 */

import { isAuthorizedCronRequest } from "../lib/security";

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
  console.log("  Unit Tests: Cron Authorization");
  console.log("=======================================================\n");

  const originalSecret = process.env.CRON_SECRET;

  try {
    // 1. Unset CRON_SECRET fails closed
    delete process.env.CRON_SECRET;
    assert(
      !isAuthorizedCronRequest("Bearer test-secret"),
      "Fails closed when CRON_SECRET is unset (string header)"
    );
    assert(
      !isAuthorizedCronRequest(new Request("https://example.com/api/cron/test")),
      "Fails closed when CRON_SECRET is unset (Request object)"
    );

    // Set CRON_SECRET for remaining tests
    process.env.CRON_SECRET = "super-secret-cron-token-12345";

    // 2. String headers
    assert(
      isAuthorizedCronRequest("Bearer super-secret-cron-token-12345"),
      "Valid Bearer header string accepted"
    );
    assert(
      isAuthorizedCronRequest("super-secret-cron-token-12345"),
      "Raw secret header string accepted"
    );
    assert(
      !isAuthorizedCronRequest("Bearer wrong-token"),
      "Invalid Bearer header string rejected"
    );
    assert(
      !isAuthorizedCronRequest(null),
      "Null header rejected"
    );
    assert(
      !isAuthorizedCronRequest(undefined),
      "Undefined header rejected"
    );

    // 3. Request with Authorization header
    const reqWithBearer = new Request("https://example.com/api/cron/test", {
      headers: { authorization: "Bearer super-secret-cron-token-12345" },
    });
    assert(
      isAuthorizedCronRequest(reqWithBearer),
      "Request with Authorization: Bearer <secret> accepted"
    );

    const reqWithRawAuth = new Request("https://example.com/api/cron/test", {
      headers: { authorization: "super-secret-cron-token-12345" },
    });
    assert(
      isAuthorizedCronRequest(reqWithRawAuth),
      "Request with Authorization: <secret> accepted"
    );

    // 4. Request with custom headers
    const reqWithCronSecretHeader = new Request("https://example.com/api/cron/test", {
      headers: { "x-cron-secret": "super-secret-cron-token-12345" },
    });
    assert(
      isAuthorizedCronRequest(reqWithCronSecretHeader),
      "Request with x-cron-secret header accepted"
    );

    const reqWithApiKeyHeader = new Request("https://example.com/api/cron/test", {
      headers: { "x-api-key": "super-secret-cron-token-12345" },
    });
    assert(
      isAuthorizedCronRequest(reqWithApiKeyHeader),
      "Request with x-api-key header accepted"
    );

    // 5. Request with URL query parameters
    const reqWithQuerySecret = new Request(
      "https://example.com/api/cron/test?secret=super-secret-cron-token-12345"
    );
    assert(
      isAuthorizedCronRequest(reqWithQuerySecret),
      "Request with ?secret=<token> accepted"
    );

    const reqWithQueryKey = new Request(
      "https://example.com/api/cron/test?key=super-secret-cron-token-12345"
    );
    assert(
      isAuthorizedCronRequest(reqWithQueryKey),
      "Request with ?key=<token> accepted"
    );

    const reqWithQueryCronSecret = new Request(
      "https://example.com/api/cron/test?cron_secret=super-secret-cron-token-12345"
    );
    assert(
      isAuthorizedCronRequest(reqWithQueryCronSecret),
      "Request with ?cron_secret=<token> accepted"
    );

    // 6. Request with invalid / missing parameters
    const reqUnauthenticated = new Request("https://example.com/api/cron/test");
    assert(
      !isAuthorizedCronRequest(reqUnauthenticated),
      "Unauthenticated Request rejected"
    );

    const reqWrongQuery = new Request(
      "https://example.com/api/cron/test?secret=incorrect-value"
    );
    assert(
      !isAuthorizedCronRequest(reqWrongQuery),
      "Request with invalid ?secret query rejected"
    );

  } finally {
    if (originalSecret !== undefined) {
      process.env.CRON_SECRET = originalSecret;
    } else {
      delete process.env.CRON_SECRET;
    }
  }

  console.log("\n=======================================================");
  console.log(`  Passed: ${totalPassed} | Failed: ${totalFailed}`);
  console.log("=======================================================\n");

  if (totalFailed > 0) {
    process.exit(1);
  }
}

runTests();
