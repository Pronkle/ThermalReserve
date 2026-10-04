// packages/model and data/*.json, loaded the way apps/web/src/lib/ops.ts does, so Insights quotes
// the same numbers the website shows.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildCohorts, compareStrategies, loadConstants, runPlan,
  type CohortSpec, type ConstantsJson, type FleetConfig, type ModelConstants, type Plan, type RunResult, type Scenario, type Strategy,
} from '@thermal-reserve/model';
import { REPO_DIR } from '../config';
import type { SimView } from '../types';

const readJson = <T>(path: string): T => JSON.parse(readFileSync(join(REPO_DIR, 'data', path), 'utf8')) as T;

export const constantsJson = readJson<ConstantsJson>('constants.json');
export const modelConstants: ModelConstants = loadConstants(constantsJson);
export const cohorts = buildCohorts(readJson<CohortSpec>('cohort_spec.json'), modelConstants.uaMeanBtuHPerF);

const scenarioCache = new Map<string, Scenario | undefined>();
export function scenario(id: string): Scenario | undefined {
  if (!scenarioCache.has(id)) {
    try { scenarioCache.set(id, readJson<Scenario>(`scenarios/${id}.json`)); } catch { scenarioCache.set(id, undefined); }
  }
  return scenarioCache.get(id);
}

// The operator's live settings (sim_config) as the model's FleetConfig; seed 42 like /ops.
export function fleetConfig(sim: SimView): FleetConfig {
  return {
    enrolledHomes: sim.enrolledHomes, exemptShare: sim.exemptShare, floorF: sim.floorF,
    maxDepthF: sim.maxDepthF, overrideRate: sim.overrideRate, capacityMMcfd: sim.capacityMMcfd, seed: 42,
  };
}

export interface DaySummary {
  day: number;                    // gas day index from scenario start
  noProgramDemandMMcf: number;    // scenario system demand, no program
  capacityMMcf: number;
  shortfallMMcf: number;          // no-program demand above capacity (0 when covered)
  uncoveredMMcf: Record<'BASELINE' | 'NAIVE_4H' | 'SUSTAIN_STAGGER', number> & { DISPATCHED?: number };
}

export interface DispatchedPlan { planId: string; strategy: string; targetsF: number[][]; }

type Runs = Record<'BASELINE' | 'NAIVE_4H' | 'SUSTAIN_STAGGER', RunResult>;
let compareCache: { key: string; runs: Runs } | undefined;
let dispatchedCache: { key: string; run: RunResult } | undefined;

// `dispatched` is the plan the operator actually sent (rebuilt from plan_hour); when given, it is
// simulated with the same runner so its numbers sit next to the comparison strategies.
export function compare(sim: SimView, dispatched?: DispatchedPlan): { runs: Runs; dispatched?: RunResult; days: DaySummary[] } | undefined {
  const sc = scenario(sim.scenarioId);
  if (!sc) return undefined;
  const cfg = fleetConfig(sim);
  const key = JSON.stringify([sim.scenarioId, cfg]);
  if (compareCache?.key !== key) compareCache = { key, runs: compareStrategies(sc, cohorts, cfg, modelConstants) };
  const runs = compareCache.runs;
  let dispatchedRun: RunResult | undefined;
  if (dispatched) {
    const dkey = `${key}|${dispatched.planId}`;
    if (dispatchedCache?.key !== dkey) {
      const plan: Plan = { id: dispatched.planId, strategy: dispatched.strategy as Strategy, targetsF: dispatched.targetsF };
      dispatchedCache = { key: dkey, run: runPlan(sc, cohorts, cfg, plan, modelConstants) };
    }
    dispatchedRun = dispatchedCache.run;
  }
  const days: DaySummary[] = [];
  for (let day = 0; day * 24 < sc.hours; day++) {
    const span = (xs: number[]) => xs.slice(day * 24, day * 24 + 24).reduce((s, x) => s + x, 0);
    const demand = span(sc.systemMMcfh);
    const uncovered = (run: RunResult) => Math.max(0, span(run.hours.map(h => h.systemMMcfh)) - cfg.capacityMMcfd);
    days.push({
      day,
      noProgramDemandMMcf: demand,
      capacityMMcf: cfg.capacityMMcfd,
      shortfallMMcf: Math.max(0, demand - cfg.capacityMMcfd),
      uncoveredMMcf: {
        BASELINE: uncovered(runs.BASELINE), NAIVE_4H: uncovered(runs.NAIVE_4H), SUSTAIN_STAGGER: uncovered(runs.SUSTAIN_STAGGER),
        ...(dispatchedRun ? { DISPATCHED: uncovered(dispatchedRun) } : {}),
      },
    });
  }
  return { runs, dispatched: dispatchedRun, days };
}
