/**
 * Portfolio drafts waiting for Evan's Approve / Reject / Edit in Telegram.
 *
 * Separate from lib/pending-actions.ts (5-minute expiry): a draft lives 7 days in its own
 * `PortfolioDrafts` tab. The memory store is the tested reference; the Sheets store mirrors it
 * and, like lib/guest/store.ts, is read-compare-write (not atomic). GitHub is the final guard
 * against a double merge: the merge is pinned to the inspected head sha and an already-merged
 * PR returns "already".
 *
 * Statuses: pending -> merging (in-flight lock while the merge call runs) -> approved;
 * pending -> rejected | expired | regenerating. A failed or refused merge goes merging -> pending,
 * so a draft is never left marked approved when nothing merged.
 */

export const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const REPING_AFTER_MS = 6 * 24 * 60 * 60 * 1000;
/** A merging lock older than this belongs to a crashed attempt and may be re-claimed. */
export const MERGE_LOCK_MS = 2 * 60 * 1000;
export const MAX_REGENERATIONS = 3;

export type DraftStatus = "pending" | "merging" | "approved" | "rejected" | "expired" | "regenerating";
export type DraftKind = "new" | "changed";

export type Draft = {
  id: string;
  /** Repo named by the Action's payload (validated to equal PORTFOLIO_REPO). */
  repo: string;
  kind: DraftKind;
  prUrl: string;
  previewUrl: string | null;
  screenshotUrl: string | null;
  colours: [string, string];
  model: string;
  claims: string[];
  regen: number;
  status: DraftStatus;
  createdAt: string;
  expiresAt: string;
  repingedAt: string | null;
  notifiedAt: string | null;
  awaitingNote: boolean;
  lockedAt: string | null;
  /** The project's own repo name (no owner), sent back in repository_dispatch payloads. */
  sourceRepo: string;
};

export interface DraftStore {
  get(id: string): Promise<Draft | null>;
  /** Insert, or replace the row with the same id. */
  save(draft: Draft): Promise<void>;
  list(): Promise<Draft[]>;
  /**
   * Apply `patch` only if the draft's status is in `when` (and `guard`, if given, passes).
   * Returns the updated draft, or null when the draft is missing or the condition failed.
   */
  update(
    id: string,
    when: DraftStatus[],
    patch: Partial<Draft>,
    guard?: (d: Draft) => boolean
  ): Promise<Draft | null>;
}

const STATUSES: DraftStatus[] = ["pending", "merging", "approved", "rejected", "expired", "regenerating"];

/** Anything unrecognised becomes terminal and non-actionable. */
function normalizeStatus(v: string | undefined): DraftStatus {
  const s = (v ?? "").trim().toLowerCase() as DraftStatus;
  return STATUSES.includes(s) ? s : "expired";
}

function parseJson<T>(v: string | undefined, fallback: T, ok: (x: unknown) => boolean): T {
  try {
    const parsed: unknown = JSON.parse(v ?? "");
    return ok(parsed) ? (parsed as T) : fallback;
  } catch {
    return fallback;
  }
}

const COLUMNS = [
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
  "status",
  "createdAt",
  "expiresAt",
  "repingedAt",
  "notifiedAt",
  "awaitingNote",
  "lockedAt",
  "sourceRepo",
];

export function draftToRow(d: Draft): (string | number)[] {
  return [
    d.id,
    d.repo,
    d.kind,
    d.prUrl,
    d.previewUrl ?? "",
    d.screenshotUrl ?? "",
    JSON.stringify(d.colours),
    d.model,
    JSON.stringify(d.claims),
    d.regen,
    d.status,
    d.createdAt,
    d.expiresAt,
    d.repingedAt ?? "",
    d.notifiedAt ?? "",
    d.awaitingNote ? "1" : "",
    d.lockedAt ?? "",
    d.sourceRepo,
  ];
}

export function rowToDraft(row: string[]): Draft {
  const regen = Number(row[9]);
  return {
    id: row[0] ?? "",
    repo: row[1] ?? "",
    kind: row[2] === "changed" ? "changed" : "new",
    prUrl: row[3] ?? "",
    previewUrl: row[4] || null,
    screenshotUrl: row[5] || null,
    colours: parseJson<[string, string]>(
      row[6],
      ["#000000", "#000000"],
      (x) => Array.isArray(x) && x.length === 2 && x.every((c) => typeof c === "string")
    ),
    model: row[7] ?? "",
    claims: parseJson<string[]>(row[8], [], (x) => Array.isArray(x) && x.every((c) => typeof c === "string")),
    // An unreadable count reads as the limit, so a broken row cannot allow more regenerations.
    regen: Number.isInteger(regen) && regen >= 0 ? regen : MAX_REGENERATIONS,
    status: normalizeStatus(row[10]),
    createdAt: row[11] ?? "",
    expiresAt: row[12] ?? "",
    repingedAt: row[13] || null,
    notifiedAt: row[14] || null,
    awaitingNote: row[15] === "1",
    lockedAt: row[16] || null,
    sourceRepo: row[17] ?? "",
  };
}

function clone(d: Draft): Draft {
  return { ...d, colours: [d.colours[0], d.colours[1]], claims: [...d.claims] };
}

