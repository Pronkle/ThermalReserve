import { describe, expect, it } from 'vitest';
import { buildCohorts, compareStrategies, coverageTable, evaluateLoss, loadConstants, pressureIndex, pressureParams, pressureSummary, replanRun } from '../src/index';
import type { CohortSpec, ConstantsJson, Scenario, ScenarioWithForecasts } from '../src/index';
import shape from '../../../data/demand_shape.json';
import constantsJson from '../../../data/constants.json';
import cohortSpecJson from '../../../data/cohort_spec.json';
import presetsJson from '../../../data/presets.json';
import feb2024Json from '../../../data/scenarios/feb2024.json';

// E-A3 against DATA's real files: the presets ENGINE posted (msg 198) and the Near-miss definition (Section 4.2).
const raw = constantsJson as unknown as ConstantsJson;
const consts = loadConstants(raw);
const cohorts = buildCohorts(cohortSpecJson as unknown as CohortSpec, consts.uaMeanBtuHPerF);
const feb = feb2024Json as unknown as Scenario;
const preset = (id: string) => presetsJson.find((p) => p.id === id)!;
const cfgFor = (homes: number) => ({ enrolledHomes: homes, exemptShare: consts.exemptShare, floorF: consts.floorDefaultF, maxDepthF: consts.maxDepthDefaultF, overrideRate: consts.overrideRate, capacityMMcfd: 0, seed: 42 });

describe('presets', () => {
  it('Near-miss is the largest loss (step 0.5) at which 25,000 homes hold the full reserve', async () => {
    const nm = preset('nearmiss');
    const [row] = await coverageTable([feb], cohorts, cfgFor(nm.enrolledHomes), consts, raw);
    expect(row.maxLostAtReserve).toBe(nm.lostMMcfd);
    const r = await evaluateLoss(feb, cohorts, cfgFor(nm.enrolledHomes), consts, raw, nm.lostMMcfd, nm.reserveIdx);
    expect(r.plan.note).toBeUndefined();
    expect(r.planned.minIndex).toBeGreaterThanOrEqual(nm.reserveIdx);
    expect(r.planned.hoursBelowZero).toBe(0);
    expect(r.noProgram.hoursBelowZero).toBeGreaterThan(0);
    expect(r.noProgram.minIndex).toBeCloseTo(-6.9, 0);
    expect(r.degreeHours).toBeCloseTo(75, -1);
    // Naive 4-hour also falls through the line (demo step 2).
    const naive = compareStrategies(feb, cohorts, { ...cfgFor(nm.enrolledHomes), capacityMMcfd: r.pressure.rMMcfd }, consts).NAIVE_4H;
    expect(pressureSummary(pressureIndex(naive.hours.map((h) => h.systemMMcfh), r.pressure) as number[], r.pressure).hoursBelowZero).toBeGreaterThan(0);
  }, 60000);

  // Stress = 15 MMcf/day lost (H1 [CONTRACT] msg 318, was 28.5): No program 2.99 MMcf curtailed, Optimized on observed
  // weather 1.31. The console default (forecast-only re-plan, 0.75σ) is pinned in the re-plan block below.
  it('Stress: the fleet curtails less gas than No program and than Staggered, but cannot remove it', async () => {
    const st = preset('stress');
    const r = await evaluateLoss(feb, cohorts, cfgFor(st.enrolledHomes), consts, raw, st.lostMMcfd, st.reserveIdx);
    expect(r.plan.note).toBeUndefined();
    expect(r.planned.curtailedMMcf).toBeGreaterThan(0);
    expect(r.planned.curtailedMMcf).toBeLessThan(r.noProgram.curtailedMMcf);
    expect(r.planned.hoursBelowZero).toBeLessThan(r.noProgram.hoursBelowZero);
    expect(r.noProgram.curtailedMMcf).toBeCloseTo(2.99, 1);
    expect(r.planned.curtailedMMcf).toBeCloseTo(1.31, 1);
    const stag = compareStrategies(feb, cohorts, { ...cfgFor(st.enrolledHomes), capacityMMcfd: r.pressure.rMMcfd }, consts).SUSTAIN_STAGGER;
    expect(r.planned.curtailedMMcf).toBeLessThan(pressureSummary(pressureIndex(stag.hours.map((h) => h.systemMMcfh), r.pressure) as number[], r.pressure).curtailedMMcf);
  }, 60000);
});

