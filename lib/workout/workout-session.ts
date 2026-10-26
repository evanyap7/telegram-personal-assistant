import { sendTelegramMessage } from "../telegram";
import {
  advanceUserPH3Day,
  clearPH3Session,
  clearSetCell,
  getDayPlan,
  getUserPH3Progress,
  loadPH3SessionRaw,
  overwriteSetCell,
  savePH3SessionRaw,
  setUserPH3Day,
  programDayFromWeekDay,
  writeSetToSheet,
  type PH3DayPlan,
  type PH3ExerciseSet,
} from "./ph3-program";
import { coachLine } from "./coach";
import { formatRestDuration } from "./rest-command";
import { getAutoRestSeconds, startRestTimer } from "./rest-timer-store";
import { logWorkoutSession } from "./workout-service";
import type { WorkoutSet } from "./workout-types";

const USER_NAME = "Evan";

export interface LoggedSet {
  exercise: string;
  setNumber: number;
  weightKg: number;
  reps: number;
  /** true if the entry went into the PH3 sheet cell; false if it needs the Workouts-tab fallback. */
  inSheet: boolean;
  /** true if the reps replaced the prescribed rep range in the sheet. */
  repsInSheet?: boolean;
  /** The rep range that was in the sheet before the reps replaced it, restored on removal. */
  originalReps?: string;
}

export interface SkippedSet {
  exercise: string;
  setNumber: number;
}

export interface WorkoutSessionState {
  day: number;
  week: number;
  dayTitle: string;
  exIdx: number;
  setIdx: number;
  logged: LoggedSet[];
  /** Absent on sessions saved before skips were tracked per set. */
  skipped?: SkippedSet[];
  startedAt: string;
}

export type SetStatus = "logged" | "skipped" | "pending";

export function getSetStatus(
  state: Pick<WorkoutSessionState, "logged" | "skipped">,
  exercise: string,
  setNumber: number
): SetStatus {
  if (state.logged.some((l) => l.exercise === exercise && l.setNumber === setNumber)) {
    return "logged";
  }
  if ((state.skipped ?? []).some((k) => k.exercise === exercise && k.setNumber === setNumber)) {
    return "skipped";
  }
  return "pending";
}

/**
 * First pending set at or after (fromExIdx, fromSetIdx) in plan order, wrapping around to
 * earlier sets so that nothing left undone is silently dropped. Null when every set is
 * logged or skipped.
 */
