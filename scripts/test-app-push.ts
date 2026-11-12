/**
 * Unit tests for web push: pushOwner fan-out with fake deps (no network, no Sheets), the
 * /api/ego/push route guards, and the service worker push handlers. Sends nothing real.
 *
 * Usage:
 *   node --experimental-strip-types --import ./scripts/bench/register.mjs scripts/test-app-push.ts
 */

import { readFileSync } from "node:fs";
import vm from "node:vm";
import { SESSION_COOKIE, signSession } from "../lib/app/auth";
import { pushIfProactive } from "../lib/app/push-default";
import { pushOwner, safeEgoUrl, type PushDeps, type StoredSubscription } from "../lib/app/push";
import { AUTH_BYTES, P256DH_BYTES, validEndpoint, validKey } from "../lib/app/push-validate";
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

const KEY65 = Buffer.alloc(65, 7).toString("base64url");
const KEY16 = Buffer.alloc(16, 9).toString("base64url");

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
    subscription: { endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys: { p256dh: KEY65, auth: KEY16 } },
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
  assert((await bad({ endpoint: "http://fcm.googleapis.com/a", keys: k })).status === 400, "http endpoint rejected");
  assert((await bad({ endpoint: "javascript:alert(1)", keys: k })).status === 400, "non-URL scheme rejected");
  assert((await bad({ endpoint: "https://u:p@fcm.googleapis.com/a", keys: k })).status === 400, "credentials in URL rejected");
  assert((await bad({ endpoint: "https://fcm.googleapis.com/" + "a".repeat(3000), keys: k })).status === 400, "long endpoint rejected");
  assert((await bad({ endpoint: good.subscription.endpoint, keys: { p256dh: "x".repeat(300), auth: "a" } })).status === 400, "long p256dh rejected");
  assert((await bad({ endpoint: good.subscription.endpoint, keys: { p256dh: "a", auth: "bad key!" } })).status === 400, "bad auth chars rejected");
  assert((await bad({ endpoint: good.subscription.endpoint })).status === 400, "missing keys rejected");
  assert((await bad(null)).status === 400, "null subscription rejected");
  assert((await post({ body: { action: "unsubscribe", endpoint: "http://x" } })).status === 400, "unsubscribe validates endpoint");
  assert((await post({ body: { action: "nope" } })).status === 400, "unknown action rejected");

  assert((await bad({ endpoint: "https://push.example.com/a", keys: k })).status === 400, "non-push host rejected");
  assert((await bad({ endpoint: good.subscription.endpoint, keys: { p256dh: KEY16, auth: KEY16 } })).status === 400, "wrong-length p256dh rejected");
  {
    const r = await POST(
      new Request(`${ORIGIN}/api/ego/push`, {
        method: "POST",
        headers: { host: HOST, origin: ORIGIN, cookie, "content-type": "text/plain" },
        body: "{}",
      })
    );
    assert(r.status === 415, "text/plain -> 415", r.status);
    const big = await POST(
      new Request(`${ORIGIN}/api/ego/push`, {
        method: "POST",
        headers: { host: HOST, origin: ORIGIN, cookie, "content-type": "application/json" },
        body: "x".repeat(5000),
      })
    );
    assert(big.status === 413, "body over 4 KB -> 413", big.status);
  }
  delete env.VAPID_PUBLIC_KEY;
  assert(
    (await post({ body: { action: "unsubscribe", endpoint: "https://nope.example.com/x" } })).status === 400,
    "unsubscribe is validated before the VAPID check"
  );
  env.VAPID_PUBLIC_KEY = "PUBKEY";

  console.log("validators");
  for (const h of ["fcm.googleapis.com", "updates.push.services.mozilla.com", "wns2-par02p.notify.windows.com", "web.push.apple.com", "api.push.apple.com"]) {
    assert(validEndpoint(`https://${h}/x`), `allows ${h}`);
  }
  for (const u of ["https://127.0.0.1/x", "https://localhost/x", "https://[::1]/x", "https://10.0.0.1/x", "https://evil.com/fcm.googleapis.com", "https://fcm.googleapis.com.evil.com/x", "https://push.apple.com/x", "https://fcm.googleapis.com:8443/x", "http://fcm.googleapis.com/x", 5]) {
    assert(!validEndpoint(u), `rejects ${String(u)}`);
  }
  assert(validKey(KEY65, P256DH_BYTES) && validKey(KEY16, AUTH_BYTES), "validKey accepts exact lengths");
  assert(!validKey(KEY16, P256DH_BYTES) && !validKey("a b", AUTH_BYTES) && !validKey("", AUTH_BYTES) && !validKey(7, AUTH_BYTES), "validKey rejects wrong length/charset/type");

  console.log("on-demand vs proactive push");
  {
    const env = process.env as Record<string, string | undefined>;
    const saved = { k: env.VAPID_PUBLIC_KEY, p: env.VAPID_PRIVATE_KEY, s: env.VAPID_SUBJECT };
    env.VAPID_PUBLIC_KEY = "PUB";
    env.VAPID_PRIVATE_KEY = "PRIV";
    env.VAPID_SUBJECT = "mailto:owner@example.com";
    const on = fakes([sub(1), sub(2)]);
    await pushIfProactive(undefined, "Morning brief", "text", undefined, on.deps);
    await pushIfProactive({}, "Morning brief", "text", undefined, on.deps);
    assert(on.sent.length === 0, "on-demand send (no push flag) does not push", on.sent);
    const cron = fakes([sub(1), sub(2)]);
    await pushIfProactive({ push: true }, "Morning brief", "text", undefined, cron.deps);
    assert(cron.sent.length === 2, "cron send ({ push: true }) pushes to every device", cron.sent);
    // Cron entry points must opt in explicitly.
    const briefing = readFileSync("app/api/cron/briefing/route.ts", "utf-8");
    const reminders = readFileSync("app/api/cron/calendar-reminders/route.ts", "utf-8");
    assert((briefing.match(/\{ push: true \}/g) ?? []).length === 3, "briefing cron passes push: true for all three briefs");
    assert(reminders.includes("checkAndSendEventReminders({ push: true })") && reminders.includes("checkAndSendTodoReminders({ push: true })"), "reminder cron passes push: true");
    const router = readFileSync("lib/telegram/command-router.ts", "utf-8");
    const dispatcher = readFileSync("lib/handlers/dispatcher.ts", "utf-8");
    assert(!/push:\s*true/.test(router) && !/push:\s*true/.test(dispatcher), "on-demand callers never opt in to push");
    for (const [k, v] of [["VAPID_PUBLIC_KEY", saved.k], ["VAPID_PRIVATE_KEY", saved.p], ["VAPID_SUBJECT", saved.s]] as const) {
      if (v === undefined) delete env[k];
      else env[k] = v;
    }
  }

  console.log("service worker");
  const sw = readFileSync("public/sw.js", "utf-8");
  // Run the real handlers in a vm with a stubbed self, and check what they do.
  const listeners: Record<string, (e: Record<string, unknown>) => void> = {};
  const shown: { title: string; opts: { body: string; icon: string; data: { url: string } } }[] = [];
  const opened: string[] = [];
  const self = {
    location: { origin: "https://ego.example.com" },
    addEventListener: (t: string, fn: (e: Record<string, unknown>) => void) => void (listeners[t] = fn),
    registration: {
      showNotification: async (title: string, opts: (typeof shown)[number]["opts"]) => void shown.push({ title, opts }),
    },
    clients: { matchAll: async () => [], openWindow: async (u: string) => void opened.push(u), claim: async () => {} },
  };
  vm.runInNewContext(sw, { self, caches: {}, fetch: async () => ({}), URL, Response, console });
  const waits: Promise<unknown>[] = [];
  const waitUntil = (p: Promise<unknown>) => void waits.push(p);
  listeners.push({ data: { json: () => ({ title: "Hi", body: "There", url: "/ego?x=1" }) }, waitUntil });
  listeners.push({ data: { json: () => ({ title: "", body: 5, url: "https://evil.example.com" }) }, waitUntil });
  listeners.push({ data: { json: () => { throw new Error("bad json"); } }, waitUntil });
  await Promise.all(waits);
  assert(shown.length === 3, "push handler shows a notification per push", shown.length);
  assert(shown[0].title === "Hi" && shown[0].opts.body === "There" && shown[0].opts.data.url === "/ego?x=1", "push payload is used", shown[0]);
  assert(shown[0].opts.icon === "/icons/icon-192.png", "notification icon is icon-192");
  assert(shown[1].title === "EGO" && shown[1].opts.data.url === "/ego", "bad title and off-site url fall back", shown[1]);
  assert(shown[2].title === "EGO" && shown[2].opts.data.url === "/ego", "malformed payload falls back", shown[2]);
  const closed: boolean[] = [];
  listeners.notificationclick({ notification: { close: () => void closed.push(true), data: { url: "//evil.example.com" } }, waitUntil });
  await Promise.all(waits);
  assert(closed.length === 1 && opened[0] === "/ego", "notificationclick closes and opens a safe /ego url", opened);

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

void main();
