/**
 * Unit tests for the app's pure logic: the avatar state machine and the safe inline
 * Markdown parser. No I/O.
 *
 * Usage:
 *   node --experimental-strip-types --import ./scripts/bench/register.mjs scripts/test-app-pure.ts
 */

import {
  initialAvatarState,
  mouthForLevel,
  reduceAvatar,
  type AvatarEvent,
  type AvatarState,
} from "../lib/app/avatar-state";
import { parseInlineMarkdown } from "../lib/app/markdown";

let passed = 0;
let failed = 0;
function assert(condition: boolean, name: string, detail?: unknown) {
  if (condition) {
    console.log(`  ✅ PASS: ${name}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${name}`, detail === undefined ? "" : JSON.stringify(detail));
    failed++;
  }
}

function run(events: AvatarEvent[], from: AvatarState = initialAvatarState): AvatarState {
  return events.reduce(reduceAvatar, from);
}
const s = (over: Partial<AvatarState>): AvatarState => ({ ...initialAvatarState, ...over });

console.log("\n--- Avatar state machine ---");
assert(
  initialAvatarState.activity === "idle" &&
    initialAvatarState.mood === "neutral" &&
    !initialAvatarState.blinking &&
    initialAvatarState.mouth === "closed",
  "initial state is idle/neutral/not blinking/closed",
);
assert(run([{ type: "listen_start" }]).activity === "listening", "listen_start -> listening");
assert(
  run([{ type: "listen_start" }, { type: "listen_end" }]).activity === "idle",
  "listen_end -> idle",
);
{
  const t = run([{ type: "request_sent" }]);
  assert(t.activity === "thinking" && t.mood === "focused", "request_sent -> thinking + focused", t);
}
assert(run([{ type: "request_sent" }, { type: "turn_done" }]).mood === "warm", "turn_done -> warm");
assert(
  run([{ type: "request_sent" }, { type: "turn_done", status: "ok" }]).mood === "warm",
  "turn_done with other status -> warm",
);
for (const st of ["x_failed", "x_not_found", "x_empty"]) {
  assert(
    run([{ type: "request_sent" }, { type: "turn_done", status: st }]).mood === "concerned",
    `turn_done status ${st} -> concerned`,
  );
}
{
  const e = run([{ type: "request_sent" }, { type: "turn_error" }]);
  assert(e.mood === "concerned" && e.activity === "idle", "turn_error -> concerned + idle", e);
}
{
  const sp = run([{ type: "turn_done" }, { type: "speech_start" }]);
  assert(sp.activity === "speaking" && sp.mood === "warm", "speech_start -> speaking, mood kept", sp);
  const e = reduceAvatar(reduceAvatar(sp, { type: "level", value: 0.3 }), { type: "speech_end" });
  assert(e.activity === "idle" && e.mouth === "closed" && e.mood === "warm", "speech_end -> idle, mouth closed", e);
}
{
  const sp = run([{ type: "speech_start" }]);
  assert(reduceAvatar(sp, { type: "level", value: 0.3 }).mouth === "open", "level while speaking sets mouth");
  assert(reduceAvatar(sp, { type: "level", value: 1 }).mouth === "wide", "level 1 while speaking -> wide");
  const idle = s({ mouth: "open" });
  assert(reduceAvatar(idle, { type: "level", value: 0.9 }).mouth === "closed", "level outside speaking -> closed");
}
{
  const sp = run([{ type: "turn_done" }, { type: "speech_start" }, { type: "level", value: 0.5 }]);
  const l = reduceAvatar(sp, { type: "listen_start" });
  assert(l.activity === "listening" && l.mouth === "closed" && l.mood === "warm", "listen_start while speaking interrupts", l);
  const i = reduceAvatar(sp, { type: "speech_interrupted" });
  assert(i.activity === "idle" && i.mouth === "closed", "speech_interrupted -> idle, mouth closed", i);
}
{
  const td = run([{ type: "request_sent" }, { type: "turn_done" }]);
  assert(td.activity === "idle" && td.mood === "warm", "turn_done while thinking -> idle", td);
  assert(reduceAvatar(td, { type: "speech_start" }).activity === "speaking", "speech_start works from idle after turn_done");
  const spk = run([{ type: "speech_start" }]);
  assert(reduceAvatar(spk, { type: "turn_done" }).activity === "speaking", "turn_done while speaking keeps speaking");
  const lis = run([{ type: "listen_start" }]);
  assert(reduceAvatar(lis, { type: "turn_done" }).activity === "listening", "turn_done while listening keeps listening");
  const sp2 = reduceAvatar(spk, { type: "level", value: 0.3 });
  assert(reduceAvatar(sp2, { type: "level", value: 0.3 }) === sp2, "level while speaking with unchanged mouth returns same reference");
}
assert(run([{ type: "blink", on: true }]).blinking === true, "blink on");
{
  const b = run([{ type: "request_sent" }, { type: "blink", on: true }]);
  const off = reduceAvatar(b, { type: "blink", on: false });
  assert(!off.blinking && off.activity === "thinking" && off.mood === "focused", "blink only toggles blinking", off);
}
assert(run([{ type: "turn_done" }, { type: "mood_decay" }]).mood === "neutral", "mood_decay warm -> neutral");
assert(
  run([{ type: "turn_done", status: "a_failed" }, { type: "mood_decay" }]).mood === "neutral",
  "mood_decay concerned -> neutral",
);
{
  const f = s({ mood: "focused", activity: "thinking" });
  assert(reduceAvatar(f, { type: "mood_decay" }).mood === "focused", "mood_decay leaves focused alone");
}
{
  const sameCases: [string, AvatarState, AvatarEvent][] = [
    ["mood_decay on neutral", initialAvatarState, { type: "mood_decay" }],
    ["speech_end while idle", initialAvatarState, { type: "speech_end" }],
    ["level while idle and closed", initialAvatarState, { type: "level", value: 0.9 }],
    ["blink to same value", initialAvatarState, { type: "blink", on: false }],
    ["listen_end while idle", initialAvatarState, { type: "listen_end" }],
  ];
  for (const [name, st, ev] of sameCases) {
    assert(reduceAvatar(st, ev) === st, `no-op returns same reference: ${name}`);
  }
  const warm = s({ mood: "warm", activity: "thinking" });
  let threw = false;
  let out: AvatarState = warm;
  try {
    out = reduceAvatar(warm, { type: "speech_end" });
  } catch {
    threw = true;
  }
  assert(!threw && out.mood === "warm", "irrelevant event does not throw and keeps mood");
}

