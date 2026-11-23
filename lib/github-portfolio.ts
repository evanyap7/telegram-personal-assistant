/**
 * GitHub calls for portfolio draft approval: merge or close the updater's PR, and send
 * repository_dispatch events back to the portfolio repo's Action.
 *
 * Every call is limited to PORTFOLIO_REPO and uses GITHUB_PORTFOLIO_TOKEN (a fine-grained token,
 * portfolio repo only: contents + pull requests read/write). The token is only ever placed in the
 * Authorization header; errors carry the HTTP status and path, never the token or response body.
 */

export type MergeResult = "merged" | "already" | "refused";
export type RefusalReason =
  | "not-configured"
  | "wrong-repo"
  | "repo-private"
  | "pr-closed"
  | "pr-draft"
  | "wrong-branch"
  | "not-mergeable";
export type MergeOutcome = { result: MergeResult; reason?: RefusalReason };

export type DispatchEvent = "draft-rejected" | "draft-regenerate";

export type GithubDeps = {
  fetch?: typeof fetch;
  /** Defaults to process.env.GITHUB_PORTFOLIO_TOKEN. */
  token?: string;
  /** "owner/name"; defaults to process.env.PORTFOLIO_REPO. */
  repo?: string;
};

const API = "https://api.github.com";
const TIMEOUT_MS = 10_000;
const HEAD_PREFIX = "auto/project-";
const DISPATCH_EVENTS: readonly DispatchEvent[] = ["draft-rejected", "draft-regenerate"];
const PR_URL = /^https:\/\/github\.com\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)\/pull\/([1-9]\d{0,9})$/;

type Config = { fetch: typeof fetch; token: string; repo: string };

function config(deps: GithubDeps): Config | null {
  const token = deps.token ?? process.env.GITHUB_PORTFOLIO_TOKEN ?? "";
  const repo = deps.repo ?? process.env.PORTFOLIO_REPO ?? "";
  if (!token || !repo) return null;
  return { fetch: deps.fetch ?? fetch, token, repo };
}

function sameRepo(a: string | undefined | null, b: string): boolean {
  return typeof a === "string" && a.toLowerCase() === b.toLowerCase();
}

/** PR number when prUrl is a pull request on the configured repo, else null. */
function prNumber(prUrl: string, repo: string): number | null {
  const m = PR_URL.exec(prUrl);
  if (!m || !sameRepo(`${m[1]}/${m[2]}`, repo)) return null;
  return Number(m[3]);
}

async function gh(
  cfg: Config,
  method: "GET" | "PUT" | "PATCH" | "POST",
  path: string,
  body?: unknown
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await cfg.fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "ego-portfolio-approval",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  let json: Record<string, unknown> = {};
  try {
    const parsed: unknown = await res.json();
    if (parsed && typeof parsed === "object") json = parsed as Record<string, unknown>;
  } catch {
    // Empty body (204) or not JSON.
  }
  return { status: res.status, json };
}

function fail(method: string, path: string, status: number): Error {
  return new Error(`GitHub ${method} ${path} failed: ${status}`);
}

type PrInfo = {
  state?: string;
  merged?: boolean;
  draft?: boolean;
  head?: { ref?: string; sha?: string; repo?: { full_name?: string } | null };
  base?: { ref?: string; repo?: { full_name?: string } | null };
};

type Inspected =
  | { ok: true; cfg: Config; number: number; pr: PrInfo }
  | { ok: false; reason: RefusalReason };

/** The guards shared by merge and close. PR state (open/closed/merged) is left to the caller. */
async function inspect(prUrl: string, deps: GithubDeps): Promise<Inspected> {
  const cfg = config(deps);
  if (!cfg) return { ok: false, reason: "not-configured" };
  const number = prNumber(prUrl, cfg.repo);
  if (number === null) return { ok: false, reason: "wrong-repo" };

  const repoPath = `/repos/${cfg.repo}`;
  const repoRes = await gh(cfg, "GET", repoPath);
  if (repoRes.status !== 200) throw fail("GET", repoPath, repoRes.status);
  if (repoRes.json.private !== false) return { ok: false, reason: "repo-private" };
  if (!sameRepo(repoRes.json.full_name as string, cfg.repo)) return { ok: false, reason: "wrong-repo" };
  const defaultBranch = repoRes.json.default_branch;

  const prPath = `${repoPath}/pulls/${number}`;
  const prRes = await gh(cfg, "GET", prPath);
  if (prRes.status === 404) return { ok: false, reason: "pr-closed" };
  if (prRes.status !== 200) throw fail("GET", prPath, prRes.status);
  const pr = prRes.json as PrInfo;

  if (!sameRepo(pr.head?.repo?.full_name, cfg.repo) || !sameRepo(pr.base?.repo?.full_name, cfg.repo)) {
    return { ok: false, reason: "wrong-repo" };
  }
  if (typeof pr.head?.ref !== "string" || !pr.head.ref.startsWith(HEAD_PREFIX)) {
    return { ok: false, reason: "wrong-branch" };
  }
  if (typeof defaultBranch !== "string" || pr.base?.ref !== defaultBranch) {
    return { ok: false, reason: "wrong-branch" };
  }
  return { ok: true, cfg, number, pr };
}

