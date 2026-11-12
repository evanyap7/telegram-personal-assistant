/**
 * Unit tests for the web app token sign-in (session cookie, Origin check, requireOwner).
 *
 * Usage:
 *   node --experimental-strip-types --import ./scripts/bench/register.mjs scripts/test-app-auth.ts
 */

import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  MAX_INPUT_CHARS,
  signSession,
  verifySession,
  isSameOrigin,
  requireOwner,
} from "../lib/app/auth";
import { POST as login } from "../app/api/ego/login/route";

let failed = 0;
function assert(condition: boolean, name: string) {
  if (condition) console.log(`  ✅ PASS: ${name}`);
  else {
    console.error(`  ❌ FAIL: ${name}`);
    failed++;
  }
}

const TOKEN = "t".repeat(40);
const SECRET = "s".repeat(40);
const HOST = "ego.example.com";
const NOW = 1_700_000_000_000;

function req(opts: { origin?: string; cookie?: string; body?: unknown } = {}): Request {
  const headers: Record<string, string> = { host: HOST };
  if (opts.origin) headers.origin = opts.origin;
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  return new Request(`https://${HOST}/api/ego/login`, {
    method: "POST",
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}

async function main() {
  const saved = {
    secret: process.env.EGO_APP_SECRET,
    token: process.env.EGO_APP_TOKEN,
    node: process.env.NODE_ENV,
  };
  const env = process.env as Record<string, string | undefined>;
  try {
    console.log("\n  Unit Tests: App Auth\n");
    env.EGO_APP_SECRET = SECRET;
    env.EGO_APP_TOKEN = TOKEN;
    env.NODE_ENV = "test";

    assert(MAX_INPUT_CHARS === 4000, "MAX_INPUT_CHARS is 4000");
    assert(SESSION_COOKIE === "ego_session", "cookie name");

    // Sessions
    const good = signSession(SECRET, NOW);
    assert(verifySession(good, SECRET, NOW + 1000), "signed token verifies");
    assert(!verifySession(undefined, SECRET, NOW), "missing token fails");
    const [exp, sig] = good.split(".");
    assert(!verifySession(`${Number(exp) + 1}.${sig}`, SECRET, NOW), "tampered expiry fails");
    assert(!verifySession(`${exp}.${sig.slice(0, -2)}AA`, SECRET, NOW), "tampered signature fails");
    assert(!verifySession(signSession("o".repeat(40), NOW), SECRET, NOW), "other secret fails");
    assert(!verifySession(good, SECRET, NOW + SESSION_TTL_MS + 1), "expired token fails");
    assert(!verifySession("garbage", SECRET, NOW), "garbage fails");

    // Origin
    assert(!isSameOrigin(req()), "missing Origin rejected");
    assert(!isSameOrigin(req({ origin: "https://evil.example.com" })), "different host rejected");
    assert(isSameOrigin(req({ origin: `https://${HOST}` })), "matching host accepted");

    // requireOwner
    const cookie = `${SESSION_COOKIE}=${signSession(SECRET, Date.now())}`;
    assert(requireOwner(req({ origin: `https://${HOST}` }))?.status === 401, "no cookie -> 401");
    assert(
      requireOwner(req({ origin: "https://evil.example.com", cookie }))?.status === 403,
      "bad Origin -> 403"
    );
    assert(requireOwner(req({ origin: `https://${HOST}`, cookie })) === null, "valid -> null");
    assert(
      requireOwner(req({ origin: `https://${HOST}`, cookie: `${SESSION_COOKIE}=x.y` }))?.status === 401,
      "bad cookie -> 401"
    );

    // Login
    const bad = await login(req({ origin: `https://${HOST}`, body: { token: "wrong" } }) as never);
    assert(bad.status === 401, "wrong token -> 401");
    assert(bad.headers.get("set-cookie") === null, "wrong token sets no cookie");
    const ok = await login(req({ origin: `https://${HOST}`, body: { token: TOKEN } }) as never);
    const sc = ok.headers.get("set-cookie") ?? "";
    assert(ok.status === 200, "right token -> 200");
    assert(sc.startsWith(`${SESSION_COOKIE}=`), "sets ego_session");
    assert(/httponly/i.test(sc), "httpOnly");
    assert(/samesite=strict/i.test(sc), "SameSite=Strict");
    assert(/path=\//i.test(sc), "Path=/");
    assert(/max-age=2592000/i.test(sc), "Max-Age 2592000");
    assert(!/secure/i.test(sc), "no Secure outside production");
    const badOrigin = await login(req({ origin: "https://evil.example.com", body: { token: TOKEN } }) as never);
    assert(badOrigin.status === 403, "login with bad Origin -> 403");
    const malformed = await login(req({ origin: `https://${HOST}`, body: "nope" }) as never);
    assert(malformed.status === 401, "non-object body -> 401");
    const raw = (ct: string | null, body: string) =>
      new Request(`https://${HOST}/api/ego/login`, {
        method: "POST",
        headers: { host: HOST, origin: `https://${HOST}`, ...(ct ? { "content-type": ct } : {}) },
        body,
      });
    const body = JSON.stringify({ token: TOKEN });
    assert((await login(raw("text/plain", body) as never)).status === 415, "wrong content-type -> 415");
    assert((await login(raw(null, body) as never)).status === 415, "missing content-type -> 415");
    const huge = JSON.stringify({ token: "x".repeat(2000) });
    assert((await login(raw("application/json", huge) as never)).status === 413, "oversized body -> 413");
    const cs = await login(raw("application/json; charset=utf-8", body) as never);
    assert(cs.status === 200, "JSON with charset suffix still logs in");
    env.NODE_ENV = "production";
    const prod = await login(req({ origin: `https://${HOST}`, body: { token: TOKEN } }) as never);
    assert(/secure/i.test(prod.headers.get("set-cookie") ?? ""), "Secure in production");
    env.NODE_ENV = "test";

    // Fail closed
    delete env.EGO_APP_SECRET;
    const o = { origin: `https://${HOST}` };
    assert((await login(req({ ...o, body: { token: TOKEN } }) as never)).status === 401, "no secret: login 401");
    assert(requireOwner(req({ ...o, cookie }))?.status === 401, "no secret: requireOwner 401");
    env.EGO_APP_SECRET = SECRET;
    env.EGO_APP_TOKEN = "short";
    assert((await login(req({ ...o, body: { token: "short" } }) as never)).status === 401, "short token: login 401");
    assert(requireOwner(req({ ...o, cookie }))?.status === 401, "short token: requireOwner 401");
  } finally {
    for (const [k, v] of [
      ["EGO_APP_SECRET", saved.secret],
      ["EGO_APP_TOKEN", saved.token],
      ["NODE_ENV", saved.node],
    ] as const) {
      if (v === undefined) delete (process.env as Record<string, string | undefined>)[k];
      else (process.env as Record<string, string | undefined>)[k] = v;
    }
  }
  console.log(failed ? `\n  ${failed} failed` : "\n  all passed");
  process.exit(failed ? 1 : 0);
}

main();
