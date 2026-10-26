import { sendTelegramMessage } from "../telegram";
import type { ExerciseKind } from "./coach";
import {
  loadRestConfig,
  resetRestConfig,
  saveRestConfig,
  type RestConfig,
} from "./rest-timer-store";

export const REST_USAGE = [
  "*Rest timer*",
  "`/rest` shows your settings",
  "`/rest main 4m` · `/rest compound 2m` · `/rest isolation 60s` sets a rest",
  "`/rest off` or `/rest on` switches auto-start",
  "`/rest reset` restores the defaults",
].join("\n");

const MIN_SECONDS = 15;
const MAX_SECONDS = 15 * 60;

const KIND_ALIASES: Record<string, ExerciseKind> = {
  main: "main",
  big: "main",
  compound: "compound",
  compounds: "compound",
  isolation: "isolation",
  accessory: "isolation",
  accessories: "isolation",
};

export type RestCommand =
  | { kind: "show" }
  | { kind: "on" | "off" | "reset" }
  | { kind: "set"; exercise: ExerciseKind; seconds: number }
  | { kind: "usage_error"; message: string };

/** "4m", "90s", "1.5m", "90" (bare numbers under 15 are minutes, otherwise seconds) to seconds. */
export function parseRestDuration(raw: string): number | null {
  const m = raw.trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(m|min|mins|s|sec|secs)?$/);
  if (!m) return null;
  const value = parseFloat(m[1]);
  const unit = m[2];
  const seconds = unit
    ? unit.startsWith("m")
      ? value * 60
      : value
    : value < MIN_SECONDS
      ? value * 60
      : value;
  const rounded = Math.round(seconds);
  return rounded >= MIN_SECONDS && rounded <= MAX_SECONDS ? rounded : null;
}

export function parseRestCommand(text: string): RestCommand | null {
  const trimmed = text.trim();
  if (!/^\/rest(@\w+)?(\s|$)/i.test(trimmed)) return null;
  const parts = trimmed.split(/\s+/).slice(1).map((p) => p.toLowerCase());
  if (parts.length === 0) return { kind: "show" };
  if (parts.length === 1 && (parts[0] === "on" || parts[0] === "off" || parts[0] === "reset")) {
    return { kind: parts[0] };
  }
  const exercise = KIND_ALIASES[parts[0]];
  const seconds = parts[1] ? parseRestDuration(parts.slice(1).join("")) : null;
  if (exercise && seconds) return { kind: "set", exercise, seconds };
  return {
    kind: "usage_error",
    message: `Rest must be between ${MIN_SECONDS} seconds and ${MAX_SECONDS / 60} minutes.\n\n${REST_USAGE}`,
  };
}

export function formatRestDuration(seconds: number): string {
  if (seconds < 90) return `${seconds}s`;
  const mins = seconds / 60;
  return `${Number.isInteger(mins) ? mins : mins.toFixed(1)} min`;
}

function describeConfig(config: RestConfig): string {
  return [
    `⏱ *Auto rest timer: ${config.enabled ? "on" : "off"}*`,
    `• Squat, bench, deadlift: ${formatRestDuration(config.main)}`,
    `• Compounds: ${formatRestDuration(config.compound)}`,
    `• Isolation: ${formatRestDuration(config.isolation)}`,
  ].join("\n");
}

export async function handleRestCommand(params: { chatId: number; text: string }): Promise<void> {
  const command = parseRestCommand(params.text);
  if (!command) return;
  const send = (text: string) => sendTelegramMessage(params.chatId, text);

  if (command.kind === "usage_error") return void (await send(command.message));
  if (command.kind === "reset") {
    await resetRestConfig();
    return void (await send(`Defaults restored.\n\n${describeConfig(await loadRestConfig())}`));
  }
  const config = await loadRestConfig();
  if (command.kind === "show") return void (await send(`${describeConfig(config)}\n\n${REST_USAGE}`));

  const updated: RestConfig =
    command.kind === "set"
      ? { ...config, [command.exercise]: command.seconds }
      : { ...config, enabled: command.kind === "on" };
  await saveRestConfig(updated);
  await send(`Saved.\n\n${describeConfig(updated)}`);
}