/** Squash-merges the updater's PR, with the reason when it refuses. */
export async function mergePrWithReason(prUrl: string, deps: GithubDeps = {}): Promise<MergeOutcome> {
  const found = await inspect(prUrl, deps);
  if (!found.ok) return { result: "refused", reason: found.reason };
  const { cfg, number, pr } = found;

  if (pr.merged === true) return { result: "already" };
  if (pr.state !== "open") return { result: "refused", reason: "pr-closed" };
  if (pr.draft === true) return { result: "refused", reason: "pr-draft" };
  if (typeof pr.head?.sha !== "string" || !pr.head.sha) return { result: "refused", reason: "not-mergeable" };

  const mergePath = `/repos/${cfg.repo}/pulls/${number}/merge`;
  // Pinned to the head we inspected: if the branch moved since, GitHub answers 409 instead of merging.
  const res = await gh(cfg, "PUT", mergePath, { merge_method: "squash", sha: pr.head.sha });
  if (res.status === 200) return { result: "merged" };
  if (res.status === 405 || res.status === 409 || res.status === 422) {
    // A simultaneous tap may have merged it a moment ago: look again before calling it unmergeable.
    try {
      const again = await gh(cfg, "GET", `/repos/${cfg.repo}/pulls/${number}`);
      if (again.status === 200 && again.json.merged === true) return { result: "already" };
    } catch {
      // Could not re-read; report what the merge call said.
    }
    return { result: "refused", reason: "not-mergeable" };
  }
  throw fail("PUT", mergePath, res.status);
}

/** True when the updater's PR on the configured repo is merged. Not configured or another repo: false. */
export async function isPrMerged(prUrl: string, deps: GithubDeps = {}): Promise<boolean> {
  const cfg = config(deps);
  if (!cfg) return false;
  const number = prNumber(prUrl, cfg.repo);
  if (number === null) return false;
  const path = `/repos/${cfg.repo}/pulls/${number}`;
  const res = await gh(cfg, "GET", path);
  if (res.status !== 200) throw fail("GET", path, res.status);
  return res.json.merged === true;
}

export async function mergePr(prUrl: string, deps: GithubDeps = {}): Promise<MergeResult> {
  return (await mergePrWithReason(prUrl, deps)).result;
}

/** Closes the updater's PR. Already closed is a no-op; a refused guard throws. */
export async function closePr(prUrl: string, deps: GithubDeps = {}): Promise<void> {
  const found = await inspect(prUrl, deps);
  if (!found.ok) throw new Error(`closePr refused: ${found.reason}`);
  const { cfg, number, pr } = found;
  if (pr.state !== "open") return;
  const path = `/repos/${cfg.repo}/pulls/${number}`;
  const res = await gh(cfg, "PATCH", path, { state: "closed" });
  if (res.status !== 200) throw fail("PATCH", path, res.status);
}

/** repository_dispatch on the portfolio repo: draft-rejected {id, repo}, draft-regenerate {id, repo, note}. */
export async function dispatchWorkflow(
  event: DispatchEvent,
  payload: object,
  deps: GithubDeps = {}
): Promise<void> {
  if (!DISPATCH_EVENTS.includes(event)) throw new Error("dispatchWorkflow: unknown event type");
  const cfg = config(deps);
  if (!cfg) throw new Error("dispatchWorkflow: GitHub access is not configured");
  const path = `/repos/${cfg.repo}/dispatches`;
  const res = await gh(cfg, "POST", path, { event_type: event, client_payload: payload });
  if (res.status !== 204 && res.status !== 200) throw fail("POST", path, res.status);
}
