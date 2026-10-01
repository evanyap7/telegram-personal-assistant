import { google } from "@ai-sdk/google";
import { generateText } from "ai";
import { z } from "zod";
import {
  buildWorkoutPlanForLocation,
  calculateEstimated1RM,
  calculateSessionVolume,
} from "./progressive-overload";
import {
  deleteWorkoutRows,
  getRecentWorkoutSetsByLocation,
  getWorkoutStatsSummary,
  logWorkoutSession,
} from "./workout-service";
import type { GymLocation, WorkoutSession, WorkoutSet } from "./workout-types";
import { sendTelegramMessage } from "../telegram";
import { buildUndoInlineKeyboard, registerUndoAction } from "../undo";

const workoutParserSchema = z.object({
  week: z.number().int().positive().optional(),
  location: z.enum(["school", "csc"]).optional(),
  routine: z.string().default("Upper Body"),
  sets: z.array(
    z.object({
      exercise: z.string(),
      setNumber: z.number().int().positive(),
      weightKg: z.number().nonnegative(),
      reps: z.number().positive(),
      isDropSet: z.boolean().default(false),
      isTempo: z.boolean().default(false),
      notes: z.string().optional(),
    })
  ),
});

/**
 * Deterministic + LLM parser for raw workout logs.
 * Handles user shorthands like:
 * "incline smith 100 x 5.5, 100 x 4, 80 x 7, 60 x 3"
 * "x 7" (carry over previous weight)
 * "10 es x 11" (each side)
 * "pull ups 15 9"
 */
export async function parseWorkoutText(
  text: string,
  inferredLocation?: GymLocation
): Promise<{
  week?: number;
  location: GymLocation;
  routine: string;
  sets: WorkoutSet[];
}> {
  // Infer location from text if mentioned
  const lower = text.toLowerCase();
  let location: GymLocation = inferredLocation || "school";
  if (lower.includes("csc") || lower.includes("civil service")) {
    location = "csc";
  } else if (lower.includes("school") || lower.includes("gym in school")) {
    location = "school";
  }

  // Detect week number
  const weekMatch = text.match(/week\s+(\d+)/i);
  const week = weekMatch ? parseInt(weekMatch[1], 10) : undefined;

  // Use Gemini Flash with structured prompt to reliably parse all exercise sets
  const model = google("gemini-2.5-flash");
  const prompt = [
    "You are an expert strength & conditioning data extraction assistant.",
    "Parse the following user workout log into a structured list of sets with exercise name, set number, weight in kg, and reps.",
    "",
    "Rules for interpretation:",
    "- Shorthand 'x 7' without weight means use the weight from the preceding set of that exercise.",
    "- Shorthands with commas like '80 x 7, 60 x 3' mean a drop set: the second part is isDropSet: true.",
    "- Bodyweight exercises like 'pull ups 15 9' mean set 1: 0kg x 15 reps, set 2: 0kg x 9 reps.",
    "- '10 es x 11' means 10kg each side (record weight as 10, note: 'each side').",
    "- 'tempo paused x 6' should set isTempo: true and notes: 'tempo paused'.",
    "- Output strictly JSON with no markdown wrapping.",
    "",
    `Text to parse:\n${text}`,
  ].join("\n");

  try {
    const { text: responseText } = await generateText({
      model,
      prompt,
      system:
        "Respond with a single raw JSON object matching: { week?: number, location?: 'school'|'csc', routine: string, sets: [{ exercise: string, setNumber: number, weightKg: number, reps: number, isDropSet: boolean, isTempo: boolean, notes?: string }] }",
    });

    const cleaned = responseText
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "");

    const parsed = workoutParserSchema.parse(JSON.parse(cleaned));
    return {
      week: week || parsed.week,
      location: parsed.location || location,
      routine: parsed.routine || "Upper Body",
      sets: parsed.sets,
    };
  } catch {
    // Deterministic fallback regex parser if model is offline or dry-run
    return fallbackRegexParser(text, location, week);
  }
}

