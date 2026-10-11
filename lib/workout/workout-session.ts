import { sendTelegramMessage } from "../telegram";
import {
  advanceUserPH3Day,
  clearPH3Session,
  getDayPlan,
  getUserPH3Progress,
  loadPH3SessionRaw,
  savePH3SessionRaw,
  setUserPH3Day,
  writeSetToSheet,
  type PH3DayPlan,
  type PH3ExerciseSet,
} from "./ph3-program";
import { logWorkoutSession } from "./workout-service";
import type { WorkoutSet } from "./workout-types";

const USER_NAME = "Evan";

interface LoggedSet {
  exercise: string;
  setNumber: number;
  weightKg: number;
  reps: number;
  /** true if the entry went into the PH3 sheet cell; false if it needs the Workouts-tab fallback. */
  inSheet: boolean;
}

interface WorkoutSessionState {
  day: number;
  week: number;
  dayTitle: string;
  exIdx: number;
  setIdx: number;
  logged: LoggedSet[];
  startedAt: string;
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested in scripts/test-workout-session.ts)
// ---------------------------------------------------------------------------

/**
 * Parses a single set reply such as "100 x 5", "100x5", "100 5", "100kg 5 reps",
 * "100 for 5", "100*5" or "bw x 10". Returns null when it isn't clearly weight + reps.
 */
export function parseSetInput(text: string): { weightKg: number; reps: number } | null {
  const cleaned = text.trim().toLowerCase().replace(/,/g, ".");
  const match = cleaned.match(
    /^(bw|bodyweight|\d+(?:\.\d+)?)\s*(?:kgs?)?(?:\s*(?:x|×|\*|for|by)\s*|\s+)(\d{1,3})\s*(?:reps?)?$/
  );
  if (!match) return null;

  const weightKg = /^[a-z]/.test(match[1]) ? 0 : parseFloat(match[1]);
  const reps = parseInt(match[2], 10);
  if (!Number.isFinite(weightKg) || weightKg > 1000) return null;
  if (reps < 1 || reps > 100) return null;
  return { weightKg, reps };
}

