/** Turns a chat reply into plain text that is fit to be read aloud. */

export const SPEECH_MAX_CHARS = 400;
export const ON_SCREEN_LINE = "The details are on screen.";

const EMOJI_MARKS = /[\p{Regional_Indicator}\u{FE0E}\u{FE0F}\u{200D}\u{20E3}\u{1F3FB}-\u{1F3FF}]/gu;
const PICTOGRAPH = /\p{Extended_Pictographic}/gu;
/** Extended_Pictographic includes these text symbols; they are read as words, not dropped. */
const KEEP_SYMBOLS = "\u00A9\u00AE\u2122";

function stripEmoji(text: string): string {
  return text.replace(PICTOGRAPH, (ch) => (KEEP_SYMBOLS.includes(ch) ? ch : "")).replace(EMOJI_MARKS, "");
}

const TABLE_SEPARATOR = /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)+\|?\s*$/;

/** A Markdown table: a header-separator row such as |---|---|, or three or more lines with a pipe. */
function hasTable(text: string): boolean {
  const lines = text.split("\n");
  return lines.some((l) => TABLE_SEPARATOR.test(l)) || lines.filter((l) => l.includes("|")).length >= 3;
}

function stripMarkdown(text: string): string {
  return text
    .replace(/```[^\n]*\n?([\s\S]*?)```/g, "$1")
    .replace(/`([^`\n]*)`/g, "$1")
    .replace(/!\[([^\]\n]*)\]\([^)\n]*\)/g, "$1")
    .replace(/\[([^\]\n]*)\]\([^)\n]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, "")
    .replace(/(\*{1,3})(?=\S)([^*\n]+?)(?<=\S)\1/g, "$2")
    .replace(/(^|[\s(])(_{1,3})(?=\S)([^_\n]+?)(?<=\S)\2(?=[\s).,;:!?]|$)/g, "$1$3")
    .replace(/~~([^~\n]+)~~/g, "$1");
}

function cutAtSentence(text: string): string {
  if (text.length <= SPEECH_MAX_CHARS) return text;
  let cut = -1;
  const boundary = /[.!?]+["')\]]*(?=\s|$)/g;
  for (let m = boundary.exec(text); m !== null; m = boundary.exec(text)) {
    const end = m.index + m[0].length;
    if (end > SPEECH_MAX_CHARS) break;
    cut = end;
  }
  if (cut <= 0) {
    const space = text.lastIndexOf(" ", SPEECH_MAX_CHARS);
    cut = space > 0 ? space : SPEECH_MAX_CHARS;
  }
  return text.slice(0, cut).trim();
}

/**
 * Strips Markdown and emoji, collapses whitespace and cuts at a sentence boundary at or
 * under SPEECH_MAX_CHARS. A reply with table rows is not read out: it becomes a pointer to
 * the screen. Returns "" when nothing speakable is left.
 */
export function cleanSpeechText(text: string): string {
  if (typeof text !== "string") return "";
  if (hasTable(text)) return ON_SCREEN_LINE;
  const plain = stripEmoji(stripMarkdown(text)).replace(/\s+/g, " ").trim();
  return cutAtSentence(plain);
}

export const FIRST_CHUNK_CHARS = 100;
export const CHUNK_CHARS = 220;

/**
 * Splits cleaned speech text into chunks of whole sentences so the first can be
 * synthesized, and start playing, while the rest are still being made. The first chunk is
 * short (about FIRST_CHUNK_CHARS) to cut the wait; later ones pack up to CHUNK_CHARS. A
 * single longer sentence stays whole.
 */
export function splitSpeechChunks(text: string): string[] {
  const sentences = text.split(/(?<=[.!?]["')\]]*)\s+/).filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    const limit = chunks.length === 0 ? FIRST_CHUNK_CHARS : CHUNK_CHARS;
    if (current && current.length + 1 + sentence.length > limit) {
      chunks.push(current);
      current = sentence;
    } else {
      current = current ? `${current} ${sentence}` : sentence;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}