function fallbackRegexParser(
  text: string,
  location: GymLocation,
  week?: number
): { week?: number; location: GymLocation; routine: string; sets: WorkoutSet[] } {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const sets: WorkoutSet[] = [];
  let currentExercise = "General Exercise";
  let currentWeight = 0;
  let setIndex = 1;

  for (const line of lines) {
    if (/^week\s+\d+/i.test(line)) continue;

    // Check if line is an exercise title (letters without numbers or "pull ups")
    if (!line.includes("x") && !line.match(/^\d+(\.\d+)?$/)) {
      currentExercise = line;
      setIndex = 1;
      continue;
    }

    // Parse comma-separated (e.g. "80 x 7, 60 x 3")
    const subParts = line.split(",");
    subParts.forEach((part, partIdx) => {
      const isDrop = partIdx > 0;
      const match = part.match(/(?:(\d+(?:\.\d+)?)\s*(?:es)?\s*)?x\s*(\d+(?:\.\d+)?)/i);
      if (match) {
        if (match[1]) {
          currentWeight = parseFloat(match[1]);
        }
        const reps = parseFloat(match[2]);
        sets.push({
          exercise: currentExercise,
          setNumber: setIndex++,
          weightKg: currentWeight,
          reps,
          isDropSet: isDrop,
          notes: part.includes("es") ? "each side" : undefined,
        });
      }
    });
  }

  return { week, location, routine: "Upper Body", sets };
}

/**
 * Triggered when user indicates they are heading to the gym.
 * Asks for location if ambiguous, or builds progressive overload target plan.
 */
export async function handleWorkoutStartAction(params: {
  chatId: number;
  userId: number;
  location?: GymLocation;
}): Promise<void> {
  const { chatId, userId, location } = params;

  if (!location) {
    await sendTelegramMessage(
      chatId,
      "🏋️ *Ready to crush today's workout!*\n\nWhere are you gymming today?",
      {
        inline_keyboard: [
          [
            { text: "🏫 School Gym", callback_data: "gym_loc:school" },
            { text: "🏛️ CSC Gym", callback_data: "gym_loc:csc" },
          ],
        ],
      }
    );
    return;
  }

  // Fetch past sets for this location to build science-backed targets
  const pastSets = await getRecentWorkoutSetsByLocation(location);
  const plan = buildWorkoutPlanForLocation({
    location,
    pastSessionSets: pastSets,
  });

  const locationBadge = location === "csc" ? "🏛️ CSC Gym" : "🏫 School Gym";
  const lines: string[] = [
    `🏋️ *Upper Body Workout Target Card* (${locationBadge})`,
    "",
    "🎯 *Science-Backed Progressive Overload Targets*:",
    "",
  ];

  plan.targets.forEach((t, i) => {
    const weightStr = t.targetWeightKg > 0 ? `${t.targetWeightKg}kg` : "Bodyweight";
    const repRange =
      t.targetRepsMin === t.targetRepsMax
        ? `${t.targetRepsMin} reps`
        : `${t.targetRepsMin}–${t.targetRepsMax} reps`;
    lines.push(`*${i + 1}. ${t.exercise}*`);
    lines.push(`   🎯 *Target:* ${weightStr} × ${repRange} (${t.targetSets} sets)`);
    lines.push(`   💡 _${t.progressiveOverloadReason}_`);
    if (t.backOffSet) {
      lines.push(`   📉 _Back-off set: ${t.backOffSet.weightKg}kg × ${t.backOffSet.reps}_`);
    }
    lines.push("");
  });

  lines.push("🧠 *Key Focus Today*:");
  lines.push("• Stop 1–2 reps before technical breakdown (RIR 1–2).");
  lines.push("• Control the eccentric phase (2-3 seconds down).");
  lines.push("");
  lines.push("📝 When finished, simply text or dictate your sets here!");

  await sendTelegramMessage(chatId, lines.join("\n"));
}

/**
 * Triggered when user sends their completed workout logs.
 * Automatically saves to Google Sheets, computes volume, and returns an undo button.
 */
