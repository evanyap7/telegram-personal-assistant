/**
 * Safe inline Markdown for Telegram-style text: *bold*, _italic_, `code`.
 * Returns segments only (never HTML), so rendering needs no dangerouslySetInnerHTML.
 * No nesting; unbalanced markers are plain text; text characters are never altered.
 *
 * Bold/italic rules: the character right after the opener and right before the closer must
 * be non-whitespace, the span stays on one line, and doubled markers (`**`, `__`) are plain.
 * `_` also never opens or closes inside a word (snake_case_word stays plain).
 * Parsing is linear: a failed closer search is remembered for the rest of the line, because
 * closer validity depends only on the closer's own position.
 */

export type Segment = { kind: "text" | "bold" | "italic" | "code"; text: string };

const isWordChar = (ch: string | undefined) => ch !== undefined && /[\p{L}\p{N}]/u.test(ch);
const isSpace = (ch: string | undefined) => ch === undefined || /\s/u.test(ch);

function validCloser(text: string, j: number, marker: string): boolean {
  if (isSpace(text[j - 1]) || text[j - 1] === marker) return false;
  if (text[j + 1] === marker) return false;
  if (marker === "_" && isWordChar(text[j + 1])) return false;
  return true;
}

export function parseInlineMarkdown(text: string): Segment[] {
  const out: Segment[] = [];
  let plain = "";
  const flush = () => {
    if (plain) out.push({ kind: "text", text: plain });
    plain = "";
  };

  // For each marker: openers before this index are known to have no valid closer.
  const noCloserBefore: Record<string, number> = { "*": 0, _: 0 };
  let noMoreBacktick = false;

  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "`" && !noMoreBacktick) {
      const close = text.indexOf("`", i + 1);
      if (close === -1) noMoreBacktick = true;
      else if (close > i + 1) {
        flush();
        out.push({ kind: "code", text: text.slice(i + 1, close) });
        i = close + 1;
        continue;
      }
    } else if (ch === "*" || ch === "_") {
      const canOpen =
        i >= noCloserBefore[ch] &&
        !isSpace(text[i + 1]) &&
        text[i + 1] !== ch &&
        text[i - 1] !== ch &&
        (ch !== "_" || !isWordChar(text[i - 1]));
      if (canOpen) {
        let lineEnd = text.indexOf("\n", i);
        if (lineEnd === -1) lineEnd = text.length;
        let close = -1;
        for (let j = i + 2; j < lineEnd; j++) {
          if (text[j] === ch && validCloser(text, j, ch)) {
            close = j;
            break;
          }
        }
        if (close !== -1) {
          flush();
          out.push({ kind: ch === "*" ? "bold" : "italic", text: text.slice(i + 1, close) });
          i = close + 1;
          continue;
        }
        noCloserBefore[ch] = lineEnd;
      }
    }
    plain += ch;
    i++;
  }
  flush();
  return out;
}