export function isEndWorkoutCommand(text: string): boolean {
  const t = text.trim().toLowerCase().replace(/[.!]+$/, "");
  return (
    t === "/endworkout" ||
    t === "/end" ||
    /^(end|stop|cancel|quit|exit|finish)(\s+(the|my))?(\s+(workout|session|gym|training))?$/.test(t) ||
    /^(i'?m|im|i am)\s+(done|finished)(\s+(working out|with (the|my) workout|for today))?$/.test(t)
  );
}

export function isWorkoutStartPhrase(text: string): boolean {
  const t = text.trim().toLowerCase().replace(/[.!]+$/, "");
  return (
    t === "/gym" ||
    t === "/workout" ||
    t === "gym" ||
    t === "workout" ||
    t === "gym time" ||
    /^(i\s*(wanna|want to|will|'?m going to|am going to|'?m gonna|gonna)\s+)(work\s*out|workout|train|lift)\b/.test(t) ||
    /^(let'?s|time to|lets)\s+(work\s*out|workout|train|lift)\b/.test(t) ||
    /^start\s+(my\s+|the\s+)?(workout|training|gym)\b/.test(t)
  );
}

export function parseWorkoutDayCommand(
  text: string
): { kind: "set"; day: number } | { kind: "next" } | null {
  const t = text.trim().toLowerCase();
  const setMatch = t.match(/^(?:\/workoutday|(?:set|go to)\s+(?:my\s+)?workout\s+day|workout\s+day)\s+(\d{1,2})$/);
  if (setMatch) return { kind: "set", day: parseInt(setMatch[1], 10) };
  if (/^(?:\/nextworkoutday|(?:skip to |go to )?next workout day)$/.test(t)) return { kind: "next" };
  return null;
}

function stripDayPrefix(title: string): string {
  return title.replace(/^Day\s+\d+\s*/i, "").trim();
}

/** "95.0" + "x9" -> "95kg × 9"; "" + "x6-8" -> "6-8 reps". */
export function describeTarget(set: PH3ExerciseSet): string {
  const reps = set.reps.replace(/^x/i, "").trim();
  const repsText = reps ? `${reps} reps` : "";
  const weightNum = parseFloat(set.weight);
  if (set.weight && Number.isFinite(weightNum) && weightNum > 0 && /^[\d.\s]+$/.test(set.weight)) {
    return reps ? `${weightNum}kg × ${reps}` : `${weightNum}kg`;
  }
  return repsText || set.weight;
}

function formatLogged(l: LoggedSet): string {
  return `${l.weightKg > 0 ? `${l.weightKg}kg` : "BW"} × ${l.reps}`;
}

function buildStartMessage(plan: PH3DayPlan): string {
  const lines = [
    `Great ${USER_NAME}! Today is *Week ${plan.week}, Day ${plan.day}* — ${stripDayPrefix(plan.dayTitle) || plan.dayTitle}`,
    "",
    "Here's today's workout:",
  ];
  plan.exercises.forEach((ex, i) => {
    lines.push(`${i + 1}. ${ex.exercise} — ${ex.sets.length} sets`);
  });
  return lines.join("\n");
}

function buildSetPrompt(plan: PH3DayPlan, exIdx: number, setIdx: number): string {
  const ex = plan.exercises[exIdx];
  const target = describeTarget(ex.sets[setIdx]);
  return [
    `*${ex.exercise}* (${exIdx + 1}/${plan.exercises.length}) — set ${setIdx + 1} of ${ex.sets.length}${target ? ` · target ${target}` : ""}`,
    "What weight and reps did you do? (e.g. `100 x 5`)",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Session persistence (Memory sheet: serverless instances share no memory)
// ---------------------------------------------------------------------------

async function loadSession(): Promise<WorkoutSessionState | null> {
  const raw = await loadPH3SessionRaw();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as WorkoutSessionState;
    return typeof parsed.day === "number" ? parsed : null;
  } catch {
    return null;
  }
}

async function saveSession(state: WorkoutSessionState): Promise<void> {
  await savePH3SessionRaw(JSON.stringify(state));
}

/** Appends sets that couldn't be written into the program sheet to the Workouts tab. */
async function flushFallbackSets(state: WorkoutSessionState): Promise<number> {
  const pending = state.logged.filter((l) => !l.inSheet);
  if (pending.length === 0) return 0;

  const sets: WorkoutSet[] = pending.map((l) => ({
    exercise: l.exercise,
    setNumber: l.setNumber,
    weightKg: l.weightKg,
    reps: l.reps,
  }));
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  await logWorkoutSession({
    sessionId: `ph3_${state.day}_${Date.now()}`,
    date,
    week: state.week,
    location: "ph3",
    routine: state.dayTitle,
    sets,
    totalVolumeKg: sets.reduce((sum, s) => sum + s.weightKg * s.reps, 0),
    createdAt: new Date().toISOString(),
  });
  return pending.length;
}

function summarize(state: WorkoutSessionState): string[] {
  const byExercise = new Map<string, LoggedSet[]>();
  for (const l of state.logged) {
    byExercise.set(l.exercise, [...(byExercise.get(l.exercise) ?? []), l]);
  }
  return Array.from(byExercise.entries()).map(
    ([exercise, sets]) => `• ${exercise}: ${sets.map(formatLogged).join(", ")}`
  );
}

function savedWhereNote(state: WorkoutSessionState, flushed: number): string {
  const inSheet = state.logged.length - flushed;
  const parts: string[] = [];
  if (inSheet > 0) parts.push(`${inSheet} in your PH3 sheet`);
  if (flushed > 0) parts.push(`${flushed} in the Workouts tab (those cells hold formulas or existing entries)`);
  return parts.length ? `Saved: ${parts.join(", ")}.` : "";
}

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

export async function startPH3Workout(params: { chatId: number }): Promise<void> {
  const { chatId } = params;

  const existing = await loadSession();
  if (existing) {
    const plan = await getDayPlan(existing.day);
    await sendTelegramMessage(
      chatId,
      [
        "You already have a workout in progress — picking up where we left off.",
        "",
        buildSetPrompt(plan, existing.exIdx, existing.setIdx),
        "",
        "_Say \"end workout\" any time to stop._",
      ].join("\n")
    );
    return;
  }

  const progress = await getUserPH3Progress();
  const plan = await getDayPlan(progress.currentDay);

  if (plan.isRestDay || plan.exercises.length === 0) {
    await sendTelegramMessage(
      chatId,
      [
        `Today is *Week ${plan.week}, Day ${plan.day}* — ${stripDayPrefix(plan.dayTitle) || "Rest day"}.`,
        "",
        "Nothing to log today. Say \"next workout day\" to skip ahead, or \"set workout day 12\" to jump to a specific day.",
      ].join("\n")
    );
    return;
  }

  await saveSession({
    day: plan.day,
    week: plan.week,
    dayTitle: plan.dayTitle,
    exIdx: 0,
    setIdx: 0,
    logged: [],
    startedAt: new Date().toISOString(),
  });

  await sendTelegramMessage(
    chatId,
    [
      buildStartMessage(plan),
      "",
      "Let's go! I'll ask for each set. Say \"end workout\" any time to stop.",
      "",
      buildSetPrompt(plan, 0, 0),
    ].join("\n")
  );
}

async function endSession(chatId: number, state: WorkoutSessionState): Promise<void> {
  const flushed = await flushFallbackSets(state);
  await clearPH3Session();

  const lines = ["Workout ended — back to normal."];
  if (state.logged.length > 0) {
    lines.push("", `Logged ${state.logged.length} set${state.logged.length === 1 ? "" : "s"}:`, ...summarize(state));
    lines.push("", savedWhereNote(state, flushed));
  }
  lines.push("", `_I'll keep you on Day ${state.day} so you can pick it up next time._`);
  await sendTelegramMessage(chatId, lines.join("\n"));
}

async function finishSession(chatId: number, state: WorkoutSessionState): Promise<void> {
  const flushed = await flushFallbackSets(state);
  await clearPH3Session();
  const next = await advanceUserPH3Day();

  await sendTelegramMessage(
    chatId,
    [
      `That's the workout, ${USER_NAME}! Week ${state.week}, Day ${state.day} complete.`,
      "",
      ...summarize(state),
      "",
      savedWhereNote(state, flushed),
      `Next up: Week ${next.currentWeek}, Day ${next.currentDay}. Back to normal mode.`,
    ].join("\n")
  );
}

async function handleLoggedSet(
  chatId: number,
  state: WorkoutSessionState,
  entry: { weightKg: number; reps: number }
): Promise<void> {
  const plan = await getDayPlan(state.day);
  const ex = plan.exercises[state.exIdx];
  const set = ex.sets[state.setIdx];

  let inSheet = false;
  try {
    inSheet = (await writeSetToSheet({ plan, set, ...entry })) === "written";
  } catch (error) {
    console.error("PH3 sheet write failed; falling back to Workouts tab:", error);
  }

  state.logged.push({
    exercise: ex.exercise,
    setNumber: set.setNumber,
    weightKg: entry.weightKg,
    reps: entry.reps,
    inSheet,
  });

  const nextSetIdx = state.setIdx + 1;
  const exerciseDone = nextSetIdx >= ex.sets.length;
  const nextExIdx = exerciseDone ? state.exIdx + 1 : state.exIdx;

  if (nextExIdx >= plan.exercises.length) {
    await finishSession(chatId, state);
    return;
  }

  state.exIdx = nextExIdx;
  state.setIdx = exerciseDone ? 0 : nextSetIdx;
  await saveSession(state);

  const confirm = `✅ ${ex.exercise}: ${formatLogged(state.logged[state.logged.length - 1])}`;
  const header = exerciseDone
    ? `${confirm}\n\nNext exercise — ${plan.exercises[nextExIdx].exercise}, ${plan.exercises[nextExIdx].sets.length} sets.`
    : confirm;
  await sendTelegramMessage(chatId, `${header}\n\n${buildSetPrompt(plan, state.exIdx, state.setIdx)}`);
}

/**
 * Single entry point for the Telegram route. Returns true if the message was consumed by the
 * workout flow (start phrase, day command, or an active guided session); false to let the
 * normal assistant handle it.
 */
export async function handleWorkoutSessionMessage(params: {
  chatId: number;
  text: string;
}): Promise<boolean> {
  const { chatId, text } = params;
  const trimmed = text.trim();

  // Cheap path: slash commands other than the workout ones never need a session lookup.
  const isWorkoutSlash = /^\/(workout|gym|endworkout|end|workoutday|nextworkoutday)\b/i.test(trimmed);
  if (trimmed.startsWith("/") && !isWorkoutSlash) return false;

  const dayCommand = parseWorkoutDayCommand(trimmed);
  const isStart = isWorkoutStartPhrase(trimmed);
  const isEnd = isEndWorkoutCommand(trimmed);

  const state = await loadSession();

  if (!state) {
    if (dayCommand) {
      const progress =
        dayCommand.kind === "set" ? await setUserPH3Day(dayCommand.day) : await advanceUserPH3Day();
      await sendTelegramMessage(
        chatId,
        `Okay — you're now on *Week ${progress.currentWeek}, Day ${progress.currentDay}*. Say "workout" when you're ready.`
      );
      return true;
    }
    if (isStart) {
      await startPH3Workout({ chatId });
      return true;
    }
    return false;
  }

  // A session is active from here on.
  if (isEnd) {
    await endSession(chatId, state);
    return true;
  }

  if (isStart) {
    await startPH3Workout({ chatId });
    return true;
  }

  if (dayCommand) {
    await sendTelegramMessage(chatId, "Finish or end your current workout first (say \"end workout\"), then change the day.");
    return true;
  }

  const entry = parseSetInput(trimmed);
  if (!entry) {
    const plan = await getDayPlan(state.day);
    await sendTelegramMessage(
      chatId,
      [
        "I didn't catch that as a set. Reply with weight and reps like `100 x 5` (or `bw x 10`).",
        "",
        buildSetPrompt(plan, state.exIdx, state.setIdx),
        "",
        "_Say \"end workout\" to stop._",
      ].join("\n")
    );
    return true;
  }

  await handleLoggedSet(chatId, state, entry);
  return true;
}
