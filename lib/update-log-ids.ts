/**
 * Which UpdateLog ids exist only for short-term idempotency.
 *
 * Telegram update ids are at most 12 digits. App-originated ids are
 * 1e13 + a 40-bit value (see appUpdateId), so 14 digits and below 2.1e13.
 * The range is bounded on purpose: Gmail message ids are 16 hex characters and
 * can be all digits, and they must be kept forever.
 */
const APP_ID_MIN = 1e13;
const APP_ID_MAX = 1e13 + 2 ** 40;

export function isShortLivedUpdateId(id: string): boolean {
  if (/^\d{1,12}$/.test(id)) return true;
  if (!/^\d{14}$/.test(id)) return false;
  const n = Number(id);
  return n >= APP_ID_MIN && n < APP_ID_MAX;
}
