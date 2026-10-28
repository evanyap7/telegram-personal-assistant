const DEFAULT_RETRIES = 4;
const DEFAULT_BASE_DELAY_MS = 500;
/** Small gap between inserts so a long schedule stays under Google's per-user rate limit. */
const DEFAULT_PACING_MS = 150;

type Sleep = (ms: number) => Promise<void>;

const defaultSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Google Calendar signals throttling with 403 "Rate Limit Exceeded" or 429. */
export function isRateLimitError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as {
    code?: number | string;
    status?: number;
    message?: string;
    errors?: Array<{ reason?: string }>;
  };

  if (err.code === 429 || err.status === 429) return true;
  if (err.errors?.some((e) => e.reason === "rateLimitExceeded" || e.reason === "userRateLimitExceeded")) {
    return true;
  }
  return Number(err.code) === 403 && /rate limit/i.test(err.message ?? "");
}

export async function retryOnRateLimit<T>(
  fn: () => Promise<T>,
  opts: { retries?: number; baseDelayMs?: number; sleep?: Sleep } = {}
): Promise<T> {
  const retries = opts.retries ?? DEFAULT_RETRIES;
  const baseDelayMs = opts.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const sleep = opts.sleep ?? defaultSleep;

  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= retries || !isRateLimitError(error)) throw error;
      await sleep(baseDelayMs * 2 ** attempt);
    }
  }
}

export interface SequentialCreateResult<TItem, TResult> {
  created: TResult[];
  /** The first item that failed after retries, if any. */
  failure?: { item: TItem; error: unknown };
  /** Items never attempted because an earlier one failed. */
  skipped: TItem[];
}

/**
 * Creates items one at a time, retrying rate limits. Stops at the first hard failure so callers
 * keep what was created (for undo) and can report what is left, instead of losing track of
 * inserts that already went through.
 */
export async function createEventsSequentially<TItem, TResult>(
  items: TItem[],
  create: (item: TItem) => Promise<TResult>,
  opts: { retries?: number; baseDelayMs?: number; pacingMs?: number; sleep?: Sleep } = {}
): Promise<SequentialCreateResult<TItem, TResult>> {
  const sleep = opts.sleep ?? defaultSleep;
  const pacingMs = opts.pacingMs ?? DEFAULT_PACING_MS;
  const created: TResult[] = [];

  for (let i = 0; i < items.length; i++) {
    try {
      created.push(await retryOnRateLimit(() => create(items[i]), opts));
    } catch (error) {
      return { created, failure: { item: items[i], error }, skipped: items.slice(i + 1) };
    }
    if (pacingMs > 0 && i < items.length - 1) await sleep(pacingMs);
  }

  return { created, skipped: [] };
}

/** Prefixes a tag (e.g. "HACK 2026") onto an event title, once. */
export function applyEventTag(title: string, tag: string | undefined): string {
  const cleanTag = tag?.trim();
  if (!cleanTag) return title;
  if (title.toLowerCase().startsWith(cleanTag.toLowerCase())) return title;
  return `${cleanTag} — ${title}`;
}
