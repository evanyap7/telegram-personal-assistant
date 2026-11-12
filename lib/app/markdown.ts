/**
 * Safe inline Markdown for Telegram-style text: *bold*, _italic_, `code`.
 * Returns segments only (never HTML), so rendering needs no dangerouslySetInnerHTML.
 * No nesting; unbalanced markers are plain text; text characters are never altered.
 */

export type Segment = { kind: "text" | "bold" | "italic" | "code"; text: string };

const isWordChar = (ch: string | undefined) => ch !== undefined && /[\p{L}\p{N}]/u.test(ch);

/** Index of the closing marker for an opener at `open`, or -1 if there is none. */
function findClose(text: string, open: number, marker: string): number {
  let from = open + 1;
  while (from < text.length) {
    const idx = text.indexOf(marker, from);
    if (idx === -1) return -1;
    if (idx === open + 1) return -1; // empty pair
    if (marker !== "_" || !isWordChar(text[idx + 1])) return idx;
    from = idx + 1; // intraword underscore: keep looking
  }
  return -1;
}

export function parseInlineMarkdown(text: string): Segment[] {
  const out: Segment[] = [];
  let plain = "";
  const flush = () => {
    if (plain) out.push({ kind: "text", text: plain });
    plain = "";
  };

  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "*" || ch === "_" || ch === "`") {
      const canOpen = ch !== "_" || !isWordChar(text[i - 1]);
      const close = canOpen ? findClose(text, i, ch) : -1;
      if (close !== -1) {
        flush();
        const kind = ch === "*" ? "bold" : ch === "_" ? "italic" : "code";
        out.push({ kind, text: text.slice(i + 1, close) });
        i = close + 1;
        continue;
      }
    }
    plain += ch;
    i++;
  }
  flush();
  return out;
}
