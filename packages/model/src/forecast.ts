import { solvePlan } from './lp';
import type { PressureParams } from './pressure';
import { runPlan } from './strategies';
import type { CohortParams, FleetConfig, ModelConstants, Plan, RunResult, Scenario } from './types';

// Forecast-based planning and re-planning (AGENTS.md Section 7, forecast.ts).

export interface ForecastRun {
  runIso: string; availableHour: number; model: string; station: string;
  outdoorF: (number | null)[]; sigmaF: (number | null)[];
  label: 'sourced' | 'assumed'; source: string;
}
export type ScenarioWithForecasts = Scenario & { forecastRuns?: ForecastRun[] };
export type PlanningMode = 'REPLAN' | 'SINGLE' | 'OBSERVED';
export type ReplanPolicy =
  | { kind: 'FIXED'; intervalH: number }
  | { kind: 'SCHEDULED_PLUS_DRIFT'; driftTempF: number; driftHours: number; driftPressureIdx: number; driftFadeH: number };
export type ReplanReason = 'start' | 'forecast' | 'drift-temp' | 'drift-pressure' | 'fixed';

export interface ReplanSegment {
  fromHour: number; reason: ReplanReason; runIso: string | null; driftF: number; plan: Plan; solveMs: number; deepenedF: number;
}

/** The newest run usable at `hour` (availableHour ≤ hour); ties go to the later runIso. */
export function latestRun(sc: ScenarioWithForecasts, hour: number): ForecastRun | null {
  let best: ForecastRun | null = null;
  for (const r of sc.forecastRuns ?? []) {
    if (r.availableHour > hour) continue;
    if (!best || r.availableHour > best.availableHour || (r.availableHour === best.availableHour && r.runIso > best.runIso)) best = r;
  }
  return best;
}

/** E-A0 stub: returns the observed scenario. Real forecast blending lands in E-C1. */
export function planningScenario(
  sc: ScenarioWithForecasts, fromHour: number, _bufferSigma: number, _consts: ModelConstants, _shape: number[],
  _drift?: { errorF: number; fadeH: number },
): { scenario: Scenario; run: ForecastRun | null; planningOutdoorF: number[] } {
  const { forecastRuns: _runs, ...scenario } = sc;
  return { scenario, run: latestRun(sc, fromHour), planningOutdoorF: sc.outdoorF.slice() };
}

/** E-A0 stub: one solve at hour 0 on observed weather. Real re-planning lands in E-C1. */
export async function replanRun(
  sc: ScenarioWithForecasts, cohorts: CohortParams[], cfg: FleetConfig, consts: ModelConstants, p: PressureParams,
  opts: { mode: PlanningMode; bufferSigma: number; policy: ReplanPolicy; strategy: 'OPTIMIZED' | 'MAX_RELIEF'; timeoutMs?: number },
): Promise<{ plan: Plan; run: RunResult; segments: ReplanSegment[] }> {
  const { forecastRuns: _runs, ...base } = sc;
  const plan = await solvePlan(base, cohorts, cfg, opts.strategy, consts, { timeoutMs: opts.timeoutMs, pressure: p });
  const run = runPlan(base, cohorts, cfg, plan, consts);
  return { plan, run, segments: [{ fromHour: 0, reason: 'start', runIso: null, driftF: 0, plan, solveMs: plan.solveMs ?? 0, deepenedF: 0 }] };
}
