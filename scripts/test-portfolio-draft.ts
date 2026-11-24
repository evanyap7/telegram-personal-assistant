/**
 * Unit tests for portfolio draft approval: the signed intake route, the 7-day draft store
 * (in-memory fake; the Sheets store is not tested offline), the Telegram button and note
 * handlers, the GitHub merge/close/dispatch calls (fake fetch) and the expiry cron pass.
 * Nothing here touches the network.
 *
 * Usage:
 *   npm run test:portfolio-draft
 */

import crypto from "node:crypto";
import {
  DRAFT_TTL_MS,
  MERGE_LOCK_MS,
  createMemoryDraftStore,
  draftToRow,
  getDraft,
  resolveDraft,
  rowToDraft,
  saveDraft,
  type Draft,
} from "../lib/portfolio-drafts";
import {
  closePr,
  dispatchWorkflow,
  isPrMerged,
  mergePr,
  mergePrWithReason,
  type MergeOutcome,
} from "../lib/github-portfolio";
import {
  handleDraftIntake,
  handleDraftNote,
  handlePortfolioDraftCallback,
  parseNotePromptId,
  runDraftExpiryPass,
  type DraftDeps,
  type DraftMarkup,
} from "../lib/handlers/portfolio-draft";
import { POST as intakeRoute } from "../app/api/portfolio-draft/route";

let totalPassed = 0;
let totalFailed = 0;

function assert(condition: boolean, testName: string, detail?: unknown) {
  if (condition) {
    console.log(`  ✅ PASS: ${testName}`);
    totalPassed++;
  } else {
    console.error(`  ❌ FAIL: ${testName}`, detail === undefined ? "" : JSON.stringify(detail));
    totalFailed++;
  }
}

/** Runs one block; a throw counts as one failure instead of aborting the suite. */
async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (err) {
    console.error(`  ❌ FAIL: ${name} threw:`, err instanceof Error ? err.message : String(err));
    totalFailed++;
  }
}

const OWNER = 111;
const STRANGER = 999;
const REPO = "evanyap7/evan-portfolio-website";
const SECRET = "test-webhook-secret-0123456789";
const NOW = Date.parse("2026-11-23T08:00:00Z");
const NOW_S = Math.floor(NOW / 1000);
const DAY = 86_400_000;
const ID = `chaperone-${NOW_S}`;
const PR_URL = `https://github.com/${REPO}/pull/42`;
/** The project repo the draft is about (name only), sent back in dispatch payloads. */
const SOURCE = "chaperone";
/** The PR head commit the draft message describes; Approve merges exactly this. */
const HEAD_SHA = "a1".repeat(20);
const NEW_SHA = "b2".repeat(20);

function payload(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ID,
    repo: REPO,
    kind: "new",
    prUrl: PR_URL,
    previewUrl: "https://evan-portfolio-git-auto-project-chaperone.vercel.app",
    screenshotUrl: "https://raw.githubusercontent.com/evanyap7/evan-portfolio-website/updater-shots/chaperone.png",
    colours: ["#1a2b3c", "#ddeeff"],
    model: "claude-sonnet-4-5",
    claims: ["Handles 120 requests per second (from README, unverified)"],
    regen: 0,
    sourceRepo: SOURCE,
    headSha: HEAD_SHA,
    ...over,
  };
}

function sign(raw: string, secret = SECRET): string {
  return `sha256=${crypto.createHmac("sha256", secret).update(raw).digest("hex")}`;
}

function intakeRequest(raw: string, signature?: string | null): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const sig = signature === undefined ? sign(raw) : signature;
  if (sig !== null) headers["x-signature"] = sig;
  return new Request("https://ego.example.com/api/portfolio-draft", { method: "POST", headers, body: raw });
}

type Sent = { chatId: number; text: string; markup?: DraftMarkup };

function makeDeps(over: Partial<DraftDeps> = {}) {
  const sent: Sent[] = [];
  const answers: Array<{ id: string; text?: string }> = [];
  const cleared: number[] = [];
  const merges: string[] = [];
  const mergeShas: string[] = [];
  const closes: string[] = [];
  const dispatches: Array<{ event: string; payload: Record<string, unknown> }> = [];
  let clock = NOW;
  let mergeResult: MergeOutcome | Error = { result: "merged" };
  let closeError: Error | null = null;
  let dispatchError: Error | null = null;
  let prMerged: boolean | Error = false;
  const prChecks: string[] = [];
  const store = createMemoryDraftStore();
  const deps: DraftDeps = {
    store,
    ownerId: OWNER,
    portfolioRepo: REPO,
    now: () => clock,
    send: async (chatId, text, markup) => {
      sent.push({ chatId, text, markup });
    },
    answerCallback: async (id, text) => {
      answers.push({ id, text });
    },
    clearKeyboard: async (_chatId, messageId) => {
      cleared.push(messageId);
    },
    mergePr: async (prUrl, expectedSha) => {
      merges.push(prUrl);
      mergeShas.push(expectedSha);
      if (mergeResult instanceof Error) throw mergeResult;
      return mergeResult;
    },
    closePr: async (prUrl) => {
      closes.push(prUrl);
      if (closeError) throw closeError;
    },
    dispatchWorkflow: async (event, p) => {
      dispatches.push({ event, payload: p as Record<string, unknown> });
      if (dispatchError) throw dispatchError;
    },
    isPrMerged: async (prUrl) => {
      prChecks.push(prUrl);
      if (prMerged instanceof Error) throw prMerged;
      return prMerged;
    },
    ...over,
  };
  return {
    deps,
    store,
    sent,
    answers,
    cleared,
    merges,
    mergeShas,
    closes,
    dispatches,
    prChecks,
    setPrMerged: (v: boolean | Error) => {
      prMerged = v;
    },
    setNow: (ms: number) => {
      clock = ms;
    },
    setMerge: (r: MergeOutcome | Error) => {
      mergeResult = r;
    },
    setCloseError: (e: Error | null) => {
      closeError = e;
    },
    setDispatchError: (e: Error | null) => {
      dispatchError = e;
    },
  };
}

function storedDraft(over: Partial<Draft> = {}): Draft {
  return {
    id: ID,
    repo: REPO,
    kind: "new",
    prUrl: PR_URL,
    previewUrl: "https://preview.example.vercel.app",
    screenshotUrl: null,
    colours: ["#1a2b3c", "#ddeeff"],
    model: "claude-sonnet-4-5",
    claims: [],
    regen: 0,
    status: "pending",
    createdAt: new Date(NOW).toISOString(),
    expiresAt: new Date(NOW + DRAFT_TTL_MS).toISOString(),
    repingedAt: null,
    notifiedAt: new Date(NOW).toISOString(),
    awaitingNote: false,
    lockedAt: null,
    sourceRepo: SOURCE,
    headSha: HEAD_SHA,
    ...over,
  };
}

function cb(data: string, userId = OWNER) {
  return { data, userId, callbackId: "cbq-1", chatId: OWNER, messageId: 77 };
}

function lastText(sent: Sent[]): string {
  return (sent[sent.length - 1]?.text ?? "").toLowerCase();
}

function flatButtons(markup?: DraftMarkup): Array<Record<string, string>> {
  if (!markup || !("inline_keyboard" in markup)) return [];
  return markup.inline_keyboard.flat() as Array<Record<string, string>>;
}

// ---------------------------------------------------------------- intake

