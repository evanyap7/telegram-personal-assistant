import { recordModelUsage, withModelFallback } from "@/lib/ai/router";
import { ToolLoopAgent, tool, isStepCount } from "ai";
import { z } from "zod";
import { sendTelegramMessage } from "@/lib/telegram";
import { formatRestDuration } from "@/lib/workout/rest-command";
import { getAutoRestSeconds, startRestTimer } from "@/lib/workout/rest-timer-store";
import { SECURITY_SYSTEM_GUARDRAIL } from "@/lib/security";
import { toConversationMessages } from "@/lib/agent/conversation-messages";
import { getRecentChatHistory } from "@/lib/chat-history";
import { spokenInputNote, type InputMode } from "@/lib/agent/input-mode";
import { resolveAgentReply } from "@/lib/agent/agent-reply";
import {
  clearPH3Session,
  programDayFromWeekDay,
  setUserPH3Day,
  writeExerciseName,
  type PH3DayPlan,
} from "@/lib/workout/ph3-program";
import {
  describeEdit,
  removeSwap,
  sameName,
  upsertSwap,
  weekdayOf,
  type EditScope,
  type PlanEdit,
} from "@/lib/workout/plan-edits";
import { loadPlanEdits, savePlanEdits } from "@/lib/workout/plan-edits-store";
import {
  buildSetPrompt,
  describeTarget,
  editLoggedSet,
  endSession,
  findNextPending,
  finishSession,
  flushFallbackSets,
  getSessionPlan,
  getSetStatus,
  loadSession,
  markSkipped,
  recordSet,
  removeLoggedSet,
  saveSession,
  startPH3Workout,
  type WorkoutSessionState,
} from "@/lib/workout/workout-session";

const NOT_WORKOUT = "NOT_WORKOUT";

const dayTargetSchema = z.object({
  day: z.number().int().min(1).max(90).optional().describe("Program day 1-90"),
  week: z.number().int().min(1).max(13).optional().describe("Program week 1-13, used with dayOfWeek"),
  dayOfWeek: z.number().int().min(1).max(7).optional().describe("Day within the week, 1-7"),
});

/** A program day from either a plain day number or a week + day-of-week pair; null if neither is valid. */
function resolveDayTarget(t: { day?: number; week?: number; dayOfWeek?: number }): number | null {
  if (t.day !== undefined) return t.day;
  if (t.week !== undefined && t.dayOfWeek !== undefined) return programDayFromWeekDay(t.week, t.dayOfWeek);
  return null;
}

function formatEntry(weightKg: number, reps: number): string {
  return `${weightKg > 0 ? `${weightKg}kg` : "BW"} × ${reps}`;
}

function snapshot(plan: PH3DayPlan, state: WorkoutSessionState) {
  return {
    day: plan.day,
    week: plan.week,
    title: plan.dayTitle,
    cursor: {
      exerciseNumber: state.exIdx + 1,
      exercise: plan.exercises[state.exIdx]?.exercise,
      setNumber: plan.exercises[state.exIdx]?.sets[state.setIdx]?.setNumber,
    },
    exercises: plan.exercises.map((ex, i) => ({
      exerciseNumber: i + 1,
      name: ex.exercise,
      sets: ex.sets.map((set) => {
        const status = getSetStatus(state, ex.exercise, set.setNumber);
        const logged = state.logged.find(
          (l) => l.exercise === ex.exercise && l.setNumber === set.setNumber
        );
        return {
          setNumber: set.setNumber,
          target: describeTarget(set),
          status,
          ...(logged ? { logged: formatEntry(logged.weightKg, logged.reps) } : {}),
        };
      }),
    })),
  };
}

function resolveExercise(
  plan: PH3DayPlan,
  ref: string | undefined,
  fallbackIdx: number
): { exIdx: number } | { error: string } {
  if (ref === undefined || ref.trim() === "") return { exIdx: fallbackIdx };
  const trimmed = ref.trim().toLowerCase();
  if (/^\d+$/.test(trimmed)) {
    const exIdx = parseInt(trimmed, 10) - 1;
    return plan.exercises[exIdx]
      ? { exIdx }
      : { error: `No exercise number ${trimmed}. There are ${plan.exercises.length}.` };
  }
  const names = plan.exercises.map((e) => e.exercise.toLowerCase());
  const exact = names.indexOf(trimmed);
  if (exact !== -1) return { exIdx: exact };
  const matches = names.flatMap((n, i) => (n.includes(trimmed) ? [i] : []));
  if (matches.length === 1) return { exIdx: matches[0] };
  return {
    error:
      matches.length === 0
        ? `No exercise matches "${ref}". Exercises: ${plan.exercises
            .map((e, i) => `${i + 1}. ${e.exercise}`)
            .join("; ")}`
        : `"${ref}" matches several exercises: ${matches
            .map((i) => plan.exercises[i].exercise)
            .join("; ")}`,
  };
}

