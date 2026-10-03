import { planSustainStagger } from './strategies';
import type { CohortParams, FleetConfig, ModelConstants, Plan, Scenario, ThermalState } from './types';

// E0 STUB: buildLp returns a tiny valid CPLEX LP; solvePlan returns the rule-based fallback.
// E5 implements the full LP and the HiGHS solve. Signatures are final.

export function buildLp(sc: Scenario, cohorts: CohortParams[], cfg: FleetConfig, mode: 'OPTIMIZED' | 'MAX_RELIEF', initial: ThermalState[], consts: ModelConstants): string {
  void sc; void cohorts; void cfg; void initial; void consts;
  return [
    `\\ Thermal Reserve ${mode} (stub)`,
    'Minimize',
    ' obj: s_0',
    'Subject To',
    ' c0: s_0 >= 0',
    'Bounds',
    ' s_0 >= 0',
    'End',
    '',
  ].join('\n');
}

export async function solvePlan(
  sc: Scenario,
  cohorts: CohortParams[],
  cfg: FleetConfig,
  mode: 'OPTIMIZED' | 'MAX_RELIEF',
  consts: ModelConstants,
  opts?: { timeoutMs?: number; fromHour?: number; initial?: ThermalState[] },
): Promise<Plan> {
  void consts; void opts;
  const fallback = planSustainStagger(sc, cohorts, cfg);
  return {
    ...fallback,
    id: `${sc.id}-${mode}`,
    shortfallMMcfh: new Array<number>(sc.hours).fill(0),
    solveMs: 0,
    note: 'Rule-based fallback',
  };
}