async function intakeTests() {
  console.log("\n--- Intake: signature, validation, storage, message ---");

  await test("missing signature", async () => {
    const t = makeDeps();
    const raw = JSON.stringify(payload());
    const res = await handleDraftIntake(intakeRequest(raw, null), { ...t.deps, secret: SECRET });
    assert(res.status === 401, "missing x-signature -> 401", res.status);
    assert((await t.store.list()).length === 0 && t.sent.length === 0, "missing signature stores and sends nothing");
  });

  await test("bad signatures", async () => {
    const t = makeDeps();
    const raw = JSON.stringify(payload());
    const cases: Array<[string, string]> = [
      ["wrong secret", sign(raw, "another-secret")],
      ["signed a different body", sign(JSON.stringify(payload({ regen: 1 })))],
      ["no sha256= prefix", sign(raw).slice("sha256=".length)],
      ["truncated hex", sign(raw).slice(0, 40)],
      ["uppercase prefix", sign(raw).replace("sha256=", "SHA256=")],
      ["non-hex", `sha256=${"z".repeat(64)}`],
    ];
    for (const [name, sig] of cases) {
      const res = await handleDraftIntake(intakeRequest(raw, sig), { ...t.deps, secret: SECRET });
      assert(res.status === 401, `bad signature (${name}) -> 401`, res.status);
    }
    assert((await t.store.list()).length === 0 && t.sent.length === 0, "bad signatures store and send nothing");
  });

  await test("bad signature beats bad body", async () => {
    const t = makeDeps();
    const res = await handleDraftIntake(intakeRequest("{not json", "sha256=" + "0".repeat(64)), {
      ...t.deps,
      secret: SECRET,
    });
    assert(res.status === 401, "unsigned malformed body -> 401 (signature checked before parsing)", res.status);
  });

  await test("secret unset fails closed", async () => {
    const t = makeDeps();
    const raw = JSON.stringify(payload());
    const res = await handleDraftIntake(intakeRequest(raw, sign(raw)), { ...t.deps, secret: undefined });
    assert(res.status === 500, "unset secret -> 500", res.status);
    const res2 = await handleDraftIntake(intakeRequest(raw, sign(raw, "")), { ...t.deps, secret: "" });
    assert(res2.status === 500, "empty secret -> 500 (an empty-key HMAC is not accepted)", res2.status);
    assert((await t.store.list()).length === 0 && t.sent.length === 0, "unset secret stores and sends nothing");

    const env = process.env as Record<string, string | undefined>;
    const saved = env.EGO_WEBHOOK_SECRET;
    delete env.EGO_WEBHOOK_SECRET;
    try {
      const routeRes = await intakeRoute(intakeRequest(raw, sign(raw)));
      assert(routeRes.status === 500, "route with EGO_WEBHOOK_SECRET unset -> 500", routeRes.status);
    } finally {
      if (saved !== undefined) env.EGO_WEBHOOK_SECRET = saved;
    }
  });

  await test("valid request", async () => {
    const t = makeDeps();
    const raw = JSON.stringify(payload());
    const res = await handleDraftIntake(intakeRequest(raw), { ...t.deps, secret: SECRET });
    assert(res.status === 200, "valid signed request -> 200", res.status);
    const d = await t.store.get(ID);
    assert(d !== null && d.status === "pending", "draft stored as pending");
    assert(d?.expiresAt === new Date(NOW + 7 * DAY).toISOString(), "expiresAt = now + 7 days", d?.expiresAt);
    assert(d?.createdAt === new Date(NOW).toISOString(), "createdAt = now");
    assert(d?.notifiedAt === new Date(NOW).toISOString(), "notifiedAt recorded after the send");
    assert(d?.headSha === HEAD_SHA, "the PR head sha is stored with the draft", d?.headSha);
    assert(t.sent.length === 1, "exactly one Telegram message", t.sent.length);
    assert(t.sent[0]?.chatId === OWNER, "message goes to Evan's chat only", t.sent[0]?.chatId);
    const buttons = flatButtons(t.sent[0]?.markup);
    const labels = buttons.map((b) => b.text);
    assert(
      JSON.stringify(labels) === JSON.stringify(["Approve", "Reject", "Edit", "Open preview"]),
      "buttons are Approve / Reject / Edit / Open preview",
      labels
    );
    assert(buttons[0]?.callback_data === `pd:a:${ID}`, "Approve callback is pd:a:<id>", buttons[0]);
    assert(buttons[1]?.callback_data === `pd:r:${ID}`, "Reject callback is pd:r:<id>", buttons[1]);
    assert(buttons[2]?.callback_data === `pd:e:${ID}`, "Edit callback is pd:e:<id>", buttons[2]);
    assert(
      buttons[3]?.url === payload().previewUrl && buttons[3]?.callback_data === undefined,
      "Open preview is a URL button",
      buttons[3]
    );
    assert(
      buttons.every((b) => !b.callback_data || Buffer.byteLength(b.callback_data, "utf-8") <= 64),
      "every callback_data fits Telegram's 64-byte limit"
    );
    const text = t.sent[0]?.text ?? "";
    assert(text.includes(PR_URL), "message includes the PR URL");
    assert(text.includes("#1a2b3c") && text.includes("#ddeeff"), "message prints both colours");
    assert(text.includes("Handles 120 requests per second"), "message lists the unverified claims");
    assert(/unverified/i.test(text), "claims are flagged unverified");
  });

  await test("no preview", async () => {
    const t = makeDeps();
    const raw = JSON.stringify(payload({ previewUrl: null, screenshotUrl: null }));
    const res = await handleDraftIntake(intakeRequest(raw), { ...t.deps, secret: SECRET });
    assert(res.status === 200, "null previewUrl accepted", res.status);
    const labels = flatButtons(t.sent[0]?.markup).map((b) => b.text);
    assert(!labels.includes("Open preview"), "Open preview omitted when previewUrl is null", labels);
  });

  await test("preview on a vercel.app host", async () => {
    for (const previewUrl of ["https://evan-portfolio-abc123-evanyap7.vercel.app/", "https://EVAN-PORTFOLIO.Vercel.App/work/x.html"]) {
      const t = makeDeps();
      const res = await handleDraftIntake(intakeRequest(JSON.stringify(payload({ previewUrl }))), { ...t.deps, secret: SECRET });
      assert(res.status === 200, `${previewUrl} accepted`, res.status);
    }
  });

  await test("source repo stored", async () => {
    const t = makeDeps();
    const raw = JSON.stringify(payload({ sourceRepo: "Chaperone.app_v2-x" }));
    const res = await handleDraftIntake(intakeRequest(raw), { ...t.deps, secret: SECRET });
    assert(res.status === 200, "sourceRepo with dots, underscores, capitals accepted", res.status);
    const d = await t.store.get(ID);
    assert(d?.sourceRepo === "Chaperone.app_v2-x" && d.repo === REPO, "sourceRepo persisted; repo stays the portfolio repo", d);
    assert((t.sent[0]?.text ?? "").includes("Chaperone.app_v2-x"), "message names the source repo");
  });

  await test("duplicate delivery", async () => {
    const t = makeDeps();
    const raw = JSON.stringify(payload());
    await handleDraftIntake(intakeRequest(raw), { ...t.deps, secret: SECRET });
    const res = await handleDraftIntake(intakeRequest(raw), { ...t.deps, secret: SECRET });
    assert(res.status === 200, "same id again -> 200 (Action retry is safe)", res.status);
    assert(t.sent.length === 1, "duplicate sends no second message", t.sent.length);
    assert((await t.store.list()).length === 1, "duplicate stores no second row");
  });

  await test("regenerated draft reusing the id", async () => {
    const t = makeDeps();
    await t.store.save(storedDraft({ status: "regenerating", regen: 0 }));
    const raw = JSON.stringify(payload({ regen: 1, headSha: NEW_SHA }));
    const res = await handleDraftIntake(intakeRequest(raw), { ...t.deps, secret: SECRET });
    assert(res.status === 200 && t.sent.length === 1, "regenerated draft (same id, higher regen) is announced", res.status);
    const d = await t.store.get(ID);
    assert(d?.status === "pending" && d.regen === 1, "superseded row replaced by the new pending draft", d);
    assert(d?.headSha === NEW_SHA, "the regenerated draft's head sha replaces the old one", d?.headSha);
    const again = await handleDraftIntake(intakeRequest(JSON.stringify(payload({ regen: 0 }))), { ...t.deps, secret: SECRET });
    assert(again.status === 200 && t.sent.length === 1, "a stale lower-regen delivery is a duplicate");
    assert((await t.store.get(ID))?.headSha === NEW_SHA, "a stale delivery does not bring back the old sha");
    await handlePortfolioDraftCallback(cb(`pd:a:${ID}`), t.deps);
    assert(t.mergeShas[0] === NEW_SHA, "Approve after a regeneration merges the new head", t.mergeShas);
  });

  await test("send failure then retry", async () => {
    let fail = true;
    const t = makeDeps();
    t.deps.send = async (chatId, text, markup) => {
      if (fail) throw new Error("telegram down");
      t.sent.push({ chatId, text, markup });
    };
    const raw = JSON.stringify(payload());
    const res = await handleDraftIntake(intakeRequest(raw), { ...t.deps, secret: SECRET });
    assert(res.status === 502, "Telegram failure -> 502 so the Action retries", res.status);
    assert((await t.store.get(ID))?.notifiedAt === null, "draft kept with notifiedAt empty");
    fail = false;
    const res2 = await handleDraftIntake(intakeRequest(raw), { ...t.deps, secret: SECRET });
    assert(res2.status === 200 && t.sent.length === 1, "retry of an un-notified draft sends the message once");
  });

  await test("untrusted text", async () => {
    const t = makeDeps();
    const raw = JSON.stringify(
      payload({ claims: ["*bold* _x_ [link](https://evil.example) \u202Eevil\u0000 <b>tag</b>\nsecond line"] })
    );
    const res = await handleDraftIntake(intakeRequest(raw), { ...t.deps, secret: SECRET });
    assert(res.status === 200, "claim with markup characters accepted", res.status);
    const text = t.sent[0]?.text ?? "";
    assert(!/[\u0000\u202E]/.test(text), "control and bidi characters stripped from the message");
    assert(text.includes("*bold* _x_ [link](https://evil.example)"), "markup characters kept literally (plain-text message)");
    assert(!text.includes("tag</b>\nsecond"), "newlines inside a claim do not start new lines");
  });

  await test("malformed payloads -> 400, nothing stored", async () => {
    const bad: Array<[string, string]> = [
      ["invalid JSON", "{nope"],
      ["array body", "[]"],
      ["id with uppercase", JSON.stringify(payload({ id: `Chaperone-${NOW_S}` }))],
      ["id without timestamp", JSON.stringify(payload({ id: "chaperone" }))],
      ["id with path chars", JSON.stringify(payload({ id: `../x-${NOW_S}` }))],
      ["id too long for callback_data", JSON.stringify(payload({ id: `${"a".repeat(60)}-${NOW_S}` }))],
      ["repo not the configured one", JSON.stringify(payload({ repo: "someone/else" }))],
      ["repo bad shape", JSON.stringify(payload({ repo: "evanyap7/evan portfolio" }))],
      ["repo missing", JSON.stringify(payload({ repo: undefined }))],
      ["kind invalid", JSON.stringify(payload({ kind: "deleted" }))],
      ["prUrl on another repo", JSON.stringify(payload({ prUrl: "https://github.com/someone/else/pull/1" }))],
      ["prUrl http", JSON.stringify(payload({ prUrl: `http://github.com/${REPO}/pull/42` }))],
      ["prUrl with query", JSON.stringify(payload({ prUrl: `${PR_URL}?x=1` }))],
      ["prUrl not a pull", JSON.stringify(payload({ prUrl: `https://github.com/${REPO}/issues/42` }))],
      ["prUrl other host", JSON.stringify(payload({ prUrl: `https://github.com.evil.example/${REPO}/pull/42` }))],
      ["previewUrl http", JSON.stringify(payload({ previewUrl: "http://preview.example" }))],
      ["previewUrl javascript:", JSON.stringify(payload({ previewUrl: "javascript:alert(1)" }))],
      ["previewUrl with credentials", JSON.stringify(payload({ previewUrl: "https://u:p@preview.example" }))],
      ["previewUrl not on vercel.app", JSON.stringify(payload({ previewUrl: "https://evil.example/preview" }))],
      ["previewUrl bare vercel.app", JSON.stringify(payload({ previewUrl: "https://vercel.app" }))],
      ["previewUrl vercel.app as a subdomain", JSON.stringify(payload({ previewUrl: "https://x.vercel.app.evil.example" }))],
      ["previewUrl lookalike host", JSON.stringify(payload({ previewUrl: "https://evilvercel.app" }))],
      ["previewUrl with a port", JSON.stringify(payload({ previewUrl: "https://x.vercel.app:8443" }))],
      ["previewUrl credentials on vercel.app", JSON.stringify(payload({ previewUrl: "https://u@x.vercel.app" }))],
      ["screenshotUrl number", JSON.stringify(payload({ screenshotUrl: 5 }))],
      ["colours one entry", JSON.stringify(payload({ colours: ["#112233"] }))],
      ["colours bad hex", JSON.stringify(payload({ colours: ["#112233", "red"] }))],
      ["colours short hex", JSON.stringify(payload({ colours: ["#123", "#112233"] }))],
      ["model with spaces", JSON.stringify(payload({ model: "ignore previous instructions" }))],
      ["regen 4", JSON.stringify(payload({ regen: 4 }))],
      ["regen -1", JSON.stringify(payload({ regen: -1 }))],
      ["regen 1.5", JSON.stringify(payload({ regen: 1.5 }))],
      ["regen string", JSON.stringify(payload({ regen: "1" }))],
      ["claims not array", JSON.stringify(payload({ claims: "a claim" }))],
      ["claims non-string item", JSON.stringify(payload({ claims: ["ok", 3] }))],
      ["claims too many", JSON.stringify(payload({ claims: Array.from({ length: 21 }, (_, i) => `c${i}`) }))],
      ["claim too long", JSON.stringify(payload({ claims: ["x".repeat(301)] }))],
      ["unknown extra field", JSON.stringify(payload({ mergeNow: true }))],
      ["sourceRepo missing", JSON.stringify(payload({ sourceRepo: undefined }))],
      ["sourceRepo empty", JSON.stringify(payload({ sourceRepo: "" }))],
      ["sourceRepo with owner/slash", JSON.stringify(payload({ sourceRepo: "evanyap7/chaperone" }))],
      ["sourceRepo with space", JSON.stringify(payload({ sourceRepo: "my repo" }))],
      ["sourceRepo dot-dot", JSON.stringify(payload({ sourceRepo: ".." }))],
      ["sourceRepo number", JSON.stringify(payload({ sourceRepo: 7 }))],
      ["sourceRepo too long", JSON.stringify(payload({ sourceRepo: "r".repeat(101) }))],
      ["headSha missing", JSON.stringify(payload({ headSha: undefined }))],
      ["headSha empty", JSON.stringify(payload({ headSha: "" }))],
      ["headSha short", JSON.stringify(payload({ headSha: "abc123" }))],
      ["headSha uppercase", JSON.stringify(payload({ headSha: HEAD_SHA.toUpperCase() }))],
      ["headSha 41 chars", JSON.stringify(payload({ headSha: `${HEAD_SHA}0` }))],
      ["headSha null", JSON.stringify(payload({ headSha: null }))],
    ];
    for (const [name, raw] of bad) {
      const t = makeDeps();
      const res = await handleDraftIntake(intakeRequest(raw), { ...t.deps, secret: SECRET });
      assert(res.status === 400, `${name} -> 400`, res.status);
      assert((await t.store.list()).length === 0 && t.sent.length === 0, `${name}: nothing stored or sent`);
    }
  });

  await test("oversized body", async () => {
    const t = makeDeps();
    const raw = JSON.stringify(payload({ model: "m".repeat(70_000) }));
    const res = await handleDraftIntake(intakeRequest(raw), { ...t.deps, secret: SECRET });
    assert(res.status === 413, "body over the size cap -> 413", res.status);
  });
}

