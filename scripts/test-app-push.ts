/**
 * Unit tests for web push: pushOwner fan-out with fake deps (no network, no Sheets), the
 * /api/ego/push route guards, and the service worker push handlers. Sends nothing real.
 *
 * Usage:
 *   node --experimental-strip-types --import ./scripts/bench/register.mjs scripts/test-app-push.ts
 */

import { readFileSync } from "node:fs";
import { SESSION_COOKIE, signSession } from "../lib/app/auth";
import { pushOwner, safeEgoUrl, type PushDeps, type StoredSubscription } from "../lib/app/push";
import { GET, POST, runtime } from "../app/api/ego/push/route";

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

const sub = (n: number): StoredSubscription => ({
  endpoint: `https://push.example.com/${n}`,
  keys: { p256dh: "p256dh_key", auth: "auth_key" },
});

function fakes(subs: StoredSubscription[], failWith: Record<string, unknown> = {}) {
  const sent: string[] = [];
  const removed: string[] = [];
  let payload = "";
  const deps: PushDeps = {
    async list() {
      return subs;
    },
    async remove(endpoint) {
      removed.push(endpoint);
    },
    async send(s, p) {
      if (s.endpoint in failWith) throw failWith[s.endpoint];
      sent.push(s.endpoint);
      payload = p;
    },
  };
  return { deps, sent, removed, payload: () => payload };
}