console.log("\n--- mouthForLevel ---");
assert(mouthForLevel(0) === "closed", "0 -> closed");
assert(mouthForLevel(0.049) === "closed", "0.049 -> closed");
assert(mouthForLevel(0.05) === "small", "0.05 -> small");
assert(mouthForLevel(0.2) === "open", "0.2 -> open");
assert(mouthForLevel(0.45) === "wide", "0.45 -> wide");
assert(mouthForLevel(1) === "wide", "1 -> wide");
assert(mouthForLevel(NaN) === "closed", "NaN -> closed");
assert(mouthForLevel(-3) === "closed", "negative -> closed");
assert(mouthForLevel(7) === "wide", ">1 -> wide");

console.log("\n--- parseInlineMarkdown ---");
const join = (t: string) => parseInlineMarkdown(t).map((x) => x.text).join("");
{
  const segs = parseInlineMarkdown("*a* _b_ `c`");
  const kinds = segs.filter((x) => x.kind !== "text").map((x) => `${x.kind}:${x.text}`);
  assert(kinds.join("|") === "bold:a|italic:b|code:c", "bold, italic and code segments", segs);
  assert(segs[1].kind === "text" && segs[1].text === " ", "separating spaces preserved", segs);
}
{
  const input = "<script>alert(1)</script>";
  const segs = parseInlineMarkdown(input);
  assert(segs.length === 1 && segs[0].kind === "text" && segs[0].text === input, "script tag stays one text segment", segs);
}
{
  const segs = parseInlineMarkdown("*<b>x</b>*");
  assert(segs.length === 1 && segs[0].kind === "bold" && segs[0].text === "<b>x</b>", "markup inside bold is literal text", segs);
}
assert(JSON.stringify(parseInlineMarkdown("")) === "[]", "empty string -> []");
{
  let threw = false;
  let a: ReturnType<typeof parseInlineMarkdown> = [];
  let b: ReturnType<typeof parseInlineMarkdown> = [];
  let c: ReturnType<typeof parseInlineMarkdown> = [];
  try {
    a = parseInlineMarkdown("*x");
    b = parseInlineMarkdown("_");
    c = parseInlineMarkdown("`x");
  } catch {
    threw = true;
  }
  assert(!threw, "unbalanced markers do not throw");
  assert(a.length === 1 && a[0].kind === "text" && a[0].text === "*x", "unbalanced *x is plain text", a);
  assert(b.length === 1 && b[0].kind === "text" && b[0].text === "_", "lone _ is plain text", b);
  assert(c.length === 1 && c[0].kind === "text" && c[0].text === "`x", "unbalanced backtick is plain text", c);
}
{
  const segs = parseInlineMarkdown("use `*a* _b_` ok");
  const code = segs.find((x) => x.kind === "code");
  assert(code?.text === "*a* _b_" && segs.length === 3 && segs.every((x) => x.kind === "text" || x.kind === "code"), "markers inside code are literal", segs);
}
{
  const segs = parseInlineMarkdown("snake_case_word here");
  assert(segs.length === 1 && segs[0].kind === "text" && segs[0].text === "snake_case_word here", "intraword underscores stay plain", segs);
}
{
  const segs = parseInlineMarkdown("a ** b");
  assert(segs.length === 1 && segs[0].kind === "text", "empty bold pair stays plain", segs);
}
{
  const segs = parseInlineMarkdown("x *y* *z");
  assert(
    segs.map((x) => `${x.kind}:${x.text}`).join("|") === "text:x |bold:y|text: *z",
    "adjacent plain text merges into one segment",
    segs,
  );
}
for (const input of ["plain text, no markers.", "50% off * today", "a_b c_d", "multi\nline  text ", "  spaced  "]) {
  assert(join(input) === input, `plain input round-trips: ${JSON.stringify(input)}`, parseInlineMarkdown(input));
}

