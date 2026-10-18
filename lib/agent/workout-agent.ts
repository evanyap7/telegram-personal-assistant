import { recordModelUsage, withModelFallback } from "@/lib/ai/router";
import { ToolLoopAgent, tool, isStepCount } from "ai";
import { z } from "zod";
import { sendTelegramMessage } from "@/lib/telegram";
import { SECURITY_SYSTEM_GUARDRAIL } from "@/lib/security";
import { toConversationMessages } from "@/lib/agent/conversation-messages";
import { getRecentChatHistory } from "@/lib/chat-history";
import { spokenInputNote, type InputMode } from "@/lib/agent/input-mode";
import { resolveAgentReply } from "@/lib/agent/agent-reply";
import { clearPH3Session, getDayPlan, type PH3DayPlan } from "@/lib/workout/ph3-program";
import {
  buildSetPrompt,
  describeTarget,
  editLoggedSet,
  endSession,
  findNextPending,
  finishSession,
  flushFallbackSets,
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
  return `You are the workout agent inside EGO, a personal Telegram assistant. The user is in the middle of a guided lifting session following a fixed program (PH3). You keep the session log correct by calling tools, and you understand natural language about it: logging, fixing, deleting, skipping, reordering.

Session state when the message arrived:
${JSON.stringify(snapshot(plan, state))}

${spoken ? `${spoken}\n\n` : ""}How to work:
- The program is the default plan, but the user's words override it. They can skip sets or exercises, do exercises in a different order, redo a set, or add an extra set.
- Weights are in kg. "bw" means bodyweight (weightKg 0).
- "Skip" means they won't do it. "Delete" or "remove" on a set that is already logged means erase the entry: if they also say they'll redo it, use redo: true, otherwise it is skipped. "Delete" on a set not yet done means skip it.
- Exercises can be referred to by number ("exercise 2") or name ("bench"). Sets are referred to by setNumber.
- "That" or "the last one" means the most recently logged set, or the cursor set if nothing is logged yet.
- If a request is ambiguous (e.g. two exercises both match), ask one short question instead of guessing.
- Only report what the tools returned. If a tool returns an error, say so plainly.
- The next-set prompt is appended to your reply automatically, so don't repeat it. Reply in one or two plain sentences, no Markdown.
- If the message has nothing to do with this workout, reply with exactly: ${NOT_WORKOUT}

About the program:
- This PH3 sheet has been deliberately trimmed from Layne Norton's original. Arm and calf sets are capped, BFR add-ons on arms and calves are removed, and the optional Ukrainian Stallion is gone, because extra accessory volume beyond roughly 10-20 weekly sets per muscle (indirect work counts) adds fatigue without better strength or size. The squat, bench and deadlift prescriptions are untouched. If the user asks where an exercise went, say that in one sentence. addExtraSet still works if they insist, but don't push them to add volume.
- Coaching, only when asked or clearly relevant, in one sentence: rest 3-5 minutes on squat/bench/deadlift and 1.5-2 minutes on accessories. AMRAP sets stop one rep short of form breakdown, never a grind to failure, especially on deadlift. Accessories stop at the RIR in their name. When the top of an accessory's rep range is hit at the listed RIR, add the smallest load increment next time; if reps fall two or more below the range on two sessions in a row, hold the load or drop it about 5%.

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
  const plan = await getDayPlan(state.day);

  let mutated = false;
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

    switchDay: tool({
      description:
        "Abandon the current day (saving what was logged) and start a different program day (1-90). Sends the new day's start message itself.",
      inputSchema: z.object({ day: z.number().int().min(1).max(90) }),
      execute: async ({ day }) => {
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
  await sendTelegramMessage(chatId, `${reply}\n\n${prompt}`, undefined, null);
  return { handled: true };
}
