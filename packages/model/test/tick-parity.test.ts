import { describe, expect, it } from 'vitest';
import {
  SUBSTEP_HOURS, buildCohorts, clockHourAt, gasCf, heatToHold, loadConstants, normalSetpointF, planBaseline, planNaive4h,
  runPlan, solvePlan, stepState,
} from '../src/index';
import type { CohortParams, CohortSpec, ConstantsJson, FleetConfig, Plan, Scenario } from '../src/index';
import constantsJson from '../../../data/constants.json';
import cohortSpecJson from '../../../data/cohort_spec.json';
import feb2024Json from '../../../data/scenarios/feb2024.json';

// E7: the live simulation (stdb/src/index.ts `tick`, AGENTS.md Section 8) must agree with runPlan. The reducer can't be
// imported here (it needs the Spacetime runtime), so this re-implements its loop step for step: state persists between
// ticks, each tick advances speed × 12 five-minute sub-steps on an integer counter, plan targets come from the
// dispatched plan (missing = normal), gas accumulates per hour and is aggregated at each hour boundary.
// Overrides are off (overrideRate 0): the live module draws them from sample homes, runPlan from an analytic ramp.

interface TickState { ta: number; tm: number; baseTa: number; baseTm: number; gas: number; baseGas: number }

function simulateTicks(sc: Scenario, cohorts: CohortParams[], cfg: FleetConfig, plan: Plan, hhv: number, speedHoursPerSec: number) {
  const SUB = Math.round(1 / SUBSTEP_HOURS);
  // initStates: air at the first clock hour's normal setpoint, mass at steady state for hour 0's outdoor temperature.
  const states = new Map<number, TickState>(cohorts.map((c) => {
    const sp = normalSetpointF(c, clockHourAt(sc, 0));
    const tm = (c.Ham * sp + c.Umo * sc.outdoorF[0]) / (c.Ham + c.Umo);
    return [c.id, { ta: sp, tm, baseTa: sp, baseTm: tm, gas: 0, baseGas: 0 }];
  }));
  const homesIn = (c: CohortParams) => cfg.enrolledHomes * c.share * (1 - cfg.exemptShare);
  const aggregates: { hour: number; fleet: number; baseline: number }[] = [];
  const nSub = Math.max(1, Math.round(speedHoursPerSec * SUB));
  const kEnd = sc.hours * SUB;
  let k = 0;
  while (k < kEnd) {
    // One scheduled tick.
    for (let i = 0; i < nSub && k < kEnd; i++, k++) {
      const hourIdx = Math.floor(k / SUB);
      const outdoor = sc.outdoorF[hourIdx];
      const clock = clockHourAt(sc, k / SUB);
      for (const c of cohorts) {
        const s = states.get(c.id)!;
        const normal = normalSetpointF(c, clock);
        const p = plan.targetsF[c.id]?.[hourIdx];
        const target = p === undefined || !Number.isFinite(p) ? normal : Math.min(normal, Math.max(cfg.floorF, p));
        const q = heatToHold(c, { TaF: s.ta, TmF: s.tm }, outdoor, target, SUBSTEP_HOURS);
        const next = stepState(c, { TaF: s.ta, TmF: s.tm }, outdoor, q, SUBSTEP_HOURS);
        const qb = heatToHold(c, { TaF: s.baseTa, TmF: s.baseTm }, outdoor, normal, SUBSTEP_HOURS);
        const nb = stepState(c, { TaF: s.baseTa, TmF: s.baseTm }, outdoor, qb, SUBSTEP_HOURS);
        s.ta = next.TaF; s.tm = next.TmF; s.baseTa = nb.TaF; s.baseTm = nb.TmF;
        s.gas += gasCf(c, q, SUBSTEP_HOURS, hhv);
        s.baseGas += gasCf(c, qb, SUBSTEP_HOURS, hhv);
      }
      if ((k + 1) % SUB === 0) {
        let fleet = 0, baseline = 0;
        for (const c of cohorts) {
          const s = states.get(c.id)!;
          fleet += homesIn(c) * s.gas;
          baseline += homesIn(c) * s.baseGas;
          s.gas = 0; s.baseGas = 0;
        }
        aggregates.push({ hour: hourIdx, fleet: fleet / 1e6, baseline: baseline / 1e6 });
      }
    }
  }
  return aggregates;
}

const consts = loadConstants(constantsJson as unknown as ConstantsJson);
const cohorts = buildCohorts(cohortSpecJson as unknown as CohortSpec, consts.uaMeanBtuHPerF);
const sc = feb2024Json as unknown as Scenario;
const cfg: FleetConfig = { enrolledHomes: 25000, exemptShare: consts.exemptShare, floorF: 62, maxDepthF: 5, overrideRate: 0, capacityMMcfd: sc.capacityMMcfd, seed: 42 };

function expectWithin1pct(plan: Plan, speed: number) {
  const run = runPlan(sc, cohorts, cfg, plan, consts);
  const live = simulateTicks(sc, cohorts, cfg, plan, consts.hhvBtuPerCf, speed);
  expect(live).toHaveLength(sc.hours);
  let worst = 0;
  for (const a of live) {
    const r = run.hours[a.hour];
    worst = Math.max(worst, Math.abs(a.fleet - r.fleetGasMMcfh) / r.fleetGasMMcfh, Math.abs(a.baseline - r.baselineFleetGasMMcfh) / r.baselineFleetGasMMcfh);
  }
  expect(worst).toBeLessThan(0.01);
}

describe('live tick parity with runPlan (E7)', () => {
  // 2 h/s is the demo speed; 0.5 and 1.5 h/s make ticks end mid-hour, which exercises state carried across ticks.
  for (const speed of [2, 0.5, 1.5, 4]) {
    it(`BASELINE and NAIVE_4H match within 1% per hour at ${speed} h/s`, () => {
      expectWithin1pct(planBaseline(sc, cohorts), speed);
      expectWithin1pct(planNaive4h(sc, cohorts, cfg), speed);
    });
  }

  it('out-of-range plan targets are clamped to [floor, normal] the same way', () => {
    // S5 lets set_plan through anything in 40–80°F, so both sides must clamp: 50°F → floor, 80°F → normal.
    const plan = planBaseline(sc, cohorts);
    for (const row of plan.targetsF) for (let h = sc.eventStartHour; h < sc.eventEndHour; h++) row[h] = h % 2 === 0 ? 50 : 80;
    expectWithin1pct(plan, 2);
  });

  it('OPTIMIZED (solved LP plan) matches within 1% per hour at 2 h/s', async () => {
    const plan = await solvePlan(sc, cohorts, cfg, 'OPTIMIZED', consts);
    expect(plan.note).toBeUndefined();
    expectWithin1pct(plan, 2);
  });
});
