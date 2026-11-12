// Web push fan-out to the owner's subscribed devices. Pure: all I/O comes in through PushDeps
// so it can be tested offline. The default wiring (web-push, Sheets) is in push-default.ts.

export interface StoredSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface PushDeps {
  list(): Promise<StoredSubscription[]>;
  remove(endpoint: string): Promise<void>;
  send(sub: StoredSubscription, payload: string): Promise<void>;
}

const MAX_TITLE = 100;
const MAX_BODY = 300;

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Only same-origin /ego paths are allowed as a click target. */
export function safeEgoUrl(url: unknown): string {
  if (typeof url !== "string" || url.length > 500) return "/ego";
  if (!/^\/ego([/?#]|$)/.test(url) || url.includes("//") || url.includes("\\")) return "/ego";
  return url;
}

/**
 * Sends one notification to every stored subscription. Expired subscriptions (404/410) are
 * removed; every other failure is swallowed. Never throws, so callers can run it after a
 * Telegram send without risk.
 */
export async function pushOwner(
  deps: PushDeps,
  title: string,
  body: string,
  url: string = "/ego"
): Promise<void> {
  try {
    const subs = await deps.list();
    if (subs.length === 0) return;
    const payload = JSON.stringify({
      title: clip(title, MAX_TITLE),
      body: clip(body, MAX_BODY),
      url: safeEgoUrl(url),
    });
    await Promise.all(
      subs.map(async (sub) => {
        try {
          await deps.send(sub, payload);
        } catch (err) {
          const status = (err as { statusCode?: number } | null)?.statusCode;
          if (status === 404 || status === 410) {
            try {
              await deps.remove(sub.endpoint);
            } catch {
              // Best effort.
            }
          }
        }
      })
    );
  } catch {
    // Push is best effort and must never break the caller.
  }
}
