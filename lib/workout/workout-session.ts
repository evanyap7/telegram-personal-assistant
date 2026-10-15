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

export type WorkoutDayCommand =
  | { kind: "set"; day: number; startImmediately: boolean; fromDay?: number }
  | { kind: "next"; startImmediately: boolean; fromDay?: number };

export function parseWorkoutDayCommand(text: string): WorkoutDayCommand | null {
  const t = text.trim().toLowerCase().replace(/[.!?]+$/, "");

  // 1. "lets skip day 1 and start day 2", "skip day 1 and do day 2", "skip today and start day 2"
  const skipAndStartMatch = t.match(
    /^(?:let'?s\s+)?skip\s+(?:(?:day\s*|d)(\d{1,2})|this\s+day|today|this\s+workout|workout)\s*(?:,|and|&|\s+)\s*(?:start|do|go\s+to|switch\s+to|jump\s+to)\s+(?:(?:day\s*|workout\s+day\s*|d))?(\d{1,2})(?:\s+workout)?$/
  );
  if (skipAndStartMatch) {
    const fromDay = skipAndStartMatch[1] ? parseInt(skipAndStartMatch[1], 10) : undefined;
    const day = parseInt(skipAndStartMatch[2], 10);
    return { kind: "set", day, startImmediately: true, fromDay };
  }

  // 2. "skip day 1 and start next day", "skip today and start next day"
  const skipAndStartNextMatch = t.match(
    /^(?:let'?s\s+)?skip\s+(?:(?:day\s*|d)(\d{1,2})|this\s+day|today|this\s+workout|workout)\s*(?:,|and|&|\s+)\s*(?:start|do|go\s+to|switch\s+to)\s+(?:next\s+day|the\s+next\s+day|next\s+workout|next\s+workout\s+day)$/
  );
  if (skipAndStartNextMatch) {
    const fromDay = skipAndStartNextMatch[1] ? parseInt(skipAndStartNextMatch[1], 10) : undefined;
    return { kind: "next", startImmediately: true, fromDay };
  }

  // 3. "start day 2", "lets start day 2", "do day 2", "lets do day 2", "start workout day 2"
  const startDayMatch = t.match(
    /^(?:let'?s\s+)?(?:start|do)\s+(?:workout\s+day\s*|day\s*|workout\s+|d)(\d{1,2})(?:\s+workout)?$/
  );
  if (startDayMatch) {
    const day = parseInt(startDayMatch[1], 10);
    return { kind: "set", day, startImmediately: true };
  }

  // 4. "skip to day 2", "switch to day 2", "go to day 2", "jump to day 2"
  const jumpToDayMatch = t.match(
    /^(?:let'?s\s+)?(?:skip\s+to|switch\s+to|change\s+to|go\s+to|jump\s+to|move\s+to)\s+(?:workout\s+day\s*|day\s*|d)(\d{1,2})$/
  );
  if (jumpToDayMatch) {
    const day = parseInt(jumpToDayMatch[1], 10);
    return { kind: "set", day, startImmediately: true };
  }

  // 5. Slash command or explicit setting: "/workoutday 12", "set workout day 12", "set day 12", "workout day 12"
  const setMatch = t.match(
    /^(?:\/workoutday|(?:set|go to)\s+(?:my\s+)?workout\s+day(?:\s+to)?|workout\s+day|set\s+day(?:\s+to)?)\s*(\d{1,2})$/
  );
  if (setMatch) {
    return { kind: "set", day: parseInt(setMatch[1], 10), startImmediately: false };
  }

  // 6. Next workout day commands: "/nextworkoutday", "next workout day", "next day", "skip to next day"
  if (
    /^(?:\/nextworkoutday|(?:let'?s\s+)?(?:skip\s+to\s+|go\s+to\s+)?next\s+(?:workout\s+day|day|workout))(?:\s+please)?$/.test(
      t
    )
  ) {
    return { kind: "next", startImmediately: false };
  }

  // 7. "skip day 1", "skip this day", "skip today", "skip workout"
  const skipMatch = t.match(
    /^(?:let'?s\s+)?skip\s+(?:this\s+day|today|this\s+workout|workout|(?:day\s*|d)(\d{1,2}))(?:\s+workout)?$/
  );
  if (skipMatch) {
    const fromDay = skipMatch[1] ? parseInt(skipMatch[1], 10) : undefined;
    return { kind: "next", startImmediately: false, fromDay };
  }

  return null;
}

export function isSkipExerciseCommand(text: string): boolean {
  const t = text.trim().toLowerCase().replace(/[.!?]+$/, "");
  return (
    /^(?:skip|next)\s+(?:this\s+)?exercise$/.test(t) ||
    t === "skip exercise" ||
    t === "skip this exercise" ||
    t === "next exercise"
  );
}

export function isSkipSetCommand(text: string): boolean {
  const t = text.trim().toLowerCase().replace(/[.!?]+$/, "");
  return (
    /^(?:skip|next)\s+(?:this\s+)?set$/.test(t) ||
    t === "skip set" ||
    t === "skip this set" ||
    t === "next set"
  );
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

export async function startPH3Workout(params: {
  chatId: number;
  day?: number;
  headerNotice?: string;
  forceNew?: boolean;
}): Promise<void> {
  const { chatId, day: requestedDay, headerNotice, forceNew } = params;

  const existing = await loadSession();
  if (existing && !forceNew) {
    if (requestedDay === undefined || requestedDay === existing.day) {
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
  }

  if (existing) {
    await flushFallbackSets(existing);
    await clearPH3Session();
  }

  const targetDay =
    requestedDay !== undefined
      ? requestedDay
      : (await getUserPH3Progress()).currentDay;

  await setUserPH3Day(targetDay);
  const plan = await getDayPlan(targetDay);

  if (plan.isRestDay || plan.exercises.length === 0) {
    const lines: string[] = [];
    if (headerNotice) lines.push(headerNotice, "");
    lines.push(
      `Today is *Week ${plan.week}, Day ${plan.day}* — ${stripDayPrefix(plan.dayTitle) || "Rest day"}.`,
      "",
      "Nothing to log today. Say \"next workout day\" to skip ahead, or \"set workout day 12\" to jump to a specific day."
    );
    await sendTelegramMessage(chatId, lines.join("\n"));
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

  const lines: string[] = [];
  if (headerNotice) {
    lines.push(headerNotice, "");
  }
  lines.push(
    buildStartMessage(plan),
    "",
    "Let's go! I'll ask for each set. Say \"end workout\" any time to stop.",
    "",
    buildSetPrompt(plan, 0, 0)
  );

  await sendTelegramMessage(chatId, lines.join("\n"));
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

async function skipExercise(chatId: number, state: WorkoutSessionState): Promise<void> {
  const plan = await getDayPlan(state.day);
  const currentEx = plan.exercises[state.exIdx];
  const nextExIdx = state.exIdx + 1;

  if (nextExIdx >= plan.exercises.length) {
    await sendTelegramMessage(chatId, `Skipped ${currentEx.exercise}. That was the last exercise!`);
    await finishSession(chatId, state);
    return;
  }

  state.exIdx = nextExIdx;
  state.setIdx = 0;
  await saveSession(state);

  await sendTelegramMessage(
    chatId,
    [
      `Skipped ${currentEx.exercise}.`,
      "",
      `Next exercise — *${plan.exercises[nextExIdx].exercise}*, ${plan.exercises[nextExIdx].sets.length} sets.`,
      "",
      buildSetPrompt(plan, state.exIdx, state.setIdx),
    ].join("\n")
  );
}

async function skipSet(chatId: number, state: WorkoutSessionState): Promise<void> {
  const plan = await getDayPlan(state.day);
  const ex = plan.exercises[state.exIdx];
  const nextSetIdx = state.setIdx + 1;
  const exerciseDone = nextSetIdx >= ex.sets.length;
  const nextExIdx = exerciseDone ? state.exIdx + 1 : state.exIdx;

  if (nextExIdx >= plan.exercises.length) {
    await sendTelegramMessage(chatId, `Skipped set ${state.setIdx + 1} of ${ex.exercise}. Workout complete!`);
    await finishSession(chatId, state);
    return;
  }

  state.exIdx = nextExIdx;
  state.setIdx = exerciseDone ? 0 : nextSetIdx;
  await saveSession(state);

  const header = exerciseDone
    ? `Skipped set. ${ex.exercise} done!\n\nNext exercise — *${plan.exercises[nextExIdx].exercise}*, ${plan.exercises[nextExIdx].sets.length} sets.`
    : `Skipped set ${nextSetIdx} of ${ex.sets.length}.`;
  await sendTelegramMessage(chatId, `${header}\n\n${buildSetPrompt(plan, state.exIdx, state.setIdx)}`);
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
  const isWorkoutSlash = /^\/(workout|gym|endworkout|end|workoutday|nextworkoutday|startday)\b/i.test(trimmed);
  if (trimmed.startsWith("/") && !isWorkoutSlash) return false;

  const dayCommand = parseWorkoutDayCommand(trimmed);
  const isStart = isWorkoutStartPhrase(trimmed);
  const isEnd = isEndWorkoutCommand(trimmed);

  const state = await loadSession();

  if (!state) {
    if (dayCommand) {
      let targetDay: number;
      if (dayCommand.kind === "set") {
        targetDay = dayCommand.day;
      } else if (dayCommand.fromDay !== undefined) {
        targetDay = dayCommand.fromDay >= 90 ? 1 : dayCommand.fromDay + 1;
      } else {
        const current = await getUserPH3Progress();
        targetDay = current.currentDay >= 90 ? 1 : current.currentDay + 1;
      }

      if (dayCommand.startImmediately) {
        const prefix = dayCommand.fromDay
          ? `Skipping Day ${dayCommand.fromDay} and starting Day ${targetDay}!`
          : undefined;
        await startPH3Workout({ chatId, day: targetDay, headerNotice: prefix, forceNew: true });
      } else {
        const progress = await setUserPH3Day(targetDay);
        await sendTelegramMessage(
          chatId,
          `Okay — you're now on *Week ${progress.currentWeek}, Day ${progress.currentDay}*. Say "workout" when you're ready.`
        );
      }
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

  if (dayCommand) {
    let targetDay: number;
    if (dayCommand.kind === "set") {
      targetDay = dayCommand.day;
    } else if (dayCommand.fromDay !== undefined) {
      targetDay = dayCommand.fromDay >= 90 ? 1 : dayCommand.fromDay + 1;
    } else {
      targetDay = state.day >= 90 ? 1 : state.day + 1;
    }

    const flushed = await flushFallbackSets(state);
    await clearPH3Session();

    const savedNotice =
      state.logged.length > 0
        ? `Saved ${state.logged.length} set${state.logged.length === 1 ? "" : "s"} from Day ${state.day}.`
        : "";

    if (dayCommand.startImmediately) {
      const skipPrefix = dayCommand.fromDay
        ? `Skipping Day ${dayCommand.fromDay} and switching to Day ${targetDay}!`
        : `Switching to Day ${targetDay}!`;
      const header = savedNotice ? `${savedNotice}\n\n${skipPrefix}` : skipPrefix;
      await startPH3Workout({ chatId, day: targetDay, headerNotice: header, forceNew: true });
    } else {
      const progress = await setUserPH3Day(targetDay);
      const lines: string[] = [];
      if (savedNotice) lines.push(savedNotice);
      lines.push(
        `Okay — current workout ended and you're now on *Week ${progress.currentWeek}, Day ${progress.currentDay}*. Say "workout" when you're ready.`
      );
      await sendTelegramMessage(chatId, lines.join("\n\n"));
    }
    return true;
  }

  if (isSkipExerciseCommand(trimmed)) {
    await skipExercise(chatId, state);
    return true;
  }

  if (isSkipSetCommand(trimmed)) {
    await skipSet(chatId, state);
    return true;
  }

  if (isStart) {
    await startPH3Workout({ chatId });
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
