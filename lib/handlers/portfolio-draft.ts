/**
 * Portfolio draft approval: the portfolio repo's updater Action POSTs a signed "draft ready"
 * request; EGO stores it for 7 days and asks Evan in Telegram (Approve / Reject / Edit /
 * Open preview). Approve squash-merges the PR, Reject closes it and tells the updater to skip
 * the repo, Edit takes a note and asks the updater to regenerate (at most 3 times).
 *
 * Approve uses an in-flight status rather than marking the draft approved first:
 *   pending --claim--> merging (lockedAt = nonce, read back to confirm we hold it)
 *   merging --merged/already--> approved
 *   merging --refused/error--> pending (so a draft is never left "approved" when nothing merged),
 *   unless GitHub shows the PR merged after all (a simultaneous tap won): then approved
 * Expiry is checked before anything else, so a draft past its 7 days never merges.
 * A second tap while merging replies "in progress"; a lock older than MERGE_LOCK_MS is from a
 * crashed attempt and can be re-claimed. GitHub is the last guard against a double merge.
 *
 * Every string from the payload or a note is untrusted: messages are sent as plain text (no
 * parse mode, like guest mode) with control and format characters stripped.
 */

import crypto from "node:crypto";
import {
  DRAFT_TTL_MS,
  MAX_REGENERATIONS,
  MERGE_LOCK_MS,
  REPING_AFTER_MS,
  createSheetsDraftStore,
  resolveDraft,
  type Draft,
  type DraftStore,
} from "../portfolio-drafts";
import {
  closePr,
  dispatchWorkflow,
  isPrMerged,
  mergePrWithReason,
  type DispatchEvent,
  type MergeOutcome,
  type RefusalReason,
} from "../github-portfolio";
import {
  answerTelegramCallback,
  removeTelegramInlineKeyboard,
  sendTelegramPlainMessage,
  type RichReplyMarkup,
} from "../telegram";

export type DraftMarkup = RichReplyMarkup;

export type DraftDeps = {
  store: DraftStore;
  ownerId: number;
  /** "owner/name" from PORTFOLIO_REPO. */
  portfolioRepo: string;
  now: () => number;
  send: (chatId: number, text: string, markup?: DraftMarkup) => Promise<void>;
  answerCallback: (callbackId: string, text?: string) => Promise<void>;
  clearKeyboard: (chatId: number, messageId: number) => Promise<void>;
  /** Merges only when the PR head is still `expectedSha`. */
  mergePr: (prUrl: string, expectedSha: string) => Promise<MergeOutcome>;
  closePr: (prUrl: string) => Promise<void>;
  /** Whether the PR is merged on GitHub; checked before a failed merge puts the draft back to pending. */
  isPrMerged: (prUrl: string) => Promise<boolean>;
  dispatchWorkflow: (event: DispatchEvent, payload: Record<string, string>) => Promise<void>;
  /** EGO_WEBHOOK_SECRET. Only the intake needs it. */
  secret?: string;
};

const MAX_BODY_BYTES = 16 * 1024;
const MAX_ID_LENGTH = 59; // "pd:a:" + id must fit Telegram's 64-byte callback_data
const MAX_CLAIMS = 20;
const MAX_CLAIM_LENGTH = 300;
const MAX_URL_LENGTH = 500;
const MAX_NOTE_LENGTH = 500;

const ID = /^[a-z0-9-]+-\d+$/;
const REPO = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;
const PR_URL = /^https:\/\/github\.com\/([A-Za-z0-9._-]+\/[A-Za-z0-9._-]+)\/pull\/[1-9]\d{0,9}$/;
const COLOUR = /^#[0-9a-fA-F]{6}$/;
const MODEL = /^[A-Za-z0-9._:/-]{1,100}$/;
const SOURCE_REPO = /^[A-Za-z0-9._-]{1,100}$/;
const SHA = /^[0-9a-f]{40}$/;
const SIGNATURE = /^sha256=([0-9a-f]{64})$/;
const CALLBACK = /^pd:([are]):([a-z0-9-]+-\d+)$/;
const NOTE_PROMPT = /\nNote for draft: ([a-z0-9-]+-\d+)$/;