export function createMemoryDraftStore(): DraftStore {
  const rows = new Map<string, Draft>();
  return {
    async get(id) {
      const d = rows.get(id);
      return d ? clone(d) : null;
    },
    async save(draft) {
      rows.set(draft.id, clone(draft));
    },
    async list() {
      return [...rows.values()].map(clone);
    },
    async update(id, when, patch, guard) {
      const d = rows.get(id);
      if (!d || !when.includes(d.status) || (guard && !guard(clone(d)))) return null;
      const next = clone({ ...d, ...patch, id: d.id });
      rows.set(id, next);
      return clone(next);
    },
  };
}

// ---------------------------------------------------------------- Google Sheets

// Not unit-tested offline: it needs the Google Sheets API (no network in `npm run check`).
// The memory store above is the tested reference for these semantics.

const TAB = "PortfolioDrafts";
const LAST_COL = "R";
let tabEnsured = false;

async function sheets() {
  // Imported lazily so the offline tests never load the Google client.
  const { getSheetsClient, withExponentialBackoff } = await import("./google");
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) throw new Error("GOOGLE_SHEET_ID is missing.");
  return { client: getSheetsClient(), backoff: withExponentialBackoff, spreadsheetId };
}

async function ensureTab(): Promise<void> {
  if (tabEnsured) return;
  const { client, backoff, spreadsheetId } = await sheets();
  const meta = await backoff(() =>
    client.spreadsheets.get({ spreadsheetId, fields: "sheets.properties(title)" })
  );
  if (!meta.data.sheets?.some((s) => s.properties?.title === TAB)) {
    await backoff(() =>
      client.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests: [{ addSheet: { properties: { title: TAB } } }] },
      })
    );
    await backoff(() =>
      client.spreadsheets.values.update({
        spreadsheetId,
        range: `${TAB}!A1:${LAST_COL}1`,
        valueInputOption: "RAW",
        requestBody: { values: [COLUMNS] },
      })
    );
  }
  tabEnsured = true;
}

async function readRows(): Promise<string[][]> {
  await ensureTab();
  const { client, backoff, spreadsheetId } = await sheets();
  const res = await backoff(() =>
    client.spreadsheets.values.get({
      spreadsheetId,
      range: `${TAB}!A2:${LAST_COL}`,
      valueRenderOption: "UNFORMATTED_VALUE",
    })
  );
  return ((res.data.values ?? []) as unknown[][]).map((r) =>
    r.map((c) => (c === null || c === undefined ? "" : String(c)))
  );
}

/** RAW input: a value such as "=HYPERLINK(...)" is stored as text, never run as a formula. */
async function writeRow(rowNumber: number, d: Draft): Promise<void> {
  const { client, backoff, spreadsheetId } = await sheets();
  await backoff(() =>
    client.spreadsheets.values.update({
      spreadsheetId,
      range: `${TAB}!A${rowNumber}:${LAST_COL}${rowNumber}`,
      valueInputOption: "RAW",
      requestBody: { values: [draftToRow(d)] },
    })
  );
}

async function findRow(id: string): Promise<{ rowNumber: number; draft: Draft } | null> {
  const rows = await readRows();
  const i = rows.findIndex((r) => r[0] === id);
  return i === -1 ? null : { rowNumber: i + 2, draft: rowToDraft(rows[i]) };
}

export function createSheetsDraftStore(): DraftStore {
  return {
    async get(id) {
      return (await findRow(id))?.draft ?? null;
    },
    async save(draft) {
      const found = await findRow(draft.id);
      if (found) {
        await writeRow(found.rowNumber, draft);
        return;
      }
      const { client, backoff, spreadsheetId } = await sheets();
      await backoff(() =>
        client.spreadsheets.values.append({
          spreadsheetId,
          range: `${TAB}!A:${LAST_COL}`,
          valueInputOption: "RAW",
          requestBody: { values: [draftToRow(draft)] },
        })
      );
    },
    async list() {
      return (await readRows()).filter((r) => r[0]).map(rowToDraft);
    },
    async update(id, when, patch, guard) {
      const found = await findRow(id);
      if (!found || !when.includes(found.draft.status) || (guard && !guard(found.draft))) return null;
      const next = { ...found.draft, ...patch, id: found.draft.id };
      await writeRow(found.rowNumber, next);
      return next;
    },
  };
}

let defaultStore: DraftStore | null = null;
function pick(s?: DraftStore): DraftStore {
  if (s) return s;
  defaultStore ??= createSheetsDraftStore();
  return defaultStore;
}

// ---------------------------------------------------------------- the brief's interface

export async function saveDraft(d: Draft, s?: DraftStore): Promise<void> {
  await pick(s).save(d);
}

export async function getDraft(id: string, s?: DraftStore): Promise<Draft | null> {
  return pick(s).get(id);
}

const RESOLVE_FROM: Record<"approved" | "rejected" | "expired", DraftStatus[]> = {
  approved: ["pending", "merging"],
  // A regeneration that never arrives can still be rejected.
  rejected: ["pending", "regenerating"],
  expired: ["pending"],
};

/** False when the draft is missing or already resolved: the idempotency guard. */
export async function resolveDraft(
  id: string,
  status: "approved" | "rejected" | "expired",
  s?: DraftStore
): Promise<boolean> {
  const updated = await pick(s).update(id, RESOLVE_FROM[status], {
    status,
    lockedAt: null,
    awaitingNote: false,
  });
  return updated !== null;
}
