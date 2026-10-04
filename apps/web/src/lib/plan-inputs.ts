import type { FleetConfig, Plan } from '@thermal-reserve/model';

export function planInputKey(scenarioId: string, config: FleetConfig): string {
  return JSON.stringify([scenarioId, config.enrolledHomes, config.exemptShare, config.floorF, config.maxDepthF, config.capacityMMcfd, config.overrideRate, config.seed]);
}
function fingerprint(key: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const character of key) hash = BigInt.asUintN(64, (hash ^ BigInt(character.charCodeAt(0))) * 0x100000001b3n);
  return hash.toString(16).padStart(16, '0');
}
// Shared plan IDs carry the solve-input fingerprint across browsers without a
// schema change. Keep the ID below the server's 64-character limit.
export function identifyPlan(plan: Plan, key: string, nonce: string): Plan {
  return { ...plan, id: `${plan.id.slice(0, 30)}-${nonce.slice(0, 10)}-cfg-${fingerprint(key)}` };
}
export function planMatchesInputs(planId: string, key: string): boolean {
  return planId.endsWith(`-cfg-${fingerprint(key)}`);
}
export function planNeedsNoSetbacks(plan: Plan | undefined): boolean {
  return plan?.strategy === 'OPTIMIZED' && !plan.note && !plan.targetsF.some(targets => targets.some(Number.isFinite));
}
export function cachePlan(cache: Map<string, Plan>, key: string, plan: Plan): Map<string, Plan> {
  const next = new Map(cache);
  next.delete(key);
  next.set(key, plan);
  while (next.size > 10) next.delete(next.keys().next().value!);
  return next;
}
