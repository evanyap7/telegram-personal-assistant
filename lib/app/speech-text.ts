/** Turns a chat reply into plain text that is fit to be read aloud. */

export const SPEECH_MAX_CHARS = 400;
export const ON_SCREEN_LINE = "The details are on screen.";

const EMOJI = /[\p{Extended_Pictographic}\p{Regional_Indicator}\u{FE0E}\u{FE0F}\u{200D}\u{20E3}\u{1F3FB}-\u{1F3FF}]/gu;

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
  if (text.split("\n").some((line) => /^\s*\|/.test(line) || (line.match(/\|/g) ?? []).length >= 2)) {
    return ON_SCREEN_LINE;
  }
  const plain = stripMarkdown(text).replace(EMOJI, "").replace(/\s+/g, " ").trim();
  return cutAtSentence(plain);
}
