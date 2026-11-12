import { pushOwner, type PushDeps, type StoredSubscription } from "./push";
import { listSubscriptions, removeSubscription } from "./push-store";

/** VAPID settings from env, or null when push is not configured. */
export function vapidConfig(): { publicKey: string; privateKey: string; subject: string } | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) return null;
  return { publicKey, privateKey, subject };
}

function defaultDeps(cfg: NonNullable<ReturnType<typeof vapidConfig>>): PushDeps {
  return {
    list: listSubscriptions,
    remove: removeSubscription,
    async send(sub: StoredSubscription, payload: string) {
      // Loaded on demand: web-push is CommonJS and only needed when a push is really sent.
      const mod = await import("web-push");
      const webpush = mod.default ?? mod;
      await webpush.sendNotification(sub, payload, {
        vapidDetails: { subject: cfg.subject, publicKey: cfg.publicKey, privateKey: cfg.privateKey },
        TTL: 60 * 60,
      });
    },
  };
}

/** Telegram text is Markdown-ish; the notification body is plain text. */
function plain(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`]/g, "")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/**
 * Push copy of a proactive Telegram message. A silent no-op when VAPID env is missing;
 * never throws. Inside a request it is handed to after(), so it neither delays the response
 * nor is cut off by it; elsewhere it is awaited.
 */
export async function pushOwnerDefault(title: string, body: string, url?: string): Promise<void> {
  try {
    const cfg = vapidConfig();
    if (!cfg) return;
    const run = () => pushOwner(defaultDeps(cfg), title, plain(body), url);
    try {
      const { after } = await import("next/server");
      after(run);
    } catch {
      // No request scope: run detached so it can never delay the caller (pushOwner never rejects).
      void run().catch(() => {});
    }
  } catch {
    // Never break the Telegram path.
  }
}