// H1 [CONTRACT] 2026-10-04 09:33Z: the demo re-plans at hour 0 and on each new forecast run (drift triggers off) at
// forecast_buffer_sigma_default. On DATA's archived NBS runs that held Near-miss at 10.2 with 105 °F·h (E-C2, msg 230).
describe('default re-plan on archived forecasts', () => {
  it('Near-miss re-planned on each new forecast holds the reserve', async () => {
    const nm = preset('nearmiss');
    const sc = feb as ScenarioWithForecasts;
    expect(sc.forecastRuns?.length).toBeGreaterThan(0);
    const p = pressureParams(consts, raw, nm.lostMMcfd, nm.reserveIdx);
    const v = (k: string) => raw[k].value as number;
    const r = await replanRun(sc, cohorts, { ...cfgFor(nm.enrolledHomes), capacityMMcfd: p.rMMcfd }, consts, p, {
      mode: 'REPLAN', bufferSigma: v('forecast_buffer_sigma_default'), strategy: 'OPTIMIZED',
      policy: { kind: 'SCHEDULED_PLUS_DRIFT', driftTempF: Infinity, driftHours: v('drift_hours'), driftPressureIdx: Infinity, driftFadeH: v('drift_fade_h') },
    }, shape);
    expect(r.segments.every((s) => !s.plan.note)).toBe(true);
    expect(r.segments.slice(1).every((s) => s.reason === 'forecast')).toBe(true);
    expect(r.segments).toHaveLength(17);
    const s = pressureSummary(pressureIndex(r.run.hours.map((h) => h.systemMMcfh), p) as number[], p);
    expect(s.hoursBelowZero).toBe(0);
    expect(s.minIndex).toBeGreaterThanOrEqual(nm.reserveIdx);
    expect(r.run.totals.degreeHoursBelowNormal).toBeCloseTo(105, -1);
  }, 60000);

  // What the console shows for Stress by default: −16.4, 7 h below, 1.57 MMcf curtailed, 269 °F·h (msg to H1, 07:4x ET).
  it('Stress re-planned on each new forecast still curtails less than No program and Staggered', async () => {
    const st = preset('stress');
    const p = pressureParams(consts, raw, st.lostMMcfd, st.reserveIdx);
    const c = { ...cfgFor(st.enrolledHomes), capacityMMcfd: p.rMMcfd };
    const v = (k: string) => raw[k].value as number;
    const r = await replanRun(feb as ScenarioWithForecasts, cohorts, c, consts, p, {
      mode: 'REPLAN', bufferSigma: v('forecast_buffer_sigma_default'), strategy: 'OPTIMIZED',
      policy: { kind: 'SCHEDULED_PLUS_DRIFT', driftTempF: Infinity, driftHours: v('drift_hours'), driftPressureIdx: Infinity, driftFadeH: v('drift_fade_h') },
    }, shape);
    const score = (run: typeof r.run) => pressureSummary(pressureIndex(run.hours.map((h) => h.systemMMcfh), p) as number[], p);
    const all = compareStrategies(feb, cohorts, c, consts);
    const s = score(r.run);
    expect(r.segments.every((g) => !g.plan.note)).toBe(true);
    expect(s.curtailedMMcf).toBeCloseTo(1.57, 1);
    expect(s.curtailedMMcf).toBeLessThan(score(all.SUSTAIN_STAGGER).curtailedMMcf);
    expect(s.curtailedMMcf).toBeLessThan(score(all.BASELINE).curtailedMMcf);
    expect(s.hoursBelowZero).toBeLessThan(score(all.BASELINE).hoursBelowZero);
  }, 60000);
});
