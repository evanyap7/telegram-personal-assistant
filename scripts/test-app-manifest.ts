/**
 * Unit tests for the PWA manifest (app/manifest.ts) and service worker rules (public/sw.js). No I/O beyond reading files.
 *
 * Usage:
 *   node --experimental-strip-types --import ./scripts/bench/register.mjs scripts/test-app-manifest.ts
 */

import { existsSync, readFileSync } from "node:fs";
import vm from "node:vm";
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

// Run the real service worker in a vm with stubbed self/caches/fetch and drive its handlers.
type Listener = (event: Record<string, unknown>) => void;
function loadSw() {
  const listeners: Record<string, Listener> = {};
  const store = new Map<string, Map<string, unknown>>();
  const deleted: string[] = [];
  const fetched: string[] = [];
  const cacheFor = (name: string) => {
    if (!store.has(name)) store.set(name, new Map());
    const m = store.get(name)!;
    return {
      addAll: async () => {},
      match: async (r: { url: string }) => m.get(r.url),
      put: async (r: { url: string }, v: unknown) => void m.set(r.url, v),
      keys: async () => [...m.keys()].map((url) => ({ url })),
      delete: async (r: { url: string }) => m.delete(r.url),
    };
  };
  const self = {
    location: { origin: "https://ego.example.com" },
    addEventListener: (type: string, fn: Listener) => void (listeners[type] = fn),
    skipWaiting: () => {},
    clients: { claim: async () => {} },
  };
  const caches = {
    open: async (n: string) => cacheFor(n),
    keys: async () => [...store.keys()],
    delete: async (n: string) => {
      deleted.push(n);
      return store.delete(n);
    },
  };
  const fetchStub = async (r: { url: string }) => {
    fetched.push(r.url);
    return { ok: true, status: 200, clone: () => ({ cloned: r.url }) };
  };
  vm.runInNewContext(sw, { self, caches, fetch: fetchStub, URL, Response, console });
  return { listeners, store, deleted, fetched, cacheFor };
}
function fetchEvent(url: string, opts: { method?: string; mode?: string } = {}) {
  let responded: Promise<unknown> | undefined;
  const waits: Promise<unknown>[] = [];
  const event = {
    request: { url, method: opts.method ?? "GET", mode: opts.mode ?? "no-cors" },
    respondWith: (p: Promise<unknown>) => void (responded = p),
    waitUntil: (p: Promise<unknown>) => void waits.push(p),
  };
  return { event, responded: () => responded, settle: () => Promise.all(waits) };
}

async function testSw() {
  assert(/CACHE\s*=\s*["']ego-shell-v\d+["']/.test(sw), "cache name is versioned");
  const o = "https://ego.example.com";

  const a = loadSw();
  for (const url of [`${o}/api/ego/chat`, `${o}/api/ego/push`]) {
    const f = fetchEvent(url);
    a.listeners.fetch(f.event);
    assert(f.responded() === undefined, `fetch handler skips ${url.slice(o.length)}`);
  }
  const post = fetchEvent(`${o}/icons/icon-192.png`, { method: "POST" });
  a.listeners.fetch(post.event);
  assert(post.responded() === undefined, "non-GET is not intercepted");
  const cross = fetchEvent("https://cdn.example.net/_next/static/x.js");
  a.listeners.fetch(cross.event);
  assert(cross.responded() === undefined, "cross-origin is not intercepted");
  const other = fetchEvent(`${o}/some/page.json`);
  a.listeners.fetch(other.event);
  assert(other.responded() === undefined, "non-static GET is not intercepted");

  const nav = fetchEvent(`${o}/ego`, { mode: "navigate" });
  a.listeners.fetch(nav.event);
  await nav.responded();
  assert(nav.responded() !== undefined && a.store.size === 0, "navigation is answered but never cached");

  const asset = fetchEvent(`${o}/_next/static/chunk.js`);
  a.listeners.fetch(asset.event);
  await asset.responded();
  await asset.settle();
  const cached = [...a.store.values()].flatMap((m) => [...m.keys()]);
  assert(cached.includes(`${o}/_next/static/chunk.js`), "static asset is cached", cached);

  // Activate prunes every cache except the current one.
  const b = loadSw();
  b.cacheFor("ego-shell-v0");
  b.cacheFor("ego-runtime-old");
  let activated: Promise<unknown> = Promise.resolve();
  b.listeners.activate({ waitUntil: (p: Promise<unknown>) => void (activated = p) });
  await activated;
  assert(
    b.deleted.includes("ego-shell-v0") && b.deleted.includes("ego-runtime-old"),
    "activate deletes old caches",
    b.deleted
  );

  // The static cache is bounded: many assets never leave more than the cap.
  const c = loadSw();
  for (let i = 0; i < 150; i++) {
    const f = fetchEvent(`${o}/_next/static/c${i}.js`);
    c.listeners.fetch(f.event);
    await f.responded();
    await f.settle();
  }
  const size = Math.max(0, ...[...c.store.values()].map((m) => m.size));
  assert(size > 0 && size <= 80, "static cache is capped", size);
}

async function testHeaders() {
  // Variable specifier: the loader resolves the .ts file, tsc does not need allowImportingTsExtensions.
  const spec = "../next.config.ts";
  const { default: nextConfig } = (await import(spec)) as { default: import("next").NextConfig };
  const rules = (await nextConfig.headers?.()) ?? [];
  const policyFor = (path: string) => {
    let value: string | undefined;
    for (const r of rules) {
      const src = r.source;
      const hit =
        src === "/:path*" ||
        (src === "/ego/:path*" && (path === "/ego" || path.startsWith("/ego/")));
      if (!hit) continue;
      const h = r.headers.find((x) => x.key === "Permissions-Policy");
      if (h) value = h.value; // later rules override earlier ones
    }
    return value;
  };
  assert(policyFor("/")?.includes("microphone=()") === true, "portfolio at / keeps microphone=()", policyFor("/"));
  assert(policyFor("/ego")?.includes("microphone=(self)") === true, "/ego allows microphone=(self)", policyFor("/ego"));
  assert(policyFor("/ego/x")?.includes("microphone=(self)") === true, "/ego/* allows microphone=(self)");
}

void (async () => {
  await testSw();
  await testHeaders();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
