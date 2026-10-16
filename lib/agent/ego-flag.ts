/** EGO is on unless EGO_ORCHESTRATOR is set to "off" (the rollback to the old pipeline). */
export function isEgoEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return (env.EGO_ORCHESTRATOR ?? "").trim().toLowerCase() !== "off";
}
