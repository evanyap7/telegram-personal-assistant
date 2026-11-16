import { tool, type ToolSet } from "ai";
import { z } from "zod";

/**
 * Tennis court tools backed by the always-on iCondo service (icondo-tennis-bot,
 * service/app.py). Registered only when TENNIS_API_URL and TENNIS_API_SECRET are set.
 */
export interface TennisEnv {
  TENNIS_API_URL?: string;
  TENNIS_API_SECRET?: string;
}

async function call(env: Required<TennisEnv>, method: string, path: string, body?: unknown) {
  const res = await fetch(`${env.TENNIS_API_URL.replace(/\/$/, "")}${path}`, {
    method,
    headers: { "X-Secret": env.TENNIS_API_SECRET, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`tennis service ${res.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : {};
}

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("YYYY-MM-DD (Singapore date)");
const time = z.string().regex(/^\d{2}:\d{2}$/).describe("24h start time, e.g. 18:00");

export function buildTennisTools(env: TennisEnv = process.env as TennisEnv): ToolSet {
  if (!env.TENNIS_API_URL || !env.TENNIS_API_SECRET) return {};
  const e = env as Required<TennisEnv>;
  const wrap = <T>(fn: (input: T) => Promise<unknown>) => async (input: T) => {
    try {
      return { ok: true, result: await fn(input) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  };

  return {
    tennisSlots: tool({
      description:
        "List the iCondo tennis court's hourly slots for a date and whether each is open. Read-only.",
      inputSchema: z.object({ date }),
      execute: wrap(({ date: d }: { date: string }) => call(e, "GET", `/slots?date=${d}`)),
    }),
    tennisBook: tool({
      description:
        "Book ONE tennis slot (charges a small fee to the user's saved card; cannot be cancelled within 7 days). First check tennisSlots, tell the user the exact date/time/fee, and only call this with userConfirmed true after they explicitly said yes.",
      inputSchema: z.object({ date, time, userConfirmed: z.boolean() }),
      execute: wrap(({ date: d, time: t, userConfirmed }: { date: string; time: string; userConfirmed: boolean }) => {
        if (!userConfirmed) throw new Error("The user has not confirmed this booking yet. Ask them first.");
        return call(e, "POST", "/book", { date: d, time: t, confirm: true });
      }),
    }),
    tennisWatch: tool({
      description:
        "Watch a fully-booked date for cancellations and auto-book the first preferred slot that opens. Tell the user the watcher only runs while the service is up and that a catch will charge their card.",
      inputSchema: z.object({ date, times: z.array(time).min(1), userConfirmed: z.boolean() }),
      execute: wrap(({ date: d, times, userConfirmed }: { date: string; times: string[]; userConfirmed: boolean }) => {
        if (!userConfirmed) throw new Error("The user has not confirmed auto-booking yet. Ask them first.");
        return call(e, "POST", "/watch", { date: d, times });
      }),
    }),
    tennisBookings: tool({
      description: "List the user's active iCondo bookings.",
      inputSchema: z.object({}),
      execute: wrap(() => call(e, "GET", "/bookings")),
    }),
  };
}
