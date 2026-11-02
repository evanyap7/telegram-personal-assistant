/**
 * Property-based tests (fast-check) for the pure logic in lib/.
 *
 * Usage:
 *   npm run test:properties
 *   FC_RUNS=20000 npm run test:properties     # deep run
 */

import fc from "fast-check";
import { calculateBillSplit } from "../lib/split";
import { decryptSecret, encryptSecret, isEncryptedValue, isSecretBoxConfigured } from "../lib/secret-box";
import { isAuthorizedCronRequest, maskSensitiveFinancialData, safeCompare } from "../lib/security";
import { parseSingaporeDate } from "../lib/date-parser";

const NUM_RUNS = Number(process.env.FC_RUNS ?? 300);

let totalPassed = 0;
let totalFailed = 0;

function property<T extends unknown[]>(name: string, arb: { [K in keyof T]: fc.Arbitrary<T[K]> }, predicate: (...args: T) => boolean | void) {
  try {
    fc.assert(
      fc.property(...(arb as [fc.Arbitrary<unknown>]), predicate as (...a: unknown[]) => boolean | void),
      { numRuns: NUM_RUNS }
    );
    console.log(`  ✅ PASS: ${name}`);
    totalPassed++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${name}\n${err instanceof Error ? err.message : String(err)}`);
    totalFailed++;
  }
}

function withEnv<R>(key: string, value: string | undefined, fn: () => R): R {
  const original = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  try {
    return fn();
  } finally {
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
}

// isAuthorizedCronRequest logs on every unconfigured call; keep the output readable.
function quiet<R>(fn: () => R): R {
  const original = console.error;
  console.error = () => {};
  try {
    return fn();
  } finally {
    console.error = original;
  }
}

const cents = (n: number) => Math.round(n * 100);
const names = fc.array(fc.string({ minLength: 1, maxLength: 12 }), { minLength: 1, maxLength: 25 });
// Amounts arrive as dollars-and-cents, so generate whole cents and convert.
const money = fc.integer({ min: 1, max: 1_000_000_000 }).map((c) => c / 100);
const percent = fc.double({ min: 0, max: 100, noNaN: true });

function billSplit() {
  console.log("\nBill splitting");
  property("shares sum exactly to the total, to the cent", [money, names] as never, (total: number, people: string[]) => {
    const r = calculateBillSplit({ total, people });
    return r.shares.reduce((s, x) => s + cents(x.amount), 0) === cents(r.totalAmount);
  });
  property("one share per person", [money, names] as never, (total: number, people: string[]) => {
    return calculateBillSplit({ total, people }).shares.length === people.length;
  });
  property("shares differ by at most one cent", [money, names] as never, (total: number, people: string[]) => {
    const c = calculateBillSplit({ total, people }).shares.map((s) => cents(s.amount));
    return Math.max(...c) - Math.min(...c) <= 1;
  });
  property("remainder cents go to the earliest people", [money, names] as never, (total: number, people: string[]) => {
    const c = calculateBillSplit({ total, people }).shares.map((s) => cents(s.amount));
    return c.every((v, i) => i === 0 || c[i - 1] >= v);
  });
  property("no one is charged a negative amount", [money, names, percent, percent] as never, (sub: number, people: string[], tip: number, tax: number) => {
    return calculateBillSplit({ subtotal: sub, people, tipPercent: tip, taxPercent: tax }).shares.every((s) => s.amount >= 0);
  });
  property("with tax and tip the total is subtotal plus both, to the cent", [money, names, percent, percent] as never, (sub: number, people: string[], tip: number, tax: number) => {
    const r = calculateBillSplit({ subtotal: sub, people, tipPercent: tip, taxPercent: tax });
    return cents(r.totalAmount) === cents(r.subtotal) + cents(r.taxAmount) + cents(r.tipAmount);
  });
  property("with tax and tip the shares still sum to the total", [money, names, percent, percent] as never, (sub: number, people: string[], tip: number, tax: number) => {
    const r = calculateBillSplit({ subtotal: sub, people, tipPercent: tip, taxPercent: tax });
    return r.shares.reduce((s, x) => s + cents(x.amount), 0) === cents(r.totalAmount);
  });
  property("an explicit total wins over subtotal, tip and tax", [money, money, names, percent, percent] as never, (total: number, sub: number, people: string[], tip: number, tax: number) => {
    const r = calculateBillSplit({ total, subtotal: sub, people, tipPercent: tip, taxPercent: tax });
    return cents(r.totalAmount) === cents(total) && r.tipAmount === 0 && r.taxAmount === 0;
  });
  property("an empty party falls back to one person holding the whole bill", [money] as never, (total: number) => {
    const r = calculateBillSplit({ total, people: [] });
    return r.shares.length === 1 && cents(r.shares[0].amount) === cents(total);
  });
}

function secretBox() {
  console.log("\nSecret box");
  const key = fc.string({ minLength: 16, maxLength: 64 }).filter((s) => s.trim().length >= 16);
  property("decrypt(encrypt(x)) returns x for any unicode text", [key, fc.string({ unit: "binary" })] as never, (k: string, text: string) =>
    withEnv("MEMORY_ENCRYPTION_KEY", k, () => decryptSecret(encryptSecret(text)!) === text));
  property("ciphertext is tagged as encrypted and hides the plaintext", [key, fc.string({ minLength: 8, maxLength: 40 })] as never, (k: string, text: string) =>
    withEnv("MEMORY_ENCRYPTION_KEY", k, () => {
      const enc = encryptSecret(text)!;
      return isEncryptedValue(enc) && !enc.includes(text);
    }));
  property("encrypting twice gives different ciphertext (random IV)", [key, fc.string()] as never, (k: string, text: string) =>
    withEnv("MEMORY_ENCRYPTION_KEY", k, () => encryptSecret(text) !== encryptSecret(text)));
  property("a different key cannot decrypt", [key, key, fc.string()] as never, (k1: string, k2: string, text: string) => {
    fc.pre(k1.trim() !== k2.trim());
    const enc = withEnv("MEMORY_ENCRYPTION_KEY", k1, () => encryptSecret(text)!);
    return withEnv("MEMORY_ENCRYPTION_KEY", k2, () => decryptSecret(enc)) === null;
  });
  property("flipping any ciphertext character never yields wrong plaintext", [key, fc.string({ minLength: 1 }), fc.nat()] as never, (k: string, text: string, pos: number) =>
    withEnv("MEMORY_ENCRYPTION_KEY", k, () => {
      const enc = encryptSecret(text)!;
      const i = "enc:v1:".length + (pos % (enc.length - "enc:v1:".length));
      const tampered = enc.slice(0, i) + (enc[i] === "A" ? "B" : "A") + enc.slice(i + 1);
      const out = decryptSecret(tampered);
      return out === null || out === text;
    }));
  property("a missing or too-short key means unconfigured and encrypt returns null", [fc.string({ maxLength: 15 })] as never, (short: string) =>
    withEnv("MEMORY_ENCRYPTION_KEY", short, () => !isSecretBoxConfigured() && encryptSecret("x") === null));
  property("plain values pass through decrypt unchanged", [fc.string().filter((s) => !s.startsWith("enc:v1:"))] as never, (s: string) =>
    decryptSecret(s) === s);
}

function security() {
  console.log("\nSecurity helpers");
  property("safeCompare agrees with equality for non-empty strings", [fc.string({ minLength: 1 }), fc.string({ minLength: 1 })] as never, (a: string, b: string) =>
    safeCompare(a, b) === (a === b));
  property("safeCompare is symmetric", [fc.string(), fc.string()] as never, (a: string, b: string) =>
    safeCompare(a, b) === safeCompare(b, a));
  property("safeCompare rejects empty and missing values", [fc.string()] as never, (a: string) =>
    !safeCompare(a, "") && !safeCompare("", a) && !safeCompare(a, null) && !safeCompare(undefined, a));
  property("masking a card number keeps only the last four digits", [fc.stringMatching(/^[0-9]{16}$/), fc.constantFrom("", " ", "-")] as never, (digits: string, sep: string) => {
    const card = [0, 4, 8, 12].map((i) => digits.slice(i, i + 4)).join(sep);
    const out = maskSensitiveFinancialData(`card ${card} end`);
    return out === `card **** **** **** ${digits.slice(12)} end`;
  });
  property("masking an NRIC hides the middle digits", [fc.constantFrom("S", "T", "F", "G"), fc.stringMatching(/^[0-9]{7}$/), fc.stringMatching(/^[A-Z]$/)] as never, (p: string, d: string, s: string) =>
    maskSensitiveFinancialData(`id ${p}${d}${s}`) === `id ${p}*****${d.slice(5)}${s}`);
  property("masking an OTP removes the code", [fc.constantFrom("OTP", "verification code", "passcode"), fc.stringMatching(/^[0-9]{4,8}$/)] as never, (label: string, code: string) =>
    !maskSensitiveFinancialData(`Your ${label} is ${code}`).includes(code));
  property("masking is idempotent", [fc.string()] as never, (s: string) => {
    const once = maskSensitiveFinancialData(s);
    return maskSensitiveFinancialData(once) === once;
  });
  property("masking leaves text without digits unchanged", [fc.string().filter((s) => !/[0-9]/.test(s))] as never, (s: string) =>
    maskSensitiveFinancialData(s) === s);
  const secret = fc.string({ minLength: 1, maxLength: 40 }).filter((s) => !/[^\x20-\x7e]/.test(s));
  property("cron auth accepts the secret in every supported header form", [secret, fc.constantFrom("Bearer", "") ] as never, (s: string, scheme: string) =>
    withEnv("CRON_SECRET", s, () => isAuthorizedCronRequest(scheme ? `${scheme} ${s}` : s)));
  property("cron auth rejects any other credential", [secret, fc.string()] as never, (s: string, other: string) => {
    fc.pre(other !== s && other !== `Bearer ${s}`);
    return withEnv("CRON_SECRET", s, () => !isAuthorizedCronRequest(other));
  });
  property("cron auth fails closed when no secret is configured", [fc.string()] as never, (any: string) =>
    withEnv("CRON_SECRET", undefined, () => quiet(() => !isAuthorizedCronRequest(any) && !isAuthorizedCronRequest(null))));
}

function dates() {
  console.log("\nDate parsing");
  const ymd = fc.record({
    y: fc.integer({ min: 2000, max: 2099 }),
    m: fc.integer({ min: 1, max: 12 }),
    d: fc.integer({ min: 1, max: 28 }),
  });
  const pad = (n: number) => String(n).padStart(2, "0");
  const sgDate = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Singapore" }).format(d);
  property("always returns a valid Date for any text", [fc.string()] as never, (s: string) =>
    !Number.isNaN(parseSingaporeDate(s).getTime()));
  property("always returns a valid Date for any number", [fc.double()] as never, (n: number) =>
    !Number.isNaN(parseSingaporeDate(n).getTime()));
  property("YYYY-MM-DD lands on that Singapore calendar day", [ymd] as never, ({ y, m, d }: { y: number; m: number; d: number }) =>
    sgDate(parseSingaporeDate(`${y}-${pad(m)}-${pad(d)}`)) === `${y}-${pad(m)}-${pad(d)}`);
  property("DD/MM/YYYY lands on that Singapore calendar day", [ymd] as never, ({ y, m, d }: { y: number; m: number; d: number }) =>
    sgDate(parseSingaporeDate(`${pad(d)}/${pad(m)}/${y}`)) === `${y}-${pad(m)}-${pad(d)}`);
  property("DD/MM/YYYY HH:mm keeps the clock time in Singapore", [ymd, fc.integer({ min: 0, max: 23 }), fc.integer({ min: 0, max: 59 })] as never, ({ y, m, d }: { y: number; m: number; d: number }, hh: number, mm: number) => {
    const out = parseSingaporeDate(`${pad(d)}/${pad(m)}/${y} ${pad(hh)}:${pad(mm)}`);
    return out.toISOString() === new Date(`${y}-${pad(m)}-${pad(d)}T${pad(hh)}:${pad(mm)}:00+08:00`).toISOString();
  });
  property("Date inputs that are valid are returned unchanged", [fc.date({ noInvalidDate: true })] as never, (d: Date) =>
    parseSingaporeDate(d).getTime() === d.getTime());
  property("unix seconds and milliseconds name the same instant", [fc.integer({ min: 1_000_000_000, max: 9_999_999_999 })] as never, (sec: number) =>
    parseSingaporeDate(sec).getTime() === parseSingaporeDate(sec * 1000).getTime());
}

console.log("\n=======================================================");
console.log(`  Property Tests (fast-check, ${NUM_RUNS} runs each)`);
console.log("=======================================================");
billSplit();
secretBox();
security();
dates();
console.log(`\nPassed: ${totalPassed}  Failed: ${totalFailed}\n`);
if (totalFailed > 0) process.exit(1);
