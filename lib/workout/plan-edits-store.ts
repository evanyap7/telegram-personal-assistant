import { getMemoryByKey, saveMemory } from "../memory";
import type { PlanEdit } from "./plan-edits";

const MEMORY_EDITS_KEY = "ph3_plan_edits";

/** Short cache: getDayPlan runs several times per message and each read is a Sheets call. */
const CACHE_TTL_MS = 15_000;
let cache: { edits: PlanEdit[]; at: number } | null = null;

export async function loadPlanEdits(): Promise<PlanEdit[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.edits;
  let edits: PlanEdit[] = [];
  try {
    const record = await getMemoryByKey(MEMORY_EDITS_KEY, "preference");
    const parsed: unknown = record?.value ? JSON.parse(record.value) : [];
    if (Array.isArray(parsed)) edits = parsed as PlanEdit[];
  } catch {
    // A missing or corrupt record just means no edits; the sheet plan still works.
  }
  cache = { edits, at: Date.now() };
  return edits;
}

export async function savePlanEdits(edits: PlanEdit[]): Promise<void> {
  await saveMemory({
    category: "preference",
    key: MEMORY_EDITS_KEY,
    value: JSON.stringify(edits),
    tags: ["ph3", "workout", "edits"],
  });
  cache = { edits, at: Date.now() };
}