// ---------------------------------------------------------------- store

async function storeTests() {
  console.log("\n--- Store: resolveDraft guard, rows ---");

  await test("resolveDraft guard", async () => {
    const store = createMemoryDraftStore();
    await saveDraft(storedDraft(), store);
    assert((await getDraft(ID, store))?.status === "pending", "saveDraft/getDraft round trip");
    assert((await getDraft("missing-1", store)) === null, "getDraft of an unknown id is null");
    assert((await resolveDraft(ID, "approved", store)) === true, "first resolveDraft returns true");
    assert((await resolveDraft(ID, "approved", store)) === false, "second resolveDraft returns false");
    assert((await resolveDraft(ID, "rejected", store)) === false, "a resolved draft cannot be re-resolved");
    assert((await resolveDraft("missing-1", "expired", store)) === false, "resolveDraft of an unknown id is false");
  });

  await test("row mapping", async () => {
    const d = storedDraft({ claims: ["a", "b"], awaitingNote: true, repingedAt: "2026-11-29T08:00:00.000Z" });
    const back = rowToDraft(draftToRow(d).map(String));
    assert(JSON.stringify(back) === JSON.stringify(d), "draftToRow -> rowToDraft round trip", back);
    const weird = rowToDraft([...draftToRow(d).map(String).slice(0, 10), "approvd-typo"]);
    assert(weird.status === "expired", "unknown status reads as expired (terminal, non-actionable)", weird.status);
    const broken = draftToRow(d).map(String);
    broken[8] = "{not json";
    assert(JSON.stringify(rowToDraft(broken).claims) === "[]", "unparseable claims read as empty");
  });
}