export function findNextPending(
  plan: PH3DayPlan,
  state: Pick<WorkoutSessionState, "logged" | "skipped">,
  fromExIdx: number,
  fromSetIdx: number
): { exIdx: number; setIdx: number } | null {
  const positions: Array<{ exIdx: number; setIdx: number }> = [];
  plan.exercises.forEach((ex, exIdx) =>
    ex.sets.forEach((_, setIdx) => positions.push({ exIdx, setIdx }))
  );
  const start = Math.max(
    0,
    positions.findIndex((p) => p.exIdx === fromExIdx && p.setIdx === fromSetIdx)
  );
  for (let i = 0; i < positions.length; i++) {
    const pos = positions[(start + i) % positions.length];
    const ex = plan.exercises[pos.exIdx];
    if (getSetStatus(state, ex.exercise, ex.sets[pos.setIdx].setNumber) === "pending") {
      return pos;
    }
  }
  return null;
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

  // 8. Looser phrasing, anywhere in a sentence: "lets start over from week 1 day 1",
  //    "restart the program", "start week 3 day 2", "week 2 day 4".
  const weekDay = t.match(/\bweek\s*(\d{1,2})\s*[,:-]?\s*(?:day|d)\s*(\d)\b/);
  const dayOnly = t.match(/\b(?:workout\s+)?day\s*(\d{1,2})\b/);
  const restart =
    /\b(start(?:ing)?\s+(?:over|again|afresh)|restart|re-?start|begin again|reset)\b/.test(t) ||
    /\bfrom\s+(?:the\s+)?(?:beginning|scratch|top|start)\b/.test(t);
  const programWord = /\b(program|programme|plan|routine|whole thing|beginning|scratch|from the top|week\s*1|day\s*1)\b/.test(t);
  const verb = /\b(start|restart|re-?start|begin|go|jump|switch|reset|do|lets|let's|move|set|from|back)\b/.test(t);
  // "tomorrow", "later"... mean move the position now but don't start a session.
  const later = /\b(tomorrow|tmr|tmrw|later|tonight|next time|this (?:morning|afternoon|evening)|in the (?:morning|afternoon|evening)|not now)\b/.test(t);

  if (weekDay) {
    const day = programDayFromWeekDay(parseInt(weekDay[1], 10), parseInt(weekDay[2], 10));
    if (day === null) return null;
    const bare = /^week\s*\d{1,2}\s*[,:-]?\s*(?:day|d)\s*\d$/.test(t);
    if (!verb && !bare) return null;
    return { kind: "set", day, startImmediately: verb && !bare && !later };
  }
  if (restart && programWord) {
    const day = dayOnly ? parseInt(dayOnly[1], 10) : 1;
    if (day < 1 || day > 90) return null;
    return { kind: "set", day, startImmediately: !later };
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

export function buildSetPrompt(plan: PH3DayPlan, exIdx: number, setIdx: number): string {
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

export async function loadSession(): Promise<WorkoutSessionState | null> {
  const raw = await loadPH3SessionRaw();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as WorkoutSessionState;
    return typeof parsed.day === "number" ? parsed : null;
  } catch {
    return null;
  }
}

export async function saveSession(state: WorkoutSessionState): Promise<void> {
  await savePH3SessionRaw(JSON.stringify(state));
}

/** Appends sets that couldn't be written into the program sheet to the Workouts tab. */
export async function flushFallbackSets(state: WorkoutSessionState): Promise<number> {
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

  await sendTelegramMessage(chatId, lines.join("\n"), buildWorkoutActiveInlineKeyboard());
}

export async function endSession(chatId: number, state: WorkoutSessionState): Promise<void> {
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

export async function finishSession(chatId: number, state: WorkoutSessionState): Promise<void> {
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

export function markSkipped(
  state: WorkoutSessionState,
  exercise: string,
  setNumber: number
): void {
  if (getSetStatus(state, exercise, setNumber) !== "pending") return;
  state.skipped = [...(state.skipped ?? []), { exercise, setNumber }];
}

/**
 * Moves the cursor to the next pending set, or finishes the session when none remain. When
 * `autoRestSeconds` is given and a set follows, the rest timer starts with the next prompt.
 */
async function advanceOrFinish(
  chatId: number,
  state: WorkoutSessionState,
  plan: PH3DayPlan,
  preface: string,
  autoRestSeconds?: number
): Promise<void> {
  const prevExIdx = state.exIdx;
  const next = findNextPending(plan, state, state.exIdx, state.setIdx);
  if (!next) {
    await sendTelegramMessage(chatId, preface);
    await finishSession(chatId, state);
    return;
  }

  state.exIdx = next.exIdx;
  state.setIdx = next.setIdx;
  await saveSession(state);

  const lines = [preface];
  if (autoRestSeconds) {
    // A failed timer write must not lose the set that was just logged.
    const started = await startRestTimer(chatId, autoRestSeconds, state).then(
      () => true,
      (error) => {
        console.error("Auto rest timer failed to start:", error);
        return false;
      }
    );
    if (started) lines.push(`⏱ Rest ${formatRestDuration(autoRestSeconds)} — I'll ping you when it's time.`);
  }
  if (next.exIdx !== prevExIdx) {
    const nextEx = plan.exercises[next.exIdx];
    lines.push("", `Next exercise — *${nextEx.exercise}*, ${nextEx.sets.length} sets.`);
  }
  lines.push("", buildSetPrompt(plan, state.exIdx, state.setIdx));
  await sendTelegramMessage(chatId, lines.join("\n"), buildWorkoutActiveInlineKeyboard());
}

export function buildWorkoutActiveInlineKeyboard(): {
  inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
} {
  return {
    inline_keyboard: [
      [
        { text: "⏭ Skip Set", callback_data: "workout:skip_set" },
        { text: "⏩ Next Ex", callback_data: "workout:skip_exercise" },
      ],
      [
        { text: "⏱ 2m Rest", callback_data: "workout:rest:120" },
        { text: "⏱ 3m Rest", callback_data: "workout:rest:180" },
        { text: "🏁 End", callback_data: "workout:end" },
      ],
    ],
  };
}

export async function skipExercise(chatId: number, state: WorkoutSessionState): Promise<void> {
  const plan = await getDayPlan(state.day);
  const currentEx = plan.exercises[state.exIdx];
  for (const set of currentEx.sets) markSkipped(state, currentEx.exercise, set.setNumber);
  await advanceOrFinish(chatId, state, plan, `Skipped ${currentEx.exercise}.`);
}

export async function skipSet(chatId: number, state: WorkoutSessionState): Promise<void> {
  const plan = await getDayPlan(state.day);
  const ex = plan.exercises[state.exIdx];
  const set = ex.sets[state.setIdx];
  markSkipped(state, ex.exercise, set.setNumber);
  await advanceOrFinish(
    chatId,
    state,
    plan,
    `Skipped set ${state.setIdx + 1} of ${ex.sets.length}.`
  );
}

/**
 * Records a set against a specific plan slot: writes it to the program sheet when the cell is
 * free (otherwise it is queued for the Workouts tab) and replaces any earlier entry or skip.
 */
export async function recordSet(
  state: WorkoutSessionState,
  plan: PH3DayPlan,
  exIdx: number,
  setIdx: number,
  entry: { weightKg: number; reps: number }
): Promise<LoggedSet> {
  const ex = plan.exercises[exIdx];
  const set = ex.sets[setIdx];

  let inSheet = false;
  let repsInSheet = false;
  try {
    const written = await writeSetToSheet({ plan, set, ...entry });
    inSheet = written.weight;
    repsInSheet = written.reps;
  } catch (error) {
    console.error("PH3 sheet write failed; falling back to Workouts tab:", error);
  }

  const logged: LoggedSet = {
    exercise: ex.exercise,
    setNumber: set.setNumber,
    ...entry,
    inSheet,
    ...(repsInSheet ? { repsInSheet, originalReps: set.reps } : {}),
  };
  state.skipped = (state.skipped ?? []).filter(
    (k) => !(k.exercise === ex.exercise && k.setNumber === set.setNumber)
  );
  state.logged = state.logged.filter(
    (l) => !(l.exercise === ex.exercise && l.setNumber === set.setNumber)
  );
  state.logged.push(logged);
  return logged;
}

/** Rewrites an already-logged set in place (sheet cell too, if this session wrote it). */
export async function editLoggedSet(
  state: WorkoutSessionState,
  plan: PH3DayPlan,
  exIdx: number,
  setIdx: number,
  entry: { weightKg: number; reps: number }
): Promise<boolean> {
  const ex = plan.exercises[exIdx];
  const set = ex.sets[setIdx];
  const logged = state.logged.find(
    (l) => l.exercise === ex.exercise && l.setNumber === set.setNumber
  );
  if (!logged) return false;
  if (logged.inSheet || logged.repsInSheet) {
    await overwriteSetCell({
      plan,
      set,
      ...entry,
      writeWeight: logged.inSheet,
      writeReps: !!logged.repsInSheet,
    });
  }
  logged.weightKg = entry.weightKg;
  logged.reps = entry.reps;
  return true;
}

/** Removes a logged set, emptying its sheet cell if this session wrote it. */
export async function removeLoggedSet(
  state: WorkoutSessionState,
  plan: PH3DayPlan,
  exIdx: number,
  setIdx: number
): Promise<boolean> {
  const ex = plan.exercises[exIdx];
  const set = ex.sets[setIdx];
  const idx = state.logged.findIndex(
    (l) => l.exercise === ex.exercise && l.setNumber === set.setNumber
  );
  if (idx === -1) return false;
  const entry = state.logged[idx];
  if (entry.inSheet || entry.repsInSheet) {
    await clearSetCell({
      plan,
      set,
      clearWeight: entry.inSheet,
      restoreReps: entry.repsInSheet ? entry.originalReps ?? "" : undefined,
    });
  }
  state.logged.splice(idx, 1);
  return true;
}

async function handleLoggedSet(
  chatId: number,
  state: WorkoutSessionState,
  entry: { weightKg: number; reps: number }
): Promise<void> {
  const plan = await getDayPlan(state.day);
  const exercise = plan.exercises[state.exIdx];
  const targetReps = exercise?.sets[state.setIdx]?.reps ?? "";
  const isLastSet = state.setIdx === (exercise?.sets.length ?? 0) - 1;
  const logged = await recordSet(state, plan, state.exIdx, state.setIdx, entry);
  const coach = coachLine({
    exercise: logged.exercise,
    targetReps,
    weightKg: entry.weightKg,
    reps: entry.reps,
    isLastSet,
  });
  await advanceOrFinish(
    chatId,
    state,
    plan,
    `✅ ${logged.exercise}: ${formatLogged(logged)}${coach ? `\n💬 ${coach}` : ""}`,
    (await getAutoRestSeconds(logged.exercise).catch(() => null)) ?? undefined
  );
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
    // Not a plain "weight x reps": let the agent interpret it (fix, delete, skip, reorder...).
    try {
      const { runWorkoutAgent } = await import("../agent/workout-agent");
      const agentResult = await runWorkoutAgent({ chatId, text: trimmed });
      // Unrelated to the workout (e.g. "what's the weather"): hand back to the normal assistant.
      if (!agentResult.handled) return false;
      return true;
    } catch (error) {
      console.error("Workout agent failed; falling back to the set prompt:", error);
    }

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

/** A plain "weight x reps" message while a session is active; null otherwise. */
export function strictSetEntry(
  text: string,
  state: WorkoutSessionState | null
): { weightKg: number; reps: number } | null {
  return state ? parseSetInput(text.trim()) : null;
}

/**
 * Records a plain "weight x reps" message straight into the active session, skipping
 * the orchestrator (the most frequent message in a workout). Returns true if consumed.
 */
export async function handleStrictSetShortcut(params: {
  chatId: number;
  text: string;
}): Promise<boolean> {
  // Cheap check first: most messages are not sets, so don't load the session for them.
  if (!parseSetInput(params.text.trim())) return false;
  const state = await loadSession();
  const entry = strictSetEntry(params.text, state);
  if (!state || !entry) return false;
  await handleLoggedSet(params.chatId, state, entry);
  return true;
}
