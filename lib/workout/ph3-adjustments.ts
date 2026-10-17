import type { PH3Exercise } from "./ph3-program";

/**
 * Evidence-based trims applied on top of Layne Norton's PH3 sheet.
 *
 * The sheet stays untouched (its SBD loads are formulas and the logged cells are real data), so
 * the trims live here and are applied when a day's plan is read. The squat/bench/deadlift work
 * is never changed: it is already autoregulated by the AMRAP sets and rep-driven max updates.
 *
 * Why these cuts:
 * - Hypertrophy follows weekly hard sets with diminishing returns, roughly 10-20 per muscle,
 *   and indirect work counts: bench/OHP already load the triceps, rows/pulldowns the biceps
 *   (Schoenfeld 2017; Pelland et al. preprint 2024; Baz-Valle 2022). The sheet stacked ~18
 *   direct biceps and ~16 direct triceps sets per week on top of that.
 * - Strength saturates at far lower volume than size (Pelland 2024), so extra arm and calf
 *   sets add fatigue that competes with the squat/bench/deadlift sessions that drive strength.
 * - BFR is a substitute for conventional sets, not an add-on: adding it to normal-load work
 *   shows no clear extra gain (McKee et al. 2026, very low certainty).
 */

interface TrimRule {
  match: RegExp;
  /** Remove the exercise entirely. */
  drop?: boolean;
  /** Keep only the first N sets. */
  maxSets?: number;
}

/** First matching rule wins. Anything unmatched (SBD, presses, rows, pulldowns, leg work) is untouched. */
const TRIM_RULES: TrimRule[] = [
  // BFR / cluster-set add-ons on arms and calves duplicate the conventional sets for the same
  // muscle on the same day.
  { match: /cluster sets/i, drop: true },
  { match: /^BFR (?!.*\bleg\b).*(bicep|curl|tricep|skullcrusher|push-?down|calf)/i, drop: true },
  // BFR leg extension/curl is the only quad/hamstring isolation work on Day 6: keep it.
  { match: /^BFR /i },

  // Optional posterior-chain extras: low evidence, and the spinal erectors are the recovery
  // bottleneck with squats three times and deadlifts twice a week. Keep one light block.
  { match: /Ukrainian Stallion/i, drop: true },
  { match: /Reverse Hyperextension/i, maxSets: 2 },

  { match: /^(?!.*\bleg\b).*curl/i, maxSets: 3 },
  { match: /skullcrusher/i, maxSets: 3 },
  { match: /tricep.*(push-?down|extension)/i, maxSets: 2 },
  { match: /calf raise/i, maxSets: 3 },
];

export function trimExercises(exercises: PH3Exercise[]): PH3Exercise[] {
  const out: PH3Exercise[] = [];
  for (const ex of exercises) {
    const rule = TRIM_RULES.find((r) => r.match.test(ex.exercise));
    if (rule?.drop) continue;
    if (rule?.maxSets !== undefined && ex.sets.length > rule.maxSets) {
      out.push({ ...ex, sets: ex.sets.slice(0, rule.maxSets) });
    } else {
      out.push(ex);
    }
  }
  return out;
}