console.log("\n--- markdown whitespace/newline/doubling rules ---");
for (const input of ["2 * 3 * 4", "* a\n* b", "a\n*b\nc*", "_ a _", "a\n_b\nc_", "__x__", "***", "** x **", "a * b*"]) {
  const segs = parseInlineMarkdown(input);
  assert(segs.length === 1 && segs[0].kind === "text" && segs[0].text === input, `stays plain: ${JSON.stringify(input)}`, segs);
}
{
  const segs = parseInlineMarkdown("*_a_*");
  assert(segs.length === 1 && segs[0].kind === "bold" && segs[0].text === "_a_", "*_a_* is bold with literal inner underscores", segs);
  const m = parseInlineMarkdown("*a*\n*b*");
  assert(m.map((x) => `${x.kind}:${x.text}`).join("|") === "bold:a|text:\n|bold:b", "bold on separate lines still works", m);
}

console.log("\n--- markdown performance guard ---");
{
  const patterns = [
    " _a_a".repeat(40000),
    "*".repeat(200000),
    "_".repeat(200000),
    "`".repeat(200000),
    "*_".repeat(100000),
    "*a ".repeat(70000),
    "_a ".repeat(70000),
    "`a ".repeat(70000),
    "*_`a ".repeat(40000),
  ];
  for (const p of patterns) {
    const t0 = Date.now();
    const segs = parseInlineMarkdown(p);
    const ms = Date.now() - t0;
    assert(ms < 1000, `parses ${p.length} chars of ${JSON.stringify(p.slice(0, 8))} in under 1s (${ms}ms)`);
    // Only inputs with no valid pairs are plain; the mixed ones legitimately form spans.
    if (/^(\*+|_+|`+)$/.test(p) || p.startsWith("*a ") || p.startsWith("_a ")) {
      assert(segs.map((x) => x.text).join("") === p, `plain pathological input round-trips: ${JSON.stringify(p.slice(0, 8))}`);
    }
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