const PAYLOAD_KEYS = [
  "id",
  "repo",
  "kind",
  "prUrl",
  "previewUrl",
  "screenshotUrl",
  "colours",
  "model",
  "claims",
  "regen",
  "sourceRepo",
  "headSha",
] as const;

function log(event: string, values: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ event, timestamp: new Date().toISOString(), ...values }));
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : "unknown error";
}

/** Strips control, format (bidi, zero-width) and line/paragraph separators; folds whitespace. */
export function cleanText(s: string): string {
  return s
    .replace(/[\t\n\r\u2028\u2029]+/g, " ")
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, "")
    .replace(/ {2,}/g, " ")
    .trim();
}

function sameRepo(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function isHttpsUrl(v: unknown): v is string {
  if (typeof v !== "string" || v.length > MAX_URL_LENGTH || !/^[\x21-\x7e]+$/.test(v)) return false;
  try {
    const u = new URL(v);
    return u.protocol === "https:" && !!u.hostname && !u.username && !u.password;
  } catch {
    return false;
  }
}

/**
 * The "Open preview" button only ever points at a Vercel deployment: https, a `<name>.vercel.app`
 * host, default port. No production domain is configured, so none is allowed beyond that.
 */
function isPreviewUrl(v: unknown): v is string {
  if (!isHttpsUrl(v)) return false;
  const u = new URL(v);
  return !u.port && /^[a-z0-9-]+(\.[a-z0-9-]+)*\.vercel\.app$/.test(u.hostname);
}

function validId(v: unknown): v is string {
  return typeof v === "string" && v.length <= MAX_ID_LENGTH && ID.test(v);
}

type Fields = Pick<
  Draft,
  | "id"
  | "repo"
  | "kind"
  | "prUrl"
  | "previewUrl"
  | "screenshotUrl"
  | "colours"
  | "model"
  | "claims"
  | "regen"
  | "sourceRepo"
  | "headSha"
>;

/** Strict: every field checked, nothing extra allowed. Null means 400. */
export function validatePayload(x: unknown, portfolioRepo: string): Fields | null {
  if (!x || typeof x !== "object" || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  const keys = Object.keys(o);
  if (keys.length !== PAYLOAD_KEYS.length || !PAYLOAD_KEYS.every((k) => keys.includes(k))) return null;

  const { id, repo, kind, prUrl, previewUrl, screenshotUrl, colours, model, claims, regen, sourceRepo, headSha } = o;
  if (!validId(id)) return null;
  if (typeof repo !== "string" || !REPO.test(repo) || !sameRepo(repo, portfolioRepo)) return null;
  // The project's repo name only (no owner); "." and ".." are not repo names.
  if (typeof sourceRepo !== "string" || !SOURCE_REPO.test(sourceRepo) || /^\.+$/.test(sourceRepo)) return null;
  if (kind !== "new" && kind !== "changed") return null;
  if (typeof headSha !== "string" || !SHA.test(headSha)) return null;
  if (typeof prUrl !== "string") return null;
  const pr = PR_URL.exec(prUrl);
  if (!pr || !sameRepo(pr[1], repo)) return null;
  if (previewUrl !== null && !isPreviewUrl(previewUrl)) return null;
  if (screenshotUrl !== null && !isHttpsUrl(screenshotUrl)) return null;
  if (
    !Array.isArray(colours) ||
    colours.length !== 2 ||
    !colours.every((c) => typeof c === "string" && COLOUR.test(c))
  ) {
    return null;
  }
  if (typeof model !== "string" || !MODEL.test(model)) return null;
  if (typeof regen !== "number" || !Number.isInteger(regen) || regen < 0 || regen > MAX_REGENERATIONS) return null;
  if (
    !Array.isArray(claims) ||
    claims.length > MAX_CLAIMS ||
    !claims.every((c) => typeof c === "string" && c.length <= MAX_CLAIM_LENGTH)
  ) {
    return null;
  }

  return {
    id,
    repo,
    kind,
    prUrl,
    previewUrl: previewUrl as string | null,
    screenshotUrl: screenshotUrl as string | null,
    colours: [colours[0] as string, colours[1] as string],
    model,
    claims: (claims as string[]).map(cleanText).filter((c) => c.length > 0),
    regen,
    sourceRepo,
    headSha,
  };
}

function validSignature(raw: Buffer, header: string | null, secret: string): boolean {
  const m = SIGNATURE.exec(header ?? "");
  if (!m) return false;
  const expected = crypto.createHmac("sha256", secret).update(raw).digest();
  const given = Buffer.from(m[1], "hex");
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

function json(body: Record<string, unknown>, status = 200): Response {
  return Response.json(body, { status });
}

// ---------------------------------------------------------------- message copy

function draftKeyboard(d: Draft): DraftMarkup {
  const second: Array<{ text: string; callback_data: string } | { text: string; url: string }> = [
    { text: "Edit", callback_data: `pd:e:${d.id}` },
  ];
  if (d.previewUrl) second.push({ text: "Open preview", url: d.previewUrl });
  return {
    inline_keyboard: [
      [
        { text: "Approve", callback_data: `pd:a:${d.id}` },
        { text: "Reject", callback_data: `pd:r:${d.id}` },
      ],
      second,
    ],
  };
}

function draftText(d: Draft): string {
  const lines = [
    d.kind === "new" ? "New project draft ready for review" : "Project update draft ready for review",
    "",
    `ID: ${d.id}`,
    `Source repo: ${d.sourceRepo}`,
    `PR: ${d.prUrl}`,
    `Preview: ${d.previewUrl ?? "none yet"}`,
    `Screenshot: ${d.screenshotUrl ?? "none"}`,
    `Colours: ${d.colours[0]} / ${d.colours[1]}`,
    `Model: ${d.model}`,
    `Regenerations: ${d.regen} of ${MAX_REGENERATIONS}`,
    "",
  ];
  if (d.claims.length) {
    lines.push("Unverified claims (from README, check each before approving):");
    for (const c of d.claims) lines.push(`- ${cleanText(c)}`);
  } else {
    lines.push("Unverified claims: none listed.");
  }
  lines.push("", `Expires ${d.expiresAt.slice(0, 10)} (7 days). Nothing goes live until you tap Approve.`);
  return lines.join("\n");
}

const REASON_TEXT: Record<RefusalReason, string> = {
  "not-configured": "GitHub access is not configured on EGO (GITHUB_PORTFOLIO_TOKEN / PORTFOLIO_REPO).",
  "wrong-repo": "the PR isn't on the configured portfolio repo.",
  "repo-private": "the portfolio repo is private now, so I won't merge into it.",
  "pr-closed": "the PR is closed (or gone) on GitHub.",
  "pr-draft": "the PR is marked as a draft on GitHub.",
  "wrong-branch": "the PR isn't from an auto/project- branch into the default branch.",
  "not-mergeable": "GitHub says the PR can't be merged right now (conflicts or failing checks).",
  "head-changed": "the draft changed since this message was sent; see the new message (if none arrives, tap Edit to regenerate).",
};

function regeneratingKeyboard(d: Draft): DraftMarkup {
  const row: Array<{ text: string; callback_data: string } | { text: string; url: string }> = [
    { text: "Reject", callback_data: `pd:r:${d.id}` },
  ];
  if (d.previewUrl) row.push({ text: "Open preview", url: d.previewUrl });
  return { inline_keyboard: [row] };
}

const COPY = {
  notFound: "I can't find that draft. Nothing changed.",
  expired: "Draft expired, PR still open. Nothing merged; close or merge it on GitHub yourself if you still want to.",
  inProgress: "A merge for this draft is already in progress. Give it a moment.",
  already: (d: Draft) =>
    d.status === "regenerating"
      ? "Already done: this draft was replaced by a regeneration."
      : `Already done: this draft was ${d.status}.`,
  regenLimit: `Regeneration limit reached (${MAX_REGENERATIONS} of ${MAX_REGENERATIONS}). Approve or reject this draft as it is.`,
};

// ---------------------------------------------------------------- intake

/** POST /api/portfolio-draft. Order: config, size, signature, JSON, validation, then storage. */
export async function handleDraftIntake(request: Request, deps: DraftDeps): Promise<Response> {
  if (!deps.secret || !deps.ownerId || !deps.portfolioRepo) {
    log("portfolio_draft.not_configured");
    return json({ ok: false, error: "not configured" }, 500);
  }

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return json({ ok: false, error: "too large" }, 413);
  const raw = Buffer.from(await request.arrayBuffer());
  if (raw.length > MAX_BODY_BYTES) return json({ ok: false, error: "too large" }, 413);

  if (!validSignature(raw, request.headers.get("x-signature"), deps.secret)) {
    log("portfolio_draft.unauthorized");
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString("utf8"));
  } catch {
    return json({ ok: false, error: "invalid JSON" }, 400);
  }
  const fields = validatePayload(parsed, deps.portfolioRepo);
  if (!fields) {
    log("portfolio_draft.invalid_payload");
    return json({ ok: false, error: "invalid payload" }, 400);
  }

  const now = deps.now();
  const existing = await deps.store.get(fields.id);
  let draft: Draft;
  const supersedes = existing?.status === "regenerating" && fields.regen > existing.regen;
  if (existing && !supersedes) {
    // An Action retry. Announce it only if the first attempt never reached Telegram.
    if (existing.notifiedAt || existing.status !== "pending") {
      return json({ ok: true, id: fields.id, duplicate: true });
    }
    draft = existing;
  } else {
    draft = {
      ...fields,
      status: "pending",
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + DRAFT_TTL_MS).toISOString(),
      repingedAt: null,
      notifiedAt: null,
      awaitingNote: false,
      lockedAt: null,
    };
    await deps.store.save(draft);
  }

  try {
    await deps.send(deps.ownerId, draftText(draft), draftKeyboard(draft));
  } catch (err) {
    log("portfolio_draft.notify_failed", { id: draft.id, error: errorText(err) });
    return json({ ok: false, error: "telegram send failed" }, 502);
  }
  await deps.store.update(draft.id, ["pending"], { notifiedAt: new Date(now).toISOString() });
  log("portfolio_draft.received", { id: draft.id, kind: draft.kind, regen: draft.regen });
  return json({ ok: true, id: draft.id });
}

// ---------------------------------------------------------------- buttons

function pastExpiry(d: Draft, now: number): boolean {
  const t = Date.parse(d.expiresAt);
  return !Number.isFinite(t) || now >= t; // unreadable expiry fails closed
}

function lockStale(d: Draft, now: number): boolean {
  const t = Date.parse((d.lockedAt ?? "").split("#")[0]);
  return !Number.isFinite(t) || now - t > MERGE_LOCK_MS;
}

async function quietly(p: Promise<unknown>, event: string): Promise<void> {
  try {
    await p;
  } catch (err) {
    log(event, { error: errorText(err) });
  }
}

type Callback = { data: string; userId: number; callbackId: string; chatId: number; messageId: number };

/** Marks an open draft expired (no merge, PR left open). A merging draft only once its lock is stale. */
async function expireDraft(id: string, deps: DraftDeps, now: number): Promise<Draft | null> {
  return deps.store.update(
    id,
    ["pending", "merging", "regenerating"],
    { status: "expired", lockedAt: null, awaitingNote: false },
    (x) => x.status !== "merging" || lockStale(x, now)
  );
}

/**
 * A draft that cannot be acted on: replies and returns true. `open` lists the statuses this
 * action accepts ("merging" means a merging draft whose lock is stale). Expiry is checked for
 * every open status before anything else: a draft past its 7 days is marked expired, never acted on.
 */
async function refuseUnlessOpen(
  d: Draft | null,
  deps: DraftDeps,
  reply: (t: string) => Promise<void>,
  open: Draft["status"][] = ["pending"]
): Promise<boolean> {
  const now = deps.now();
  if (!d) return reply(COPY.notFound).then(() => true);
  if (d.status === "expired") return reply(COPY.expired).then(() => true);
  if (d.status === "merging" && !(open.includes("merging") && lockStale(d, now))) {
    return reply(COPY.inProgress).then(() => true);
  }
  if (!open.includes(d.status)) return reply(COPY.already(d)).then(() => true);
  if (pastExpiry(d, now)) {
    await expireDraft(d.id, deps, now);
    await reply(COPY.expired);
    return true;
  }
  return false;
}

async function approve(id: string, cb: Callback, deps: DraftDeps, reply: (t: string) => Promise<void>) {
  const d = await deps.store.get(id);
  const now = deps.now();
  // A merging draft whose lock is stale belongs to a crashed attempt: this tap may retry it.
  if (await refuseUnlessOpen(d, deps, reply, ["pending", "merging"])) return;
  const draft = d as Draft;
  // Merge only the commit this message described. No recorded sha (an old row): refuse, nothing changes.
  if (!SHA.test(draft.headSha)) {
    return reply(
      "Not merged: this draft has no recorded commit, so I can't tell what Approve would merge. " +
        "Nothing merged; tap Edit to regenerate it, or merge the PR on GitHub yourself."
    );
  }

  const nonce = `${new Date(now).toISOString()}#${crypto.randomBytes(6).toString("hex")}`;
  await deps.store.update(
    id,
    ["pending", "merging"],
    { status: "merging", lockedAt: nonce, awaitingNote: false },
    (x) => !pastExpiry(x, now) && (x.status === "pending" || lockStale(x, now))
  );
  // Read back: on the non-atomic Sheets store a concurrent tap may have overwritten our claim.
  if ((await deps.store.get(id))?.lockedAt !== nonce) return reply(COPY.inProgress);

  // Back to pending, only from our own merging claim: never moves a draft out of approved.
  const release = () =>
    deps.store.update(id, ["merging"], { status: "pending", lockedAt: null }, (x) => x.lockedAt === nonce);

  const finish = async (result: "merged" | "already") => {
    if (!(await resolveDraft(id, "approved", deps.store))) {
      const current = await deps.store.get(id);
      if (current?.status === "approved") {
        if (result === "already") return reply(COPY.already(current));
      } else {
        // The PR is merged on GitHub, so approved is the truth whatever the row says now.
        await deps.store.update(id, ["pending", "merging", "rejected", "expired", "regenerating"], {
          status: "approved",
          lockedAt: null,
          awaitingNote: false,
        });
      }
    }
    await quietly(deps.clearKeyboard(cb.chatId, cb.messageId), "portfolio_draft.clear_keyboard_failed");
    log("portfolio_draft.approved", { id, result });
    return reply(
      result === "merged"
        ? `Approved and merged. Vercel deploys main in a minute or two.\n${draft.prUrl}`
        : `Already merged on GitHub, so the draft is marked approved.\n${draft.prUrl}`
    );
  };

  // Before saying "not merged": another tap may have merged it a moment ago.
  const mergedAnyway = async () => {
    try {
      return await deps.isPrMerged(draft.prUrl);
    } catch (err) {
      log("portfolio_draft.merged_check_failed", { id, error: errorText(err) });
      return false;
    }
  };

  let outcome: MergeOutcome;
  try {
    outcome = await deps.mergePr(draft.prUrl, draft.headSha);
  } catch (err) {
    log("portfolio_draft.merge_failed", { id, error: errorText(err) });
    if (await mergedAnyway()) return finish("already");
    await release();
    return reply("I couldn't reach GitHub to merge, so nothing merged. The draft is still open: tap Approve to try again.");
  }

  if (outcome.result === "refused") {
    if (await mergedAnyway()) return finish("already");
    await release();
    const why = REASON_TEXT[outcome.reason ?? "not-mergeable"];
    return reply(`Not merged: ${why} Nothing merged; the draft is still open.`);
  }

  return finish(outcome.result);
}

async function reject(id: string, cb: Callback, deps: DraftDeps, reply: (t: string) => Promise<void>) {
  const d = await deps.store.get(id);
  // A regenerating draft can be rejected too, so a regeneration that never arrives is not a dead end.
  if (await refuseUnlessOpen(d, deps, reply, ["pending", "regenerating"])) return;
  const draft = d as Draft;
  const before = draft.status;
  // resolveDraft is the guard: a second tap finds the draft already rejected.
  if (!(await resolveDraft(id, "rejected", deps.store))) {
    return reply(COPY.already((await deps.store.get(id)) ?? draft));
  }
  try {
    await deps.closePr(draft.prUrl);
    await deps.dispatchWorkflow("draft-rejected", { id: draft.id, repo: draft.sourceRepo });
  } catch (err) {
    log("portfolio_draft.reject_failed", { id, error: errorText(err) });
    await deps.store.update(id, ["rejected"], { status: before });
    return reply("I couldn't close the PR or tell the updater, so the draft is still open. Tap Reject to try again.");
  }
  await quietly(deps.clearKeyboard(cb.chatId, cb.messageId), "portfolio_draft.clear_keyboard_failed");
  log("portfolio_draft.rejected", { id });
  return reply("Rejected. The PR is closed, and the updater will skip this repo until it changes again.");
}

async function edit(id: string, deps: DraftDeps, reply: (t: string) => Promise<void>) {
  const d = await deps.store.get(id);
  if (await refuseUnlessOpen(d, deps, reply)) return;
  const draft = d as Draft;
  if (draft.regen >= MAX_REGENERATIONS) return reply(COPY.regenLimit);
  await deps.store.update(id, ["pending"], { awaitingNote: true });
  await deps.send(
    deps.ownerId,
    `What should change? Reply to this message with a short note (up to ${MAX_NOTE_LENGTH} characters), ` +
      `for example "make it blue" or "use mark-50".\n\nNote for draft: ${id}`,
    { force_reply: true, input_field_placeholder: "make it blue" }
  );
}

/** Owner-only. Anyone else gets no answer, no message and no state change. */
export async function handlePortfolioDraftCallback(cb: Callback, deps: DraftDeps): Promise<void> {
  if (!deps.ownerId || cb.userId !== deps.ownerId) return;
  await quietly(deps.answerCallback(cb.callbackId), "portfolio_draft.answer_failed");
  const m = CALLBACK.exec(cb.data);
  if (!m || m[2].length > MAX_ID_LENGTH) return;
  const [, action, id] = m;
  const reply = (text: string) => deps.send(deps.ownerId, text);
  if (action === "a") return approve(id, cb, deps, reply);
  if (action === "r") return reject(id, cb, deps, reply);
  return edit(id, deps, reply);
}

/** The draft id from the Edit prompt a message replies to, or null. */
export function parseNotePromptId(replyText: string | undefined): string | null {
  const m = NOTE_PROMPT.exec(replyText ?? "");
  return m && m[1].length <= MAX_ID_LENGTH ? m[1] : null;
}

/** Evan's reply to an Edit prompt: dispatch draft-regenerate with the (untrusted) note. */
export async function handleDraftNote(
  input: { draftId: string; text: string; userId: number; chatId: number },
  deps: DraftDeps
): Promise<void> {
  if (!deps.ownerId || input.userId !== deps.ownerId) return;
  const reply = (text: string) => deps.send(deps.ownerId, text);
  const d = await deps.store.get(input.draftId);
  if (await refuseUnlessOpen(d, deps, reply)) return;
  const draft = d as Draft;
  if (!draft.awaitingNote) return reply("Tap Edit on the draft first, then reply to the prompt with your note.");
  if (draft.regen >= MAX_REGENERATIONS) return reply(COPY.regenLimit);

  const note = cleanText(input.text);
  if (!note) return reply("That note is empty. Reply to the prompt again with what should change.");
  if (note.length > MAX_NOTE_LENGTH) {
    return reply(`That note is too long (max ${MAX_NOTE_LENGTH} characters). Reply to the prompt again with a shorter one.`);
  }

  const claimed = await deps.store.update(
    draft.id,
    ["pending"],
    { status: "regenerating", awaitingNote: false },
    (x) => x.awaitingNote
  );
  if (!claimed) return reply(COPY.already((await deps.store.get(draft.id)) ?? draft));
  try {
    await deps.dispatchWorkflow("draft-regenerate", { id: draft.id, repo: draft.sourceRepo, note });
  } catch (err) {
    log("portfolio_draft.regenerate_failed", { id: draft.id, error: errorText(err) });
    await deps.store.update(draft.id, ["regenerating"], { status: "pending", awaitingNote: true });
    return reply("I couldn't reach GitHub to start the regeneration. Reply to the prompt again to retry.");
  }
  log("portfolio_draft.regenerating", { id: draft.id, regen: draft.regen + 1 });
  return reply(
    `Regenerating with your note (${draft.regen + 1} of ${MAX_REGENERATIONS}). ` +
      "The new draft will arrive here once it passes the checks."
  );
}

// ---------------------------------------------------------------- cron

/**
 * Daily: re-ping once at 6 days, expire at 7 (status expired, PR left open). A regenerating
 * draft whose new version never arrived gets the same treatment, with its own wording.
 */
export async function runDraftExpiryPass(deps: DraftDeps): Promise<{ repinged: number; expired: number }> {
  const now = deps.now();
  let repinged = 0;
  let expired = 0;
  for (const d of await deps.store.list()) {
    try {
      const open =
        d.status === "pending" || d.status === "regenerating" || (d.status === "merging" && lockStale(d, now));
      if (!open) continue;
      const regenerating = d.status === "regenerating";

      if (pastExpiry(d, now)) {
        if (!(await expireDraft(d.id, deps, now))) continue;
        expired++;
        await quietly(
          deps.send(
            deps.ownerId,
            regenerating
              ? `Draft ${d.id} expired after 7 days: the regenerated draft never arrived. Nothing merged; the PR is still open:\n${d.prUrl}`
              : `Draft ${d.id} expired after 7 days without a decision. Nothing merged; the PR is still open:\n${d.prUrl}`
          ),
          "portfolio_draft.expiry_notice_failed"
        );
        continue;
      }

      const created = Date.parse(d.createdAt);
      if (d.status === "merging" || d.repingedAt || !Number.isFinite(created) || now - created < REPING_AFTER_MS) {
        continue;
      }
      // Claim first so two overlapping runs cannot both re-ping; undo if the send fails.
      const stamp = new Date(now).toISOString();
      const claimed = await deps.store.update(d.id, [d.status], { repingedAt: stamp }, (x) => !x.repingedAt);
      if (!claimed) continue;
      try {
        if (regenerating) {
          await deps.send(
            deps.ownerId,
            `Reminder: the regenerated draft for ${d.id} hasn't arrived after 6 days. Nothing merged; the PR is still open. ` +
              `The draft expires in about a day. Tap Reject to close the PR now, or do nothing and it stays open.\n${d.prUrl}`,
            regeneratingKeyboard(claimed)
          );
        } else {
          await deps.send(
            deps.ownerId,
            `Reminder: this draft expires in about a day. If you do nothing, the PR stays open.\n\n${draftText(claimed)}`,
            draftKeyboard(claimed)
          );
        }
        repinged++;
      } catch (err) {
        log("portfolio_draft.reping_failed", { id: d.id, error: errorText(err) });
        await deps.store.update(d.id, [d.status], { repingedAt: null }, (x) => x.repingedAt === stamp);
      }
    } catch (err) {
      log("portfolio_draft.expiry_pass_failed", { id: d.id, error: errorText(err) });
    }
  }
  return { repinged, expired };
}

// ---------------------------------------------------------------- production wiring

/** Reads env; throws if TELEGRAM_ALLOWED_USER_ID or PORTFOLIO_REPO is missing. */
export function createDefaultDraftDeps(): DraftDeps {
  const ownerId = Number(process.env.TELEGRAM_ALLOWED_USER_ID);
  if (!ownerId) throw new Error("TELEGRAM_ALLOWED_USER_ID is missing.");
  const portfolioRepo = process.env.PORTFOLIO_REPO ?? "";
  if (!REPO.test(portfolioRepo)) throw new Error("PORTFOLIO_REPO is missing or not owner/name.");
  return {
    store: createSheetsDraftStore(),
    ownerId,
    portfolioRepo,
    now: Date.now,
    send: (chatId, text, markup) => sendTelegramPlainMessage(chatId, text, markup),
    answerCallback: answerTelegramCallback,
    clearKeyboard: removeTelegramInlineKeyboard,
    mergePr: (prUrl, expectedSha) => mergePrWithReason(prUrl, expectedSha),
    closePr: (prUrl) => closePr(prUrl),
    isPrMerged: (prUrl) => isPrMerged(prUrl),
    dispatchWorkflow: (event, payload) => dispatchWorkflow(event, payload),
    secret: process.env.EGO_WEBHOOK_SECRET,
  };
}