function resolveSet(
  plan: PH3DayPlan,
  exIdx: number,
  setNumber: number | undefined,
  fallbackSetIdx: number
): { setIdx: number } | { error: string } {
  if (setNumber === undefined) return { setIdx: fallbackSetIdx };
  const setIdx = plan.exercises[exIdx].sets.findIndex((s) => s.setNumber === setNumber);
  return setIdx === -1
    ? { error: `${plan.exercises[exIdx].exercise} has no set ${setNumber}.` }
    : { setIdx };
}

export function buildWorkoutInstructions(
  plan: PH3DayPlan,
  state: WorkoutSessionState,
  inputMode?: InputMode
): string {
  const spoken = spokenInputNote(inputMode);
  return `You are the workout agent inside EGO, a personal Telegram assistant. The user is in the middle of a guided lifting session following a fixed program (PH3). You keep the session log correct by calling tools, and you understand natural language about it: logging, fixing, deleting, skipping, reordering, and changing the exercises themselves.

Session state when the message arrived:
${JSON.stringify(snapshot(plan, state))}

${spoken ? `${spoken}\n\n` : ""}How to work:
- The program is the default plan, but the user's words override it. They can skip sets or exercises, do exercises in a different order, redo a set, or add an extra set.
- Weights are in kg. "bw" means bodyweight (weightKg 0).
- "Skip" means they won't do it. "Delete" or "remove" on a set that is already logged means erase the entry: if they also say they'll redo it, use redo: true, otherwise it is skipped. "Delete" on a set not yet done means skip it.
- Exercises can be referred to by number ("exercise 2") or name ("bench"). Sets are referred to by setNumber.
- "That" or "the last one" means the most recently logged set, or the cursor set if nothing is logged yet.
- Program days run 1-90: day = (week - 1) x 7 + day of the week, so "week 3 day 2" is day 16, and week 13 is days 85-90. For a week and day, pass week and dayOfWeek to switchDay or setProgramPosition instead of doing the sum yourself.
- Moving around the program: "start over", "restart the program" or "from the beginning" mean day 1. If they want to train now, use switchDay; if they say they will train later or tomorrow, or just want to change where they are, use setProgramPosition, which doesn't start a session. "Start over" about a single set or exercise only redoes that set (deleteLoggedSet with redo true).
- You are also the user's powerlifting coach. Be direct and demanding about effort, standards and honest logging, with no cheerleading fluff and no lecturing. If they log a weak or short set, say so plainly and tell them what to fix on the next one. If they beat the target by 2 or more reps, tell them it was too light and to update their max. Never push them through pain, dizziness or a rep with broken form, and never tell them to add load or volume beyond what the sheet prescribes. If they report pain or an injury, tell them to stop that movement and see a professional.
- Be forgiving with wording, typos and mixed requests ("skip curls and do calves", "I only have time for the main lifts", "redo my last set at 100"). Do everything they asked with the tools, in one go, rather than asking them to rephrase. Only ask a question when a choice would change what gets logged.
- Changing the plan: you can swap an exercise for another (swapExercise), undo a swap (revertSwap), add or remove exercises, change sets, reps or target weight (setTargets), and list what has been changed (listPlanEdits). "Change the exercise to preacher curls" means swapExercise on the current exercise. Scope: change only today unless they say otherwise ("from now on", "every week", "permanently" -> from_now_on; "on this day each week" -> this_weekday). Never claim a change is saved for later unless the tool result shows that scope.
- A swapped-in exercise has no history here, so ask what weight they'll use (or offer the old exercise's logged weight as a reference). If the swap result says sheetNameUpdated is false, tell them the sheet name could not be updated but the session was.
- If they can't do an exercise ("machine's taken", "no equipment", "shoulder hurts"), suggest two or three like-for-like alternatives for the same muscle and wait for their pick before changing anything. Pain or injury still means stop that movement and see a professional.
- If a request is ambiguous (e.g. two exercises both match), ask one short question instead of guessing.
- Only report what the tools returned. If a tool returns an error, say so plainly.
- The next-set prompt is appended to your reply automatically, so don't repeat it. Reply in one or two plain sentences, no Markdown.
- If the message has nothing to do with this workout, reply with exactly: ${NOT_WORKOUT}

About the program:
- This PH3 sheet is customised from Layne Norton's original. Arms are a priority: they are trained in most sessions, about 14-16 direct sets a week each for biceps and triceps, placed after the main lifts at 1-2 reps in reserve. All blood-flow-restriction (BFR) work has been removed and replaced with conventional sets, and Day 6 was trimmed to the squat plus leg extension, seated leg curl, calves and a focused arm block, because extra accessory volume beyond roughly 10-20 weekly sets per muscle (indirect work counts) adds fatigue without better results on a powerlifting programme. Frequency itself doesn't change growth when weekly sets are equal; it just keeps each session's arm fatigue low. The squat, bench and deadlift prescriptions are untouched, and the week-4 rep test has no arm work. If the user asks where an exercise went, say that in one sentence. addExtraSet still works if they insist, but don't push them to add volume.
- Coaching, only when asked or clearly relevant, in one sentence: rest 3-5 minutes on squat/bench/deadlift and 1-2 minutes on accessories. A rest timer starts automatically when a set is logged and pings the user when it ends; /rest changes the durations or switches it off. AMRAP sets stop one rep short of form breakdown, never a grind to failure, especially on deadlift. Accessories stop at the RIR in their name. When the top of an accessory's rep range is hit at the listed RIR, add the smallest load increment next time; if reps fall two or more below the range on two sessions in a row, hold the load or drop it about 5%.

${SECURITY_SYSTEM_GUARDRAIL}`;
}