export async function handleWorkoutLogAction(params: {
  chatId: number;
  userId: number;
  text: string;
  location?: GymLocation;
}): Promise<void> {
  const { chatId, userId, text, location: forcedLocation } = params;

  const parsed = await parseWorkoutText(text, forcedLocation);
  if (parsed.sets.length === 0) {
    await sendTelegramMessage(
      chatId,
      "⚠️ I couldn't identify any exercise sets from that message. Please format like:\n`incline smith\n100 x 5.5\n100 x 4`"
    );
    return;
  }

  const todayStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  const sessionId = `workout_${Date.now()}`;
  const session: WorkoutSession = {
    sessionId,
    date: todayStr,
    week: parsed.week,
    location: parsed.location,
    routine: parsed.routine,
    sets: parsed.sets,
    totalVolumeKg: calculateSessionVolume(parsed.sets),
    createdAt: new Date().toISOString(),
  };

  const { rowIds, totalVolumeKg } = await logWorkoutSession(session);

  // Register undo token
  const undoToken = await registerUndoAction(userId, {
    type: "workout_logged",
    description: `${parsed.sets.length} sets @ ${parsed.location}`,
    data: { rowIds: JSON.stringify(rowIds) },
  });

  const locationBadge = parsed.location === "csc" ? "🏛️ CSC Gym" : "🏫 School Gym";
  const weekBadge = parsed.week ? ` • Week ${parsed.week}` : "";

  // Group top sets for neat summary
  const exerciseSummary: Record<string, string[]> = {};
  for (const s of parsed.sets) {
    if (!exerciseSummary[s.exercise]) {
      exerciseSummary[s.exercise] = [];
    }
    const dropStr = s.isDropSet ? " (drop)" : "";
    const wStr = s.weightKg > 0 ? `${s.weightKg}kg` : "BW";
    exerciseSummary[s.exercise].push(`${wStr} × ${s.reps}${dropStr}`);
  }

  const summaryLines: string[] = [
    `✅ *Workout Logged to Google Sheets!*`,
    `📍 ${locationBadge}${weekBadge}`,
    `📊 *Total Session Volume:* ${totalVolumeKg.toLocaleString()} kg`,
    `🔢 *Total Sets Recorded:* ${parsed.sets.length}`,
    "",
    "*Exercises Completed:*",
  ];

  for (const [ex, setList] of Object.entries(exerciseSummary)) {
    summaryLines.push(`• *${ex}*: ${setList.join(", ")}`);
  }

  summaryLines.push("");
  summaryLines.push("📈 Recorded in your *Workouts* sheet with Est. 1RM & volume calculations.");

  await sendTelegramMessage(
    chatId,
    summaryLines.join("\n"),
    buildUndoInlineKeyboard(undoToken)
  );
}

/**
 * Triggered by /gym or /workout to view stats
 */
export async function handleWorkoutViewAction(params: {
  chatId: number;
}): Promise<void> {
  const { chatId } = params;
  const stats = await getWorkoutStatsSummary();

  const lines = [
    "🏋️ *Workout & Strength Progress*",
    "",
    `📅 *Total Workout Days:* ${stats.totalSessions}`,
    `🏋️‍♂️ *All-Time Training Volume:* ${stats.totalVolumeKg.toLocaleString()} kg`,
    "",
  ];

  if (stats.recentPRs.length > 0) {
    lines.push("*Top Estimated 1RMs & Best Lifts:*");
    stats.recentPRs.forEach((pr) => {
      const e1rm = calculateEstimated1RM(pr.weightKg, pr.reps);
      lines.push(
        `• *${pr.exercise}*: ${pr.weightKg}kg × ${pr.reps} reps (Est. 1RM: ${e1rm}kg)`
      );
    });
  } else {
    lines.push("No recorded workouts yet. Tell me 'I'm going to the gym' to get started!");
  }

  await sendTelegramMessage(chatId, lines.join("\n"));
}