// ---------------------------------------------------------------- callbacks

async function seeded(over: Partial<Draft> = {}) {
  const t = makeDeps();
  await t.store.save(storedDraft(over));
  return t;
}

async function callbackTests() {
  console.log("\n--- Callbacks: Approve / Reject / Edit ---");

  await test("approve merges once", async () => {
    const t = await seeded();
    await handlePortfolioDraftCallback(cb(`pd:a:${ID}`), t.deps);
    assert(t.merges.length === 1 && t.merges[0] === PR_URL, "Approve calls mergePr once with the PR URL", t.merges);
    assert(t.mergeShas[0] === HEAD_SHA, "Approve pins the merge to the stored head sha", t.mergeShas);
    assert((await t.store.get(ID))?.status === "approved", "draft marked approved");
    assert(/merged/.test(lastText(t.sent)), "reply says merged", lastText(t.sent));
    assert(t.answers.length === 1, "callback answered once");
    assert(t.cleared.includes(77), "buttons removed after the merge");

    await handlePortfolioDraftCallback(cb(`pd:a:${ID}`), t.deps);
    assert(t.merges.length === 1, "second Approve makes no second merge", t.merges.length);
    assert(lastText(t.sent).includes("already done"), "second Approve replies 'already done'", lastText(t.sent));
  });

  await test("approve after expiry", async () => {
    const t = await seeded();
    t.setNow(NOW + 7 * DAY + 1000);
    await handlePortfolioDraftCallback(cb(`pd:a:${ID}`), t.deps);
    assert(t.merges.length === 0, "no merge after expiry");
    assert(lastText(t.sent).includes("expired, pr still open"), "reply 'expired, PR still open'", lastText(t.sent));
    assert((await t.store.get(ID))?.status === "expired", "draft marked expired");

    const t2 = await seeded({ status: "expired" });
    await handlePortfolioDraftCallback(cb(`pd:a:${ID}`), t2.deps);
    assert(t2.merges.length === 0 && lastText(t2.sent).includes("expired, pr still open"), "already-expired draft: same reply");
  });

  await test("approve refused", async () => {
    const reasons: Array<[MergeOutcome["reason"], RegExp]> = [
      ["pr-closed", /closed/],
      ["repo-private", /private/],
      ["pr-draft", /draft/],
      ["wrong-branch", /auto\/project-/],
      ["wrong-repo", /portfolio repo/],
      ["not-mergeable", /can't be merged|cannot be merged/],
      ["not-configured", /not configured|isn't configured/],
      ["head-changed", /changed since this message.*new message/],
    ];
    for (const [reason, pattern] of reasons) {
      const t = await seeded();
      t.setMerge({ result: "refused", reason });
      await handlePortfolioDraftCallback(cb(`pd:a:${ID}`), t.deps);
      assert(t.merges.length === 1, `${reason}: mergePr tried once`);
      assert(pattern.test(lastText(t.sent)), `${reason}: reply explains`, lastText(t.sent));
      assert(/nothing merged|not merged/.test(lastText(t.sent)), `${reason}: reply says nothing merged`);
      const d = await t.store.get(ID);
      assert(d?.status === "pending" && d.lockedAt === null, `${reason}: draft back to pending, not stuck`, d?.status);
    }
  });

  await test("approve without a recorded head sha fails closed", async () => {
    for (const headSha of ["", "abc123", "not a sha"]) {
      const t = await seeded({ headSha });
      await handlePortfolioDraftCallback(cb(`pd:a:${ID}`), t.deps);
      assert(t.merges.length === 0, `headSha ${JSON.stringify(headSha)}: no merge call`, t.merges);
      assert(/nothing merged|not merged/.test(lastText(t.sent)), `headSha ${JSON.stringify(headSha)}: reply says nothing merged`, lastText(t.sent));
      assert(/edit/.test(lastText(t.sent)), `headSha ${JSON.stringify(headSha)}: reply points at Edit to regenerate`, lastText(t.sent));
      const d = await t.store.get(ID);
      assert(d?.status === "pending" && d.lockedAt === null, `headSha ${JSON.stringify(headSha)}: draft left pending`, d);
    }
  });

  await test("approve when GitHub errors", async () => {
    const t = await seeded();
    t.setMerge(new Error("GitHub 502"));
    await handlePortfolioDraftCallback(cb(`pd:a:${ID}`), t.deps);
    assert((await t.store.get(ID))?.status === "pending", "GitHub error: draft back to pending");
    assert(/couldn't|could not/.test(lastText(t.sent)), "GitHub error: reply says it failed", lastText(t.sent));
    t.setMerge({ result: "merged" });
    await handlePortfolioDraftCallback(cb(`pd:a:${ID}`), t.deps);
    assert(t.merges.length === 2 && (await t.store.get(ID))?.status === "approved", "a later Approve can retry and merge");
  });

  await test("approve when already merged on GitHub", async () => {
    const t = await seeded();
    t.setMerge({ result: "already" });
    await handlePortfolioDraftCallback(cb(`pd:a:${ID}`), t.deps);
    assert((await t.store.get(ID))?.status === "approved", "'already' marks the draft approved");
    assert(/already merged/.test(lastText(t.sent)), "reply says it was already merged", lastText(t.sent));
  });

  await test("approve while a merge is in flight", async () => {
    const t = await seeded({ status: "merging", lockedAt: new Date(NOW - 10_000).toISOString() });
    await handlePortfolioDraftCallback(cb(`pd:a:${ID}`), t.deps);
    assert(t.merges.length === 0, "in-flight merge: no second merge");
    assert(/in progress/.test(lastText(t.sent)), "in-flight merge: reply says in progress", lastText(t.sent));

    const stale = await seeded({ status: "merging", lockedAt: new Date(NOW - MERGE_LOCK_MS - 1000).toISOString() });
    await handlePortfolioDraftCallback(cb(`pd:a:${ID}`), stale.deps);
    assert(stale.merges.length === 1, "stale merge lock (crashed attempt) can be retried");
    assert((await stale.store.get(ID))?.status === "approved", "retry after a stale lock marks approved");
  });

  await test("approve on an expired draft with a stale merge lock", async () => {
    // A crashed merge left the draft "merging"; 8 days later the lock is stale and the draft expired.
    const late = NOW + 8 * DAY;
    const t = await seeded({ status: "merging", lockedAt: new Date(late - MERGE_LOCK_MS - 1000).toISOString() });
    t.setNow(late);
    await handlePortfolioDraftCallback(cb(`pd:a:${ID}`), t.deps);
    assert(t.merges.length === 0, "expired + stale lock: no merge", t.merges.length);
    assert(lastText(t.sent).includes("expired, pr still open"), "expired + stale lock: reply 'expired, PR still open'", lastText(t.sent));
    assert((await t.store.get(ID))?.status === "expired", "expired + stale lock: draft marked expired");

    const fresh = await seeded({ status: "merging", lockedAt: new Date(late - 1000).toISOString() });
    fresh.setNow(late);
    await handlePortfolioDraftCallback(cb(`pd:a:${ID}`), fresh.deps);
    assert(fresh.merges.length === 0 && /in progress/.test(lastText(fresh.sent)), "expired + fresh lock: in-flight merge left alone");
  });

  await test("refused merge when GitHub shows the PR merged", async () => {
    const t = await seeded();
    t.setMerge({ result: "refused", reason: "not-mergeable" });
    t.setPrMerged(true);
    await handlePortfolioDraftCallback(cb(`pd:a:${ID}`), t.deps);
    assert((await t.store.get(ID))?.status === "approved", "refused but PR merged: draft approved, not back to pending");
    assert(!/not merged|nothing merged/.test(lastText(t.sent)), "refused but PR merged: no 'Not merged' reply", lastText(t.sent));
    assert(/already merged/.test(lastText(t.sent)), "refused but PR merged: reply says it is merged", lastText(t.sent));
  });

  for (const loser of [
    { result: "refused", reason: "not-mergeable" },
    { result: "already" },
  ] as MergeOutcome[]) {
    await test(`two simultaneous Approve taps (second merge call -> ${loser.result})`, async () => {
      const t = await seeded();
      // Sheets-like store: read, yield, then compare and write, so both taps can claim the lock.
      const inner = t.store;
      t.deps.store = {
        get: (id) => inner.get(id),
        save: (d) => inner.save(d),
        list: () => inner.list(),
        async update(id, when, patch, guard) {
          const d = await inner.get(id);
          await new Promise((r) => setTimeout(r, 0));
          if (!d || !when.includes(d.status) || (guard && !guard(d))) return null;
          const next = { ...d, ...patch, id: d.id };
          await inner.save(next);
          return next;
        },
      };
      // Fake GitHub: the first merge call merges; later calls see an already-merged PR.
      let githubMerged = false;
      t.deps.mergePr = async (prUrl) => {
        t.merges.push(prUrl);
        await new Promise((r) => setTimeout(r, 0));
        if (!githubMerged) {
          githubMerged = true;
          return { result: "merged" };
        }
        return loser;
      };
      t.deps.isPrMerged = async () => githubMerged;

      await Promise.all([
        handlePortfolioDraftCallback(cb(`pd:a:${ID}`), t.deps),
        handlePortfolioDraftCallback(cb(`pd:a:${ID}`), t.deps),
      ]);
      const replies = t.sent.map((m) => m.text.toLowerCase());
      assert(t.merges.length === 2, "the racy store really let both taps reach mergePr", t.merges.length);
      assert(replies.filter((r) => r.includes("approved and merged")).length <= 1, "at most one merge reply", replies);
      assert(!replies.some((r) => /not merged|nothing merged/.test(r)), "no 'Not merged' reply after a merge", replies);
      assert((await inner.get(ID))?.status === "approved", "final status approved", (await inner.get(ID))?.status);

      t.deps.store = inner;
      t.setNow(NOW + 8 * DAY);
      const r = await runDraftExpiryPass(t.deps);
      assert(r.expired === 0 && r.repinged === 0, "cron later leaves the merged draft alone (no 'PR still open')", r);
    });
  }

  await test("reject a regenerating draft", async () => {
    const t = await seeded({ status: "regenerating", regen: 1 });
    await handlePortfolioDraftCallback(cb(`pd:r:${ID}`), t.deps);
    assert(t.closes.length === 1 && t.closes[0] === PR_URL, "Reject on regenerating closes the PR", t.closes);
    assert(
      t.dispatches.length === 1 &&
        t.dispatches[0].event === "draft-rejected" &&
        JSON.stringify(t.dispatches[0].payload) === JSON.stringify({ id: ID, repo: SOURCE }),
      "Reject on regenerating dispatches draft-rejected {id, repo: sourceRepo}",
      t.dispatches
    );
    assert((await t.store.get(ID))?.status === "rejected", "regenerating draft marked rejected");

    const failing = await seeded({ status: "regenerating", regen: 1 });
    failing.setCloseError(new Error("GitHub 500"));
    await handlePortfolioDraftCallback(cb(`pd:r:${ID}`), failing.deps);
    assert((await failing.store.get(ID))?.status === "regenerating", "close failed: draft back to regenerating");

    const approveIt = await seeded({ status: "regenerating", regen: 1 });
    await handlePortfolioDraftCallback(cb(`pd:a:${ID}`), approveIt.deps);
    assert(approveIt.merges.length === 0, "Approve on regenerating still makes no merge");
  });

  await test("reject", async () => {
    const t = await seeded();
    await handlePortfolioDraftCallback(cb(`pd:r:${ID}`), t.deps);
    assert(t.closes.length === 1 && t.closes[0] === PR_URL, "Reject calls closePr once", t.closes);
    assert(
      t.dispatches.length === 1 &&
        t.dispatches[0].event === "draft-rejected" &&
        JSON.stringify(t.dispatches[0].payload) === JSON.stringify({ id: ID, repo: SOURCE }),
      "Reject dispatches draft-rejected {id, repo: sourceRepo}",
      t.dispatches
    );
    assert((await t.store.get(ID))?.status === "rejected", "draft marked rejected");
    assert(t.merges.length === 0, "Reject never merges");
    await handlePortfolioDraftCallback(cb(`pd:r:${ID}`), t.deps);
    assert(t.closes.length === 1 && t.dispatches.length === 1, "second Reject: no second close or dispatch");
    assert(lastText(t.sent).includes("already done"), "second Reject replies 'already done'");
    await handlePortfolioDraftCallback(cb(`pd:a:${ID}`), t.deps);
    assert(t.merges.length === 0, "Approve after Reject makes no merge");
  });

  await test("reject when GitHub errors", async () => {
    const t = await seeded();
    t.setCloseError(new Error("GitHub 500"));
    await handlePortfolioDraftCallback(cb(`pd:r:${ID}`), t.deps);
    assert(t.dispatches.length === 0, "close failed: no dispatch");
    assert((await t.store.get(ID))?.status === "pending", "close failed: draft back to pending");
    assert(/couldn't|could not/.test(lastText(t.sent)), "close failed: reply says so");
  });

  await test("edit then note", async () => {
    const t = await seeded({ regen: 1 });
    await handlePortfolioDraftCallback(cb(`pd:e:${ID}`), t.deps);
    const prompt = t.sent[t.sent.length - 1];
    assert(!!prompt && prompt.chatId === OWNER, "Edit asks Evan for a note");
    assert(!!prompt?.markup && "force_reply" in prompt.markup, "note prompt uses force_reply", prompt?.markup);
    assert(parseNotePromptId(prompt?.text) === ID, "note prompt carries the draft id", prompt?.text);
    assert((await t.store.get(ID))?.awaitingNote === true, "draft row marked awaiting a note");
    assert(t.dispatches.length === 0, "Edit tap alone dispatches nothing");

    await handleDraftNote({ draftId: ID, text: "  make it blue  ", userId: OWNER, chatId: OWNER }, t.deps);
    assert(
      t.dispatches.length === 1 &&
        t.dispatches[0].event === "draft-regenerate" &&
        JSON.stringify(t.dispatches[0].payload) === JSON.stringify({ id: ID, repo: SOURCE, note: "make it blue" }),
      "note dispatches draft-regenerate {id, repo: sourceRepo, note} (trimmed)",
      t.dispatches
    );
    const d = await t.store.get(ID);
    assert(d?.status === "regenerating" && d.awaitingNote === false, "old draft superseded (regenerating)", d?.status);

    await handleDraftNote({ draftId: ID, text: "again", userId: OWNER, chatId: OWNER }, t.deps);
    assert(t.dispatches.length === 1, "a second note for the same draft dispatches nothing");
    await handlePortfolioDraftCallback(cb(`pd:a:${ID}`), t.deps);
    assert(t.merges.length === 0, "Approve on a superseded draft makes no merge");
  });

  await test("edit at the regeneration limit", async () => {
    const t = await seeded({ regen: 3 });
    await handlePortfolioDraftCallback(cb(`pd:e:${ID}`), t.deps);
    assert(/limit/.test(lastText(t.sent)), "regen 3: reply says the limit is reached", lastText(t.sent));
    assert(!t.sent.some((s) => s.markup && "force_reply" in s.markup), "regen 3: no note prompt");
    assert((await t.store.get(ID))?.awaitingNote === false, "regen 3: not awaiting a note");

    const t2 = await seeded({ regen: 3, awaitingNote: true });
    await handleDraftNote({ draftId: ID, text: "make it blue", userId: OWNER, chatId: OWNER }, t2.deps);
    assert(t2.dispatches.length === 0, "regen 3: a note dispatches nothing");
    assert(/limit/.test(lastText(t2.sent)), "regen 3: note reply says the limit is reached");
  });

  await test("note validation", async () => {
    for (const [name, text] of [
      ["empty", "   "],
      ["too long", "x".repeat(501)],
    ] as const) {
      const t = await seeded({ awaitingNote: true });
      await handleDraftNote({ draftId: ID, text, userId: OWNER, chatId: OWNER }, t.deps);
      assert(t.dispatches.length === 0, `${name} note: no dispatch`);
      assert((await t.store.get(ID))?.awaitingNote === true, `${name} note: still awaiting a note`);
      assert(t.sent.length === 1, `${name} note: Evan is told why`);
    }
    const t = await seeded({ awaitingNote: true });
    await handleDraftNote({ draftId: ID, text: "use\u0000 mark-50\u202E", userId: OWNER, chatId: OWNER }, t.deps);
    assert(t.dispatches[0]?.payload.note === "use mark-50", "control characters stripped from the note", t.dispatches[0]);

    const notAsked = await seeded();
    await handleDraftNote({ draftId: ID, text: "make it blue", userId: OWNER, chatId: OWNER }, notAsked.deps);
    assert(notAsked.dispatches.length === 0, "note without an Edit tap dispatches nothing");

    const failing = await seeded({ awaitingNote: true });
    failing.setDispatchError(new Error("GitHub 500"));
    await handleDraftNote({ draftId: ID, text: "make it blue", userId: OWNER, chatId: OWNER }, failing.deps);
    const d = await failing.store.get(ID);
    assert(d?.status === "pending" && d.awaitingNote === true, "dispatch failure: draft back to pending, still awaiting");
  });

  await test("note prompt parsing", async () => {
    assert(parseNotePromptId(undefined) === null, "no reply text -> null");
    assert(parseNotePromptId("hello") === null, "unrelated reply -> null");
    assert(parseNotePromptId(`ID: ${ID}`) === null, "reply to the draft message itself -> null");
  });

  await test("other users are ignored", async () => {
    for (const data of [`pd:a:${ID}`, `pd:r:${ID}`, `pd:e:${ID}`]) {
      const t = await seeded();
      await handlePortfolioDraftCallback(cb(data, STRANGER), t.deps);
      assert(
        t.answers.length === 0 && t.sent.length === 0 && t.cleared.length === 0,
        `${data.slice(0, 4)} from another user: no reply at all`
      );
      assert(
        t.merges.length === 0 && t.closes.length === 0 && t.dispatches.length === 0,
        `${data.slice(0, 4)} from another user: no GitHub call`
      );
      const d = await t.store.get(ID);
      assert(d?.status === "pending" && d.awaitingNote === false, `${data.slice(0, 4)} from another user: no state change`);
    }
    const t = await seeded({ awaitingNote: true });
    await handleDraftNote({ draftId: ID, text: "make it blue", userId: STRANGER, chatId: STRANGER }, t.deps);
    assert(t.dispatches.length === 0 && t.sent.length === 0, "note from another user ignored silently");
  });

  await test("malformed callback data", async () => {
    for (const data of ["pd:x:" + ID, "pd:a:", "pd:a:BAD ID-1", "pd:a:../etc-1", "pd"]) {
      const t = await seeded();
      await handlePortfolioDraftCallback(cb(data), t.deps);
      assert(t.merges.length === 0 && t.closes.length === 0 && t.dispatches.length === 0, `${data}: no action`);
      assert(t.answers.length === 1, `${data}: callback still answered (no spinner left)`);
    }
    const t = makeDeps();
    await handlePortfolioDraftCallback(cb(`pd:a:unknown-${NOW_S}`), t.deps);
    assert(t.merges.length === 0, "unknown draft id: no merge");
  });
}

// ---------------------------------------------------------------- github

type Call = { url: string; method: string; body?: unknown; auth?: string | null };

type Route = { status: number; body?: unknown };

function fakeFetch(routes: Record<string, Route | Route[]>) {
  const calls: Call[] = [];
  const seen = new Map<string, number>();
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    calls.push({
      url,
      method,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      auth: headers.get("authorization"),
    });
    const key = `${method} ${url.replace("https://api.github.com", "")}`;
    const route = routes[key];
    // An array is a sequence of responses; the last one repeats.
    const hit = Array.isArray(route) ? route[Math.min(seen.get(key) ?? 0, route.length - 1)] : route;
    seen.set(key, (seen.get(key) ?? 0) + 1);
    if (!hit) return new Response(JSON.stringify({ message: "Not Found" }), { status: 404 });
    return new Response(hit.body === undefined ? null : JSON.stringify(hit.body), { status: hit.status });
  }) as typeof fetch;
  return { fn, calls };
}

const TOKEN = "github_pat_TESTTOKEN_do_not_log_0123456789";

function prBody(over: Record<string, unknown> = {}) {
  return {
    state: "open",
    merged: false,
    draft: false,
    head: { ref: "auto/project-chaperone", sha: HEAD_SHA, repo: { full_name: REPO } },
    base: { ref: "main", repo: { full_name: REPO } },
    ...over,
  };
}

function ghRoutes(over: Record<string, Route | Route[]> = {}) {
  return {
    [`GET /repos/${REPO}`]: { status: 200, body: { full_name: REPO, private: false, default_branch: "main" } },
    [`GET /repos/${REPO}/pulls/42`]: { status: 200, body: prBody() },
    [`PUT /repos/${REPO}/pulls/42/merge`]: { status: 200, body: { merged: true } },
    [`PATCH /repos/${REPO}/pulls/42`]: { status: 200, body: { state: "closed" } },
    [`POST /repos/${REPO}/dispatches`]: { status: 204 },
    ...over,
  };
}

async function githubTests() {
  console.log("\n--- GitHub: mergePr, closePr, dispatchWorkflow ---");

  await test("merge happy path", async () => {
    const f = fakeFetch(ghRoutes());
    const r = await mergePr(PR_URL, HEAD_SHA, { fetch: f.fn, token: TOKEN, repo: REPO });
    assert(r === "merged", "open PR on auto/project-* -> merged", r);
    const put = f.calls.find((c) => c.method === "PUT");
    assert(
      !!put && (put.body as Record<string, unknown>).merge_method === "squash",
      "merge method is squash",
      put?.body
    );
    assert((put?.body as Record<string, unknown>)?.sha === HEAD_SHA, "merge pinned to the reviewed head sha");
    assert(f.calls.every((c) => c.auth === `Bearer ${TOKEN}`), "token sent as a Bearer header");
  });

  await test("merge refusals", async () => {
    const cases: Array<[string, Record<string, Route | Route[]>, string]> = [
      ["PR closed", { [`GET /repos/${REPO}/pulls/42`]: { status: 200, body: prBody({ state: "closed" }) } }, "pr-closed"],
      ["PR is a draft", { [`GET /repos/${REPO}/pulls/42`]: { status: 200, body: prBody({ draft: true }) } }, "pr-draft"],
      [
        "head ref not auto/project-",
        { [`GET /repos/${REPO}/pulls/42`]: { status: 200, body: prBody({ head: { ref: "main", sha: "x", repo: { full_name: REPO } } }) } },
        "wrong-branch",
      ],
      [
        "head from a fork",
        {
          [`GET /repos/${REPO}/pulls/42`]: {
            status: 200,
            body: prBody({ head: { ref: "auto/project-x", sha: "x", repo: { full_name: "mallory/evan-portfolio-website" } } }),
          },
        },
        "wrong-repo",
      ],
      [
        "base not the default branch",
        { [`GET /repos/${REPO}/pulls/42`]: { status: 200, body: prBody({ base: { ref: "gh-pages", repo: { full_name: REPO } } }) } },
        "wrong-branch",
      ],
      ["repo now private", { [`GET /repos/${REPO}`]: { status: 200, body: { full_name: REPO, private: true, default_branch: "main" } } }, "repo-private"],
      ["GitHub says not mergeable", { [`PUT /repos/${REPO}/pulls/42/merge`]: { status: 405, body: { message: "not mergeable" } } }, "not-mergeable"],
      ["head moved (409)", { [`PUT /repos/${REPO}/pulls/42/merge`]: { status: 409, body: { message: "Head branch was modified" } } }, "head-changed"],
      ["PR not found", { [`GET /repos/${REPO}/pulls/42`]: { status: 404, body: { message: "Not Found" } } }, "pr-closed"],
      [
        "head is not the reviewed commit",
        { [`GET /repos/${REPO}/pulls/42`]: { status: 200, body: prBody({ head: { ref: "auto/project-chaperone", sha: NEW_SHA, repo: { full_name: REPO } } }) } },
        "head-changed",
      ],
    ];
    for (const [name, over, reason] of cases) {
      const f = fakeFetch(ghRoutes(over));
      const r = await mergePrWithReason(PR_URL, HEAD_SHA, { fetch: f.fn, token: TOKEN, repo: REPO });
      assert(r.result === "refused" && r.reason === reason, `${name} -> refused (${reason})`, r);
      if (name !== "GitHub says not mergeable" && name !== "head moved (409)") {
        assert(!f.calls.some((c) => c.method === "PUT"), `${name}: no merge call`);
      }
    }
    const r = await mergePr(PR_URL, HEAD_SHA, { fetch: fakeFetch(ghRoutes({ [`GET /repos/${REPO}/pulls/42`]: { status: 200, body: prBody({ state: "closed" }) } })).fn, token: TOKEN, repo: REPO });
    assert(r === "refused", "mergePr returns the bare 'refused'", r);
    for (const bad of ["", "abc123", HEAD_SHA.toUpperCase()]) {
      const f = fakeFetch(ghRoutes());
      const out = await mergePrWithReason(PR_URL, bad, { fetch: f.fn, token: TOKEN, repo: REPO });
      assert(out.result === "refused" && out.reason === "head-changed", `expected sha ${JSON.stringify(bad)} -> refused (head-changed)`, out);
      assert(f.calls.length === 0, `expected sha ${JSON.stringify(bad)}: no GitHub call`, f.calls.length);
    }
  });

  await test("merge call rejected because another tap merged first", async () => {
    for (const status of [405, 409, 422]) {
      const f = fakeFetch(
        ghRoutes({
          [`GET /repos/${REPO}/pulls/42`]: [
            { status: 200, body: prBody() },
            { status: 200, body: prBody({ state: "closed", merged: true }) },
          ],
          [`PUT /repos/${REPO}/pulls/42/merge`]: { status, body: { message: "Pull Request is not mergeable" } },
        })
      );
      const r = await mergePrWithReason(PR_URL, HEAD_SHA, { fetch: f.fn, token: TOKEN, repo: REPO });
      assert(r.result === "already", `PUT ${status} then PR shows merged -> already`, r);
      assert(f.calls.filter((c) => c.method === "GET" && c.url.endsWith("/pulls/42")).length === 2, `PUT ${status}: PR re-read once`);
    }
    const reGetFails = fakeFetch(
      ghRoutes({
        [`GET /repos/${REPO}/pulls/42`]: [{ status: 200, body: prBody() }, { status: 500 }],
        [`PUT /repos/${REPO}/pulls/42/merge`]: { status: 405 },
      })
    );
    const r = await mergePrWithReason(PR_URL, HEAD_SHA, { fetch: reGetFails.fn, token: TOKEN, repo: REPO });
    assert(r.result === "refused" && r.reason === "not-mergeable", "PUT 405 and the re-read fails -> not-mergeable", r);
  });

  await test("isPrMerged", async () => {
    const merged = fakeFetch(ghRoutes({ [`GET /repos/${REPO}/pulls/42`]: { status: 200, body: prBody({ state: "closed", merged: true }) } }));
    assert((await isPrMerged(PR_URL, { fetch: merged.fn, token: TOKEN, repo: REPO })) === true, "merged PR -> true");
    const open = fakeFetch(ghRoutes());
    assert((await isPrMerged(PR_URL, { fetch: open.fn, token: TOKEN, repo: REPO })) === false, "open PR -> false");
    const other = fakeFetch(ghRoutes());
    assert(
      (await isPrMerged("https://github.com/someone/else/pull/1", { fetch: other.fn, token: TOKEN, repo: REPO })) === false &&
        other.calls.length === 0,
      "PR on another repo -> false, no request"
    );
    let threw = false;
    try {
      await isPrMerged(PR_URL, { fetch: fakeFetch(ghRoutes({ [`GET /repos/${REPO}/pulls/42`]: { status: 500 } })).fn, token: TOKEN, repo: REPO });
    } catch (err) {
      threw = !(err instanceof Error && err.message.includes(TOKEN));
    }
    assert(threw, "GitHub 500 throws (without the token)");
  });

  await test("merge already merged", async () => {
    const f = fakeFetch(ghRoutes({ [`GET /repos/${REPO}/pulls/42`]: { status: 200, body: prBody({ state: "closed", merged: true }) } }));
    const r = await mergePr(PR_URL, HEAD_SHA, { fetch: f.fn, token: TOKEN, repo: REPO });
    assert(r === "already", "merged PR -> already", r);
    assert(!f.calls.some((c) => c.method === "PUT"), "already merged: no merge call");
  });

  await test("merge guards before any request", async () => {
    for (const [name, url, deps] of [
      ["PR on another repo", "https://github.com/someone/else/pull/1", { token: TOKEN, repo: REPO }],
      ["not a PR URL", `https://github.com/${REPO}/issues/1`, { token: TOKEN, repo: REPO }],
      ["token missing", PR_URL, { token: "", repo: REPO }],
      ["repo missing", PR_URL, { token: TOKEN, repo: "" }],
    ] as const) {
      const f = fakeFetch(ghRoutes());
      const r = await mergePrWithReason(url, HEAD_SHA, { ...deps, fetch: f.fn });
      assert(r.result === "refused", `${name} -> refused`, r);
      assert(f.calls.length === 0, `${name}: no request made`, f.calls.length);
    }
  });

  await test("token never in errors", async () => {
    const f = fakeFetch(ghRoutes({ [`GET /repos/${REPO}`]: { status: 500, body: { message: "boom" } } }));
    const logged: string[] = [];
    const origError = console.error;
    const origLog = console.log;
    const origWarn = console.warn;
    console.error = (...a: unknown[]) => logged.push(a.map(String).join(" "));
    console.log = (...a: unknown[]) => logged.push(a.map(String).join(" "));
    console.warn = (...a: unknown[]) => logged.push(a.map(String).join(" "));
    let message = "";
    try {
      await mergePr(PR_URL, HEAD_SHA, { fetch: f.fn, token: TOKEN, repo: REPO });
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    } finally {
      console.error = origError;
      console.log = origLog;
      console.warn = origWarn;
    }
    assert(message.length > 0, "GitHub 500 throws", message);
    assert(!message.includes(TOKEN) && !logged.join("\n").includes(TOKEN), "token not in the error or logs");
  });

  await test("closePr", async () => {
    const f = fakeFetch(ghRoutes());
    await closePr(PR_URL, { fetch: f.fn, token: TOKEN, repo: REPO });
    const patch = f.calls.find((c) => c.method === "PATCH");
    assert(!!patch && (patch.body as Record<string, unknown>).state === "closed", "closePr PATCHes state closed");

    const closed = fakeFetch(ghRoutes({ [`GET /repos/${REPO}/pulls/42`]: { status: 200, body: prBody({ state: "closed" }) } }));
    await closePr(PR_URL, { fetch: closed.fn, token: TOKEN, repo: REPO });
    assert(!closed.calls.some((c) => c.method === "PATCH"), "already-closed PR: no PATCH");

    for (const [name, url, routes] of [
      ["wrong branch", PR_URL, ghRoutes({ [`GET /repos/${REPO}/pulls/42`]: { status: 200, body: prBody({ head: { ref: "feature", sha: "x", repo: { full_name: REPO } } }) } })],
      ["other repo", "https://github.com/someone/else/pull/1", ghRoutes()],
    ] as const) {
      const g = fakeFetch(routes);
      let threw = false;
      try {
        await closePr(url, { fetch: g.fn, token: TOKEN, repo: REPO });
      } catch {
        threw = true;
      }
      assert(threw && !g.calls.some((c) => c.method === "PATCH"), `closePr refuses ${name} and does not PATCH`);
    }
  });

  await test("dispatchWorkflow", async () => {
    const f = fakeFetch(ghRoutes());
    await dispatchWorkflow("draft-regenerate", { id: ID, repo: REPO, note: "make it blue" }, { fetch: f.fn, token: TOKEN, repo: REPO });
    const post = f.calls[0];
    assert(post?.method === "POST" && post.url === `https://api.github.com/repos/${REPO}/dispatches`, "POSTs repository_dispatch on the portfolio repo", post);
    assert(
      JSON.stringify(post?.body) ===
        JSON.stringify({ event_type: "draft-regenerate", client_payload: { id: ID, repo: REPO, note: "make it blue" } }),
      "event_type and client_payload",
      post?.body
    );
    let threw = false;
    try {
      await dispatchWorkflow("deploy-prod" as "draft-rejected", { id: ID }, { fetch: f.fn, token: TOKEN, repo: REPO });
    } catch {
      threw = true;
    }
    assert(threw && f.calls.length === 1, "unknown event type refused without a request");
  });
}

// ---------------------------------------------------------------- cron

async function cronTests() {
  console.log("\n--- Cron: re-ping at 6 days, expire at 7 ---");

  await test("re-ping once", async () => {
    const t = await seeded();
    t.setNow(NOW + 3 * DAY);
    let r = await runDraftExpiryPass(t.deps);
    assert(r.repinged === 0 && r.expired === 0 && t.sent.length === 0, "day 3: nothing", r);

    t.setNow(NOW + 6 * DAY + 3600_000);
    r = await runDraftExpiryPass(t.deps);
    assert(r.repinged === 1 && t.sent.length === 1, "day 6: one re-ping", r);
    assert(t.sent[0]?.chatId === OWNER, "re-ping goes to Evan");
    assert(flatButtons(t.sent[0]?.markup).some((b) => b.callback_data === `pd:a:${ID}`), "re-ping carries the buttons");
    assert((await t.store.get(ID))?.repingedAt === new Date(NOW + 6 * DAY + 3600_000).toISOString(), "repingedAt recorded");

    t.setNow(NOW + 6 * DAY + 7200_000);
    r = await runDraftExpiryPass(t.deps);
    assert(r.repinged === 0 && t.sent.length === 1, "second pass on day 6: no second re-ping", r);
  });

  await test("re-ping failure is retried", async () => {
    const t = await seeded();
    let fail = true;
    t.deps.send = async (chatId, text, markup) => {
      if (fail) throw new Error("telegram down");
      t.sent.push({ chatId, text, markup });
    };
    t.setNow(NOW + 6 * DAY + 3600_000);
    await runDraftExpiryPass(t.deps);
    assert((await t.store.get(ID))?.repingedAt === null, "failed re-ping is not recorded as sent");
    fail = false;
    const r = await runDraftExpiryPass(t.deps);
    assert(r.repinged === 1 && t.sent.length === 1, "next pass re-pings");
  });

  await test("expire at 7 days", async () => {
    const t = await seeded({ repingedAt: new Date(NOW + 6 * DAY).toISOString() });
    t.setNow(NOW + 7 * DAY + 60_000);
    let r = await runDraftExpiryPass(t.deps);
    assert(r.expired === 1, "day 7: draft expired", r);
    assert((await t.store.get(ID))?.status === "expired", "status expired");
    assert(lastText(t.sent).includes("pr is still open") || lastText(t.sent).includes("pr still open"), "Evan told the PR stays open", lastText(t.sent));
    assert(t.merges.length === 0 && t.closes.length === 0, "expiry neither merges nor closes");
    r = await runDraftExpiryPass(t.deps);
    assert(r.expired === 0 && t.sent.length === 1, "second pass: nothing more");

    const never = await seeded();
    never.setNow(NOW + 8 * DAY);
    r = await runDraftExpiryPass(never.deps);
    assert(r.expired === 1 && r.repinged === 0, "cron missed day 6: expires without a late re-ping", r);
  });

  await test("regenerating draft: re-ping at 6 days, expire at 7", async () => {
    const t = await seeded({ status: "regenerating", regen: 1 });
    t.setNow(NOW + 3 * DAY);
    let r = await runDraftExpiryPass(t.deps);
    assert(r.repinged === 0 && r.expired === 0 && t.sent.length === 0, "regenerating day 3: nothing", r);

    t.setNow(NOW + 6 * DAY + 3600_000);
    r = await runDraftExpiryPass(t.deps);
    assert(r.repinged === 1 && t.sent.length === 1, "regenerating day 6: one re-ping", r);
    const ping = t.sent[0];
    assert(/regenerat/.test(ping?.text.toLowerCase() ?? ""), "re-ping says the regeneration has not arrived", ping?.text);
    const buttons = flatButtons(ping?.markup);
    assert(buttons.some((b) => b.callback_data === `pd:r:${ID}`), "re-ping offers Reject", buttons);
    assert(!buttons.some((b) => b.callback_data === `pd:a:${ID}`), "re-ping offers no Approve for a regenerating draft", buttons);
    r = await runDraftExpiryPass(t.deps);
    assert(r.repinged === 0 && t.sent.length === 1, "regenerating: no second re-ping", r);

    t.setNow(NOW + 7 * DAY + 60_000);
    r = await runDraftExpiryPass(t.deps);
    assert(r.expired === 1 && (await t.store.get(ID))?.status === "expired", "regenerating day 7: expired", r);
    const notice = lastText(t.sent);
    assert(notice.includes("pr is still open") && /regenerat/.test(notice), "expiry notice: regeneration never arrived, PR still open", notice);
    assert(t.merges.length === 0 && t.closes.length === 0, "regenerating expiry neither merges nor closes");
  });

  await test("resolved drafts are left alone", async () => {
    for (const status of ["approved", "rejected", "expired"] as const) {
      const t = await seeded({ status });
      t.setNow(NOW + 6 * DAY + 3600_000);
      let r = await runDraftExpiryPass(t.deps);
      t.setNow(NOW + 8 * DAY);
      r = await runDraftExpiryPass(t.deps);
      assert(r.repinged === 0 && r.expired === 0 && t.sent.length === 0, `${status}: no re-ping or expiry`);
    }
  });
}

async function runTests() {
  console.log("\n=======================================================");
  console.log("  Unit Tests: Portfolio Draft Approval");
  console.log("=======================================================");

  await intakeTests();
  await storeTests();
  await callbackTests();
  await githubTests();
  await cronTests();

  console.log("\n=======================================================");
  console.log(`  Passed: ${totalPassed} | Failed: ${totalFailed}`);
  console.log("=======================================================\n");

  if (totalFailed > 0) process.exit(1);
}

runTests();