async function main() {
  console.log("pushOwner");
  {
    const f = fakes([sub(1), sub(2), sub(3)]);
    await pushOwner(f.deps, "Title", "Body", "/ego");
    assert(f.sent.length === 3, "sends to every subscription", f.sent);
    const p = JSON.parse(f.payload());
    assert(p.title === "Title" && p.body === "Body" && p.url === "/ego", "payload shape", p);
  }
  {
    const f = fakes([sub(1), sub(2), sub(3)], {
      "https://push.example.com/1": { statusCode: 410 },
      "https://push.example.com/2": { statusCode: 404 },
    });
    await pushOwner(f.deps, "t", "b");
    assert(f.removed.length === 2 && f.sent.length === 1, "404/410 removed, rest still sent", { r: f.removed, s: f.sent });
  }
  {
    const f = fakes([sub(1), sub(2)], { "https://push.example.com/1": { statusCode: 500 } });
    let threw = false;
    try {
      await pushOwner(f.deps, "t", "b");
    } catch {
      threw = true;
    }
    assert(!threw && f.removed.length === 0 && f.sent.length === 1, "other errors swallowed, not removed");
  }
  {
    const f = fakes([]);
    await pushOwner(f.deps, "t", "b");
    assert(f.sent.length === 0, "empty list is a no-op");
  }
  {
    const deps: PushDeps = {
      async list() {
        throw new Error("sheets down");
      },
      async remove() {},
      async send() {},
    };
    let threw = false;
    try {
      await pushOwner(deps, "t", "b");
    } catch {
      threw = true;
    }
    assert(!threw, "list failure never throws");
  }
  {
    const f = fakes([sub(1)]);
    await pushOwner(f.deps, "t".repeat(500), "b".repeat(5000), "https://evil.example.com/ego");
    const p = JSON.parse(f.payload());
    assert(p.title.length <= 100 && p.body.length <= 300, "title/body are capped");
    assert(p.url === "/ego", "foreign url falls back to /ego", p.url);
  }
  assert(safeEgoUrl("/ego/x?y=1") === "/ego/x?y=1", "safeEgoUrl keeps /ego paths");
  assert(
    ["/egoistic", "//evil.com", "/ego//evil.com", "/other", "javascript:alert(1)", "/ego\\x", 5].every(
      (u) => safeEgoUrl(u) === "/ego"
    ),
    "safeEgoUrl rejects lookalikes and foreign targets"
  );

  console.log("route");
  const env = process.env as Record<string, string | undefined>;
  const SECRET = "s".repeat(40);
  env.EGO_APP_SECRET = SECRET;
  env.EGO_APP_TOKEN = "t".repeat(40);
  const HOST = "ego.example.com";
  const ORIGIN = `https://${HOST}`;
  const cookie = `${SESSION_COOKIE}=${signSession(SECRET, Date.now())}`;
  const post = (opts: { cookie?: string | null; body?: unknown; origin?: string | null } = {}) =>
    POST(
      new Request(`${ORIGIN}/api/ego/push`, {
        method: "POST",
        headers: {
          host: HOST,
          ...(opts.origin === null ? {} : { origin: opts.origin ?? ORIGIN }),
          "content-type": "application/json",
          ...(opts.cookie === null ? {} : { cookie: opts.cookie ?? cookie }),
        },
        body: JSON.stringify(opts.body ?? {}),
      })
    );
  const good = {
    action: "subscribe",
    subscription: { endpoint: "https://push.example.com/abc", keys: { p256dh: "BPkey_-1", auth: "auth_-1" } },
  };

  assert(runtime === "nodejs", "runtime is nodejs");
  assert((await post({ cookie: null, body: good })).status === 401, "POST without cookie -> 401");
  assert((await post({ origin: "https://evil.example.com", body: good })).status === 403, "wrong Origin -> 403");
  assert(
    (await GET(new Request(`${ORIGIN}/api/ego/push`, { headers: { host: HOST } }))).status === 401,
    "GET without cookie -> 401"
  );

  delete env.VAPID_PUBLIC_KEY;
  delete env.VAPID_PRIVATE_KEY;
  delete env.VAPID_SUBJECT;
  const noVapid = await post({ body: good });
  assert(noVapid.status === 503, "VAPID missing -> 503", noVapid.status);
  assert(typeof (await noVapid.json()).error === "string", "503 is JSON with an error message");
  assert(
    (await GET(new Request(`${ORIGIN}/api/ego/push`, { headers: { host: HOST, cookie } }))).status === 503,
    "GET with VAPID missing -> 503"
  );

  env.VAPID_PUBLIC_KEY = "PUBKEY";
  env.VAPID_PRIVATE_KEY = "PRIVKEY";
  env.VAPID_SUBJECT = "mailto:owner@example.com";
  const g = await GET(new Request(`${ORIGIN}/api/ego/push`, { headers: { host: HOST, cookie } }));
  assert(g.status === 200 && (await g.json()).publicKey === "PUBKEY", "GET returns the public key only");

  const bad = (subscription: unknown) => post({ body: { action: "subscribe", subscription } });
  const k = good.subscription.keys;
  assert((await bad({ endpoint: "http://push.example.com/a", keys: k })).status === 400, "http endpoint rejected");
  assert((await bad({ endpoint: "javascript:alert(1)", keys: k })).status === 400, "non-URL scheme rejected");
  assert((await bad({ endpoint: "https://u:p@push.example.com/a", keys: k })).status === 400, "credentials in URL rejected");
  assert((await bad({ endpoint: "https://push.example.com/" + "a".repeat(3000), keys: k })).status === 400, "long endpoint rejected");
  assert((await bad({ endpoint: good.subscription.endpoint, keys: { p256dh: "x".repeat(300), auth: "a" } })).status === 400, "long p256dh rejected");
  assert((await bad({ endpoint: good.subscription.endpoint, keys: { p256dh: "a", auth: "bad key!" } })).status === 400, "bad auth chars rejected");
  assert((await bad({ endpoint: good.subscription.endpoint })).status === 400, "missing keys rejected");
  assert((await bad(null)).status === 400, "null subscription rejected");
  assert((await post({ body: { action: "unsubscribe", endpoint: "http://x" } })).status === 400, "unsubscribe validates endpoint");
  assert((await post({ body: { action: "nope" } })).status === 400, "unknown action rejected");

  console.log("service worker");
  const sw = readFileSync("public/sw.js", "utf-8");
  assert(sw.includes('addEventListener("push"') && sw.includes("showNotification"), "sw handles push");
  assert(sw.includes('addEventListener("notificationclick"') && sw.includes("openWindow") && sw.includes(".focus()"), "sw handles notificationclick");
  assert(sw.includes("/icons/icon-192.png"), "sw notification icon is icon-192");
  assert(/const CACHE = "ego-shell-v\d+"/.test(sw), "sw cache logic intact");

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

void main();
