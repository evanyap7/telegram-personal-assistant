/**
 * Robust Singapore Date & Time Parser
 * Handles iOS Shortcuts, Singapore DD/MM/YYYY formats, bank alerts, and Grab receipts.
 * Guarantees a valid Date object in Singapore Standard Time (+08:00).
 */
export function parseSingaporeDate(input?: string | Date | number | null): Date {
  if (!input) return new Date();

  if (input instanceof Date) {
    return Number.isNaN(input.getTime()) ? new Date() : input;
  }

  if (typeof input === "number") {
    // Unix timestamp (seconds vs milliseconds)
    const ms = input < 10000000000 ? input * 1000 : input;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? new Date() : d;
  }

  let text = String(input).trim();
  if (!text) return new Date();

  // 1. Handle ISO strings directly: "2026-09-12T14:30:00+08:00" or "2026-09-12"
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
    // If only date "YYYY-MM-DD", append Singapore noon to avoid timezone shift
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      const d = new Date(`${text}T12:00:00+08:00`);
      if (!Number.isNaN(d.getTime())) return d;
    }
    const d = new Date(text);
    if (!Number.isNaN(d.getTime())) return d;
  }

  // 2. Clean iOS Shortcuts format:
  // e.g. "12 Sep 2026 at 14:30", "12 Sep 2026 at 2:30 PM", "Sep 12, 2026 at 14:30"
  let cleaned = text
    .replace(/\s+at\s+/gi, " ")
    .replace(/,/g, " ")
    .replace(/\(SGT\)|\(GMT\+8\)|\(UTC\+8\)/gi, "+08:00")
    .replace(/\s+/g, " ")
    .trim();

  // 3. Singapore / UK Slash format: "DD/MM/YYYY" or "DD/MM/YYYY HH:mm" or "DD-MM-YYYY"
  const ddmmyyyyMatch = cleaned.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (ddmmyyyyMatch) {
    const day = ddmmyyyyMatch[1].padStart(2, "0");
    const month = ddmmyyyyMatch[2].padStart(2, "0");
    let year = ddmmyyyyMatch[3];
    if (year.length === 2) year = `20${year}`;
    const hh = ddmmyyyyMatch[4] ? ddmmyyyyMatch[4].padStart(2, "0") : "12";
    const mm = ddmmyyyyMatch[5] ? ddmmyyyyMatch[5].padStart(2, "0") : "00";
    const ss = ddmmyyyyMatch[6] ? ddmmyyyyMatch[6].padStart(2, "0") : "00";

    const isoStr = `${year}-${month}-${day}T${hh}:${mm}:${ss}+08:00`;
    const parsed = new Date(isoStr);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  // 4. Handle Grab format: "10 Sep 26 16:32 +0800" or "10 Sep 2026 16:32"
  const grabMatch = cleaned.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{2,4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s+([+-]\d{4}))?/);
  if (grabMatch) {
    const day = grabMatch[1];
    const month = grabMatch[2];
    let year = grabMatch[3];
    if (year.length === 2) year = `20${year}`;
    const hh = grabMatch[4];
    const mm = grabMatch[5];
    const tz = grabMatch[7] || "+08:00";

    const parsed = new Date(`${day} ${month} ${year} ${hh}:${mm} ${tz}`);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  // 5. Handle format missing year: e.g. "07 Sep 15:13" or "07 Sep"
  if (!/\b20\d{2}\b/.test(cleaned)) {
    const currentYear = new Date().getFullYear();
    const withYear = `${cleaned} ${currentYear} +08:00`;
    const parsed = new Date(withYear);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  // 6. Direct parsing fallback with cleaned string
  const direct = new Date(cleaned);
  if (!Number.isNaN(direct.getTime())) {
    return direct;
  }

  // 7. Safety fallback to current time
  return new Date();
}