export type WorkoutAgentResult = { handled: false } | { handled: true };

export async function runWorkoutAgent(params: {
  chatId: number;
  text: string;
  inputMode?: InputMode;
}): Promise<WorkoutAgentResult> {
  const { chatId, text, inputMode } = params;
  const state = await loadSession();
  if (!state) return { handled: false };
  let plan = await getSessionPlan(state);

  let mutated = false;
  /** Exercise of the set most recently logged through logSet; its rest timer starts with the reply. */
  let restAfter: string | null = null;
  /** A tool already sent its own message (summary, new-day prompt); don't add a second reply. */
  let handedOff = false;
  let allDone = false;

  /** Keeps the cursor on a pending set; flags completion when none are left. */
  const settleCursor = () => {
    const currentEx = plan.exercises[state.exIdx];
    const current = currentEx?.sets[state.setIdx];
    if (current && getSetStatus(state, currentEx.exercise, current.setNumber) === "pending") {
      return;
    }
    const next = findNextPending(plan, state, state.exIdx, state.setIdx);
    if (next) {
      state.exIdx = next.exIdx;
      state.setIdx = next.setIdx;
      allDone = false;
    } else {
      allDone = true;
    }
  };

  const commit = async () => {
    settleCursor();
    mutated = true;
    await saveSession(state);
    return snapshot(plan, state);
  };

  const exerciseArg = z
    .string()
    .optional()
    .describe("Exercise number (1-based) or name; defaults to the current exercise");

  const scopeArg = z
    .enum(["today", "from_now_on", "this_weekday"])
    .default("today")
    .describe(
      "today = this session only (default); from_now_on = every future day with this exercise; this_weekday = only this weekday slot in future weeks"
    );

  /** Rebuilds the plan after an edit and keeps the cursor on the same exercise and set. */
  const reloadPlan = async (renamedTo?: string) => {
    const prev = plan.exercises[state.exIdx];
    const prevSetNumber = prev?.sets[state.setIdx]?.setNumber;
    const prevName = renamedTo ?? prev?.exercise;
    plan = await getSessionPlan(state);
    const idx = prevName ? plan.exercises.findIndex((e) => sameName(e.exercise, prevName)) : -1;
    if (idx === -1) {
      state.exIdx = Math.min(state.exIdx, Math.max(plan.exercises.length - 1, 0));
      state.setIdx = 0;
      return;
    }
    const setIdx = plan.exercises[idx].sets.findIndex((s) => s.setNumber === prevSetNumber);
    state.exIdx = idx;
    state.setIdx = setIdx === -1 ? 0 : setIdx;
  };

  /**
   * Records an edit on the session (so it holds even if another instance has a stale plan
   * cache) and, for a wider scope, in the persistent list read by every future session.
   */
  const recordEdit = async (edit: PlanEdit, scope: EditScope) => {
    state.edits = [...(state.edits ?? []), edit];
    if (scope === "today") return;
    const stored: PlanEdit = {
      ...edit,
      at: new Date().toISOString(),
      ...(scope === "this_weekday" || edit.kind === "add" ? { weekday: weekdayOf(state.day) } : {}),
    };
    await savePlanEdits([...(await loadPlanEdits()), stored]);
  };

  /** The name an exercise had in the program sheet, following this session's swaps back. */
  const baseName = (current: string): string => {
    let name = current;
    const edits = state.edits ?? [];
    for (let i = edits.length - 1; i >= 0; i--) {
      const e = edits[i];
      if (e.kind === "swap" && sameName(e.to, name)) name = e.from;
    }
    return name;
  };

  const renameLogged = (from: string, to: string) => {
    for (const l of state.logged) if (sameName(l.exercise, from)) l.exercise = to;
    for (const k of state.skipped ?? []) if (sameName(k.exercise, from)) k.exercise = to;
  };

  const writeName = async (nameCell: string | undefined, name: string): Promise<boolean> => {
    if (!nameCell) return false;
    try {
      await writeExerciseName(plan, nameCell, name);
      return true;
    } catch (error) {
      console.error("Writing the exercise name to the sheet failed:", error);
      return false;
    }
  };

  const tools = {
    getSession: tool({
      description:
        "Current workout state: every exercise and set with target, status and logged values.",
      inputSchema: z.object({}),
      execute: async () => snapshot(plan, state),
    }),

    logSet: tool({
      description:
        "Log weight and reps for a set. Defaults to the current set. If that set already has an entry, it is replaced.",
      inputSchema: z.object({
        exercise: exerciseArg,
        setNumber: z.number().int().positive().optional(),
        weightKg: z.number().min(0).max(1000),
        reps: z.number().int().min(1).max(100),
      }),
      execute: async ({ exercise, setNumber, weightKg, reps }) => {
        const ex = resolveExercise(plan, exercise, state.exIdx);
        if ("error" in ex) return { ok: false, error: ex.error };
        const set = resolveSet(
          plan,
          ex.exIdx,
          setNumber,
          ex.exIdx === state.exIdx ? state.setIdx : 0
        );
        if ("error" in set) return { ok: false, error: set.error };
        const logged = await recordSet(state, plan, ex.exIdx, set.setIdx, { weightKg, reps });
        restAfter = logged.exercise;
        return {
          ok: true,
          logged: `${logged.exercise} set ${logged.setNumber}: ${formatEntry(weightKg, reps)}`,
          state: await commit(),
        };
      },
    }),

    editLoggedSet: tool({
      description: "Change the weight and/or reps of a set that was already logged.",
      inputSchema: z.object({
        exercise: exerciseArg,
        setNumber: z.number().int().positive(),
        weightKg: z.number().min(0).max(1000).optional(),
        reps: z.number().int().min(1).max(100).optional(),
      }),
      execute: async ({ exercise, setNumber, weightKg, reps }) => {
        const ex = resolveExercise(plan, exercise, state.exIdx);
        if ("error" in ex) return { ok: false, error: ex.error };
        const set = resolveSet(plan, ex.exIdx, setNumber, 0);
        if ("error" in set) return { ok: false, error: set.error };
        const name = plan.exercises[ex.exIdx].exercise;
        const current = state.logged.find(
          (l) => l.exercise === name && l.setNumber === setNumber
        );
        if (!current) {
          return { ok: false, error: `Set ${setNumber} of ${name} hasn't been logged yet.` };
        }
        const before = formatEntry(current.weightKg, current.reps);
        const next = { weightKg: weightKg ?? current.weightKg, reps: reps ?? current.reps };
        await editLoggedSet(state, plan, ex.exIdx, set.setIdx, next);
        return {
          ok: true,
          before,
          after: formatEntry(next.weightKg, next.reps),
          state: await commit(),
        };
      },
    }),

    deleteLoggedSet: tool({
      description:
        "Erase a logged set (also clears its cell in the sheet). With redo true the set goes back to pending and the cursor moves to it; otherwise it is marked skipped.",
      inputSchema: z.object({
        exercise: exerciseArg,
        setNumber: z.number().int().positive(),
        redo: z.boolean().default(false),
      }),
      execute: async ({ exercise, setNumber, redo }) => {
        const ex = resolveExercise(plan, exercise, state.exIdx);
        if ("error" in ex) return { ok: false, error: ex.error };
        const set = resolveSet(plan, ex.exIdx, setNumber, 0);
        if ("error" in set) return { ok: false, error: set.error };
        const name = plan.exercises[ex.exIdx].exercise;
        const removed = await removeLoggedSet(state, plan, ex.exIdx, set.setIdx);
        if (!removed) {
          return { ok: false, error: `Set ${setNumber} of ${name} hasn't been logged.` };
        }
        if (redo) {
          state.exIdx = ex.exIdx;
          state.setIdx = set.setIdx;
        } else {
          markSkipped(state, name, setNumber);
        }
        return { ok: true, deleted: `${name} set ${setNumber}`, state: await commit() };
      },
    }),

    skipSets: tool({
      description:
        "Skip sets so they won't be asked for. Give setNumbers to skip specific sets; omit them to skip the current set, or all remaining sets of the named exercise.",
      inputSchema: z.object({
        exercise: exerciseArg,
        setNumbers: z.array(z.number().int().positive()).optional(),
        allRemainingSetsOfExercise: z.boolean().default(false),
      }),
      execute: async ({ exercise, setNumbers, allRemainingSetsOfExercise }) => {
        const ex = resolveExercise(plan, exercise, state.exIdx);
        if ("error" in ex) return { ok: false, error: ex.error };
        const target = plan.exercises[ex.exIdx];

        let numbers: number[];
        if (setNumbers && setNumbers.length > 0) {
          numbers = setNumbers;
        } else if (allRemainingSetsOfExercise || (exercise && ex.exIdx !== state.exIdx)) {
          numbers = target.sets.map((s) => s.setNumber);
        } else {
          numbers = [target.sets[state.setIdx].setNumber];
        }

        const skipped: number[] = [];
        for (const n of numbers) {
          if (!target.sets.some((s) => s.setNumber === n)) continue;
          if (getSetStatus(state, target.exercise, n) === "pending") {
            markSkipped(state, target.exercise, n);
            skipped.push(n);
          }
        }
        if (skipped.length === 0) {
          return { ok: false, error: "Nothing to skip: those sets are already logged or skipped." };
        }
        return {
          ok: true,
          skipped: `${target.exercise} sets ${skipped.join(", ")}`,
          state: await commit(),
        };
      },
    }),

    goTo: tool({
      description:
        "Jump to a specific exercise (and optionally set), e.g. to do exercises in a different order or return to a skipped one. A skipped set becomes pending again.",
      inputSchema: z.object({
        exercise: z.string().describe("Exercise number (1-based) or name"),
        setNumber: z.number().int().positive().optional(),
      }),
      execute: async ({ exercise, setNumber }) => {
        const ex = resolveExercise(plan, exercise, state.exIdx);
        if ("error" in ex) return { ok: false, error: ex.error };
        const target = plan.exercises[ex.exIdx];

        let setIdx: number;
        if (setNumber !== undefined) {
          const set = resolveSet(plan, ex.exIdx, setNumber, 0);
          if ("error" in set) return { ok: false, error: set.error };
          setIdx = set.setIdx;
        } else {
          setIdx = target.sets.findIndex(
            (s) => getSetStatus(state, target.exercise, s.setNumber) !== "logged"
          );
          if (setIdx === -1) {
            return { ok: false, error: `Every set of ${target.exercise} is already logged.` };
          }
        }
        const chosen = target.sets[setIdx];
        if (getSetStatus(state, target.exercise, chosen.setNumber) === "logged") {
          return { ok: false, error: "That set is already logged. Use editLoggedSet to change it." };
        }
        state.skipped = (state.skipped ?? []).filter(
          (k) => !(k.exercise === target.exercise && k.setNumber === chosen.setNumber)
        );
        state.exIdx = ex.exIdx;
        state.setIdx = setIdx;
        return { ok: true, state: await commit() };
      },
    }),

    addExtraSet: tool({
      description:
        "Log an additional set beyond the programmed ones (e.g. a bonus or drop set). It is saved to the Workouts tab.",
      inputSchema: z.object({
        exercise: exerciseArg,
        weightKg: z.number().min(0).max(1000),
        reps: z.number().int().min(1).max(100),
      }),
      execute: async ({ exercise, weightKg, reps }) => {
        const ex = resolveExercise(plan, exercise, state.exIdx);
        if ("error" in ex) return { ok: false, error: ex.error };
        const target = plan.exercises[ex.exIdx];
        const existing = [
          ...state.logged.filter((l) => l.exercise === target.exercise).map((l) => l.setNumber),
          ...target.sets.map((s) => s.setNumber),
        ];
        const setNumber = Math.max(...existing) + 1;
        state.logged.push({
          exercise: target.exercise,
          setNumber,
          weightKg,
          reps,
          inSheet: false,
        });
        return {
          ok: true,
          added: `${target.exercise} extra set: ${formatEntry(weightKg, reps)}`,
          state: await commit(),
        };
      },
    }),

    swapExercise: tool({
      description:
        "Replace an exercise with a different one (e.g. incline curls -> preacher curls). Keeps the prescribed sets and reps unless you pass new ones. Sets already logged under the old name are renamed. The new name is also written into today's sheet row. Scope defaults to today.",
      inputSchema: z.object({
        exercise: exerciseArg,
        newName: z.string().min(2).max(80).describe("Proper-cased name, e.g. \"Preacher Curl\""),
        scope: scopeArg,
        sets: z.number().int().min(1).max(10).optional(),
        reps: z.string().max(20).optional().describe("Rep range, e.g. \"8-12\""),
        weightKg: z.number().min(0).max(1000).optional().describe("Starting weight for the new exercise"),
      }),
      execute: async ({ exercise, newName, scope, sets, reps, weightKg }) => {
        const ex = resolveExercise(plan, exercise, state.exIdx);
        if ("error" in ex) return { ok: false, error: ex.error };
        const old = plan.exercises[ex.exIdx];
        const name = newName.trim();
        if (sameName(old.exercise, name)) return { ok: false, error: `That already is ${old.exercise}.` };
        if (plan.exercises.some((e) => sameName(e.exercise, name))) {
          return { ok: false, error: `${name} is already in today's workout.` };
        }
        const previous = {
          exercise: old.exercise,
          prescribed: old.sets.map((s) => describeTarget(s)),
          loggedToday: state.logged
            .filter((l) => sameName(l.exercise, old.exercise))
            .map((l) => formatEntry(l.weightKg, l.reps)),
        };

        const swap: PlanEdit = { kind: "swap", from: old.exercise, to: name };
        state.edits = [...(state.edits ?? []), swap];
        if (scope !== "today") {
          const stored = await loadPlanEdits();
          const chained = stored.some((e) => e.kind === "swap" && sameName(e.to, old.exercise));
          await savePlanEdits(
            upsertSwap(stored, chained ? old.exercise : baseName(old.exercise), name, scope === "this_weekday" ? weekdayOf(state.day) : undefined)
          );
        }
        if (sets !== undefined || reps !== undefined || weightKg !== undefined) {
          await recordEdit(
            {
              kind: "targets",
              exercise: name,
              ...(sets !== undefined ? { sets } : {}),
              ...(reps !== undefined ? { reps } : {}),
              ...(weightKg !== undefined ? { weight: String(weightKg) } : {}),
            },
            scope
          );
        }
        renameLogged(old.exercise, name);
        const sheetUpdated = await writeName(old.nameCell, name);
        await reloadPlan(name);
        return {
          ok: true,
          swapped: `${previous.exercise} -> ${name}`,
          scope,
          sheetNameUpdated: sheetUpdated,
          replaced: previous,
          note:
            weightKg === undefined
              ? "The new exercise has no weight history. Ask what weight they will use, or offer the old exercise's logged weight as a reference."
              : undefined,
          state: await commit(),
        };
      },
    }),

    revertSwap: tool({
      description:
        "Undo a swap and put the original program exercise back (today and, if it was saved, for future sessions).",
      inputSchema: z.object({ exercise: exerciseArg }),
      execute: async ({ exercise }) => {
        const ex = resolveExercise(plan, exercise, state.exIdx);
        if ("error" in ex) return { ok: false, error: ex.error };
        const current = plan.exercises[ex.exIdx];
        const stored = await loadPlanEdits();
        const removed = removeSwap(stored, current.exercise);
        const original = removed.original ?? (sameName(baseName(current.exercise), current.exercise) ? null : baseName(current.exercise));
        if (!original) return { ok: false, error: `${current.exercise} isn't a swap.` };
        if (removed.original) await savePlanEdits(removed.edits);
        state.edits = [...(state.edits ?? []), { kind: "swap", from: current.exercise, to: original }];
        renameLogged(current.exercise, original);
        const sheetUpdated = await writeName(current.nameCell, original);
        await reloadPlan(original);
        return {
          ok: true,
          reverted: `${current.exercise} -> ${original}`,
          sheetNameUpdated: sheetUpdated,
          state: await commit(),
        };
      },
    }),

    listPlanEdits: tool({
      description: "List the plan changes in force: saved ones (swaps, additions, removals, retargets) and ones made in this session.",
      inputSchema: z.object({}),
      execute: async () => ({
        saved: (await loadPlanEdits()).map((e) => ({ change: describeEdit(e), since: e.at })),
        thisSession: (state.edits ?? []).map((e) => describeEdit(e)),
      }),
    }),

    addExercise: tool({
      description:
        "Add an exercise that isn't in the program, with a set count and rep range. Its sets are saved to the Workouts tab (there is no sheet row). Saved scopes limit it to this weekday. Scope defaults to today.",
      inputSchema: z.object({
        name: z.string().min(2).max(80),
        sets: z.number().int().min(1).max(10),
        reps: z.string().max(20).describe("Rep range, e.g. \"8-12\""),
        weightKg: z.number().min(0).max(1000).optional(),
        position: z.number().int().min(1).optional().describe("1-based place in the workout; defaults to the end"),
        scope: scopeArg,
      }),
      execute: async ({ name, sets, reps, weightKg, position, scope }) => {
        const trimmed = name.trim();
        if (plan.exercises.some((e) => sameName(e.exercise, trimmed))) {
          return { ok: false, error: `${trimmed} is already in today's workout.` };
        }
        await recordEdit(
          {
            kind: "add",
            exercise: trimmed,
            sets,
            reps,
            ...(weightKg !== undefined ? { weight: String(weightKg) } : {}),
            ...(position !== undefined ? { position } : {}),
          },
          scope
        );
        await reloadPlan();
        return { ok: true, added: `${trimmed}: ${sets} sets of ${reps}`, scope, state: await commit() };
      },
    }),

    removeExercise: tool({
      description:
        "Take an exercise out of the workout (unlike skipSets, which only skips today). Refuses if it already has logged sets. Scope defaults to today.",
      inputSchema: z.object({ exercise: exerciseArg, scope: scopeArg }),
      execute: async ({ exercise, scope }) => {
        const ex = resolveExercise(plan, exercise, state.exIdx);
        if ("error" in ex) return { ok: false, error: ex.error };
        const target = plan.exercises[ex.exIdx];
        if (plan.exercises.length === 1) return { ok: false, error: "That is the only exercise left today." };
        if (state.logged.some((l) => sameName(l.exercise, target.exercise))) {
          return { ok: false, error: `${target.exercise} has logged sets. Delete them first, or skip the rest instead.` };
        }
        await recordEdit({ kind: "remove", exercise: target.exercise }, scope);
        await reloadPlan();
        return { ok: true, removed: target.exercise, scope, state: await commit() };
      },
    }),

    setTargets: tool({
      description:
        "Change the prescription for an exercise: number of sets, rep range and/or target weight (e.g. \"make curls 4 sets\", \"start preacher at 20kg\"). Scope defaults to today.",
      inputSchema: z.object({
        exercise: exerciseArg,
        sets: z.number().int().min(1).max(10).optional(),
        reps: z.string().max(20).optional().describe("Rep range, e.g. \"8-12\""),
        weightKg: z.number().min(0).max(1000).optional(),
        scope: scopeArg,
      }),
      execute: async ({ exercise, sets, reps, weightKg, scope }) => {
        if (sets === undefined && reps === undefined && weightKg === undefined) {
          return { ok: false, error: "Give sets, reps or weightKg to change." };
        }
        const ex = resolveExercise(plan, exercise, state.exIdx);
        if ("error" in ex) return { ok: false, error: ex.error };
        const target = plan.exercises[ex.exIdx];
        const highestLogged = Math.max(
          0,
          ...state.logged.filter((l) => sameName(l.exercise, target.exercise)).map((l) => l.setNumber)
        );
        if (sets !== undefined && sets < highestLogged) {
          return { ok: false, error: `Set ${highestLogged} of ${target.exercise} is already logged, so it can't go below ${highestLogged} sets.` };
        }
        await recordEdit(
          {
            kind: "targets",
            exercise: target.exercise,
            ...(sets !== undefined ? { sets } : {}),
            ...(reps !== undefined ? { reps } : {}),
            ...(weightKg !== undefined ? { weight: String(weightKg) } : {}),
          },
          scope
        );
        await reloadPlan();
        return { ok: true, changed: target.exercise, scope, state: await commit() };
      },
    }),

    switchDay: tool({
      description:
        "Abandon the current day (saving what was logged) and start a different program day. Give either day (1-90) or week (1-13) with dayOfWeek (1-7). Sends the new day's start message itself.",
      inputSchema: dayTargetSchema,
      execute: async (target) => {
        const day = resolveDayTarget(target);
        if (day === null) return { ok: false, error: "That isn't a program day. Give day 1-90, or week 1-13 with day 1-7." };
        await flushFallbackSets(state);
        await clearPH3Session();
        const saved =
          state.logged.length > 0
            ? `Saved ${state.logged.length} set${state.logged.length === 1 ? "" : "s"} from Day ${state.day}.\n\n`
            : "";
        await startPH3Workout({
          chatId,
          day,
          headerNotice: `${saved}Switching to Day ${day}!`,
          forceNew: true,
        });
        handedOff = true;
        mutated = true;
        return { ok: true, switchedTo: day };
      },
    }),

    setProgramPosition: tool({
      description:
        "End the session (saving what was logged) and move the program position to another day WITHOUT starting it, e.g. \"I'll do week 1 day 1 tomorrow\" or \"put me back on day 12\". Sends its own confirmation.",
      inputSchema: dayTargetSchema,
      execute: async (target) => {
        const day = resolveDayTarget(target);
        if (day === null) return { ok: false, error: "That isn't a program day. Give day 1-90, or week 1-13 with day 1-7." };
        await flushFallbackSets(state);
        await clearPH3Session();
        const progress = await setUserPH3Day(day);
        const saved =
          state.logged.length > 0
            ? `Saved ${state.logged.length} set${state.logged.length === 1 ? "" : "s"} from Day ${state.day}. `
            : "";
        await sendTelegramMessage(
          chatId,
          `${saved}You're now on Week ${progress.currentWeek}, Day ${progress.currentDay}. Say "workout" when you're ready.`,
          undefined,
          null
        );
        handedOff = true;
        mutated = true;
        return { ok: true, positionedAt: day };
      },
    }),

    endWorkout: tool({
      description:
        "End the session early. Logged sets are saved and the user stays on the same program day. Sends the summary itself.",
      inputSchema: z.object({}),
      execute: async () => {
        await endSession(chatId, state);
        handedOff = true;
        mutated = true;
        return { ok: true };
      },
    }),

    finishWorkout: tool({
      description:
        "Mark the day complete even though some sets are pending (e.g. the user is done and wants the rest skipped) and advance to the next program day. Sends the summary itself.",
      inputSchema: z.object({}),
      execute: async () => {
        await finishSession(chatId, state);
        handedOff = true;
        mutated = true;
        return { ok: true };
      },
    }),
  };

  const instructions = buildWorkoutInstructions(plan, state, inputMode);

  let messages = toConversationMessages([], text);
  try {
    messages = toConversationMessages(await getRecentChatHistory(chatId, 6), text);
  } catch {
    // History is a nicety; the session state is what matters.
  }

  const { result } = await withModelFallback(
    "agent",
    async (handle) => {
      const agent = new ToolLoopAgent({
        model: handle.model,
        instructions,
        tools,
        stopWhen: isStepCount(8),
        providerOptions: handle.providerOptions,
        ...handle.sampling(0),
      });
      const generated = await agent.generate({
        messages,
      });
      await recordModelUsage(handle, generated.totalUsage);
      return generated;
    },
    { canRetry: () => !mutated }
  );
  if (handedOff) return { handled: true };
  const decision = resolveAgentReply({ reply: result.text, mutated, sentinel: NOT_WORKOUT });
  if (decision.kind === "decline") return { handled: false };
  const reply = decision.text;

  if (allDone) {
    await sendTelegramMessage(chatId, reply, undefined, null);
    await finishSession(chatId, state);
    return { handled: true };
  }

  const prompt = buildSetPrompt(plan, state.exIdx, state.setIdx).replace(/[*_`]/g, "");
  let restNote = "";
  if (restAfter) {
    // A failed timer write must not swallow the reply to a set that was already logged.
    try {
      const seconds = await getAutoRestSeconds(restAfter);
      if (seconds) {
        await startRestTimer(chatId, seconds, state);
        restNote = `⏱ Rest ${formatRestDuration(seconds)}. I'll ping you when it's time.\n\n`;
      }
    } catch (error) {
      console.error("Auto rest timer failed to start:", error);
    }
  }
  await sendTelegramMessage(chatId, `${reply}\n\n${restNote}${prompt}`, undefined, null);
  return { handled: true };
}
