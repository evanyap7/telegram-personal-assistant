/**
 * Unit tests for the PWA manifest (app/manifest.ts) and service worker rules (public/sw.js). No I/O beyond reading files.
 *
 * Usage:
 *   node --experimental-strip-types --import ./scripts/bench/register.mjs scripts/test-app-manifest.ts
 */

import { existsSync, readFileSync } from "node:fs";
import manifest from "../app/manifest";

let passed = 0;
let failed = 0;
function assert(condition: boolean, name: string, detail?: unknown) {
  if (condition) {
    console.log(`  ✅ PASS: ${name}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${name}`, detail === undefined ? "" : JSON.stringify(detail));
    failed++;
  }
}

const m = manifest();
assert(m.start_url === "/ego", "start_url is /ego", m.start_url);
assert(m.scope === "/ego", "scope is /ego", m.scope);
assert(m.display === "standalone", "display is standalone", m.display);
assert(m.name === "EGO" && m.short_name === "EGO", "name and short_name are EGO");
assert(m.background_color === "#f3f1f2" && m.theme_color === "#1d2340", "colours match brand");

const icons = m.icons ?? [];
for (const size of ["192x192", "512x512"]) {
  const icon = icons.find((i) => i.sizes === size && i.purpose !== "maskable");
  assert(!!icon && icon.type === "image/png", `has ${size} png icon`, icon);
}
assert(icons.some((i) => i.purpose === "maskable" && i.sizes === "512x512"), "has maskable 512 icon");
for (const i of icons) {
  assert(i.src.startsWith("/icons/") && existsSync(`public${i.src}`), `icon file exists: ${i.src}`);
}

const sw = readFileSync("public/sw.js", "utf8");
assert(/CACHE\s*=\s*["']ego-shell-v\d+["']/.test(sw), "cache name is versioned");
assert(sw.includes("caches.delete"), "old caches deleted on activate");
assert(/request\.method\s*!==\s*["']GET["']/.test(sw), "non-GET requests are not intercepted");
assert(sw.includes("/api/"), "sw refers to /api/ (bypass rule)");
assert(sw.includes('mode === "navigate"') && sw.includes("EGO is offline"), "navigations are network-first with offline page");
assert(!/cache\.put\([^)]*navigate/.test(sw), "navigation responses are not cached");

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
