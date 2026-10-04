import { describe, expect, it } from 'vitest';
import {
  buildCohorts, latestRun, loadConstants, planningScenario, pressureIndex, pressureSummary, replanRun, rmseAtLead, runPlan, solvePlan,
} from '../src/index';
import type { CohortSpec, ConstantsJson, ForecastRun, ScenarioWithForecasts } from '../src/index';
import constantsJson from '../../../data/constants.json';
import cohortSpecJson from '../../../data/cohort_spec.json';
import shape from '../../../data/demand_shape.json';
import feb2024Json from '../../../data/scenarios/feb2024.json';

// E-C1. Until DATA lands the Section 6 constants, the ones this file needs are added here.
const entry = (value: number | number[]) => ({ value, unit: '', label: 'derived' as const, source: 'test' });
const raw: ConstantsJson = {
  demand_sensitivity_mmcfd_per_f: entry(3.43655), forecast_lag_h: entry(1),
  ...(constantsJson as unknown as ConstantsJson),
};
const consts = loadConstants(raw);
const cohorts = buildCohorts(cohortSpecJson as unknown as CohortSpec, consts.uaMeanBtuHPerF);
const feb = feb2024Json as unknown as ScenarioWithForecasts;
const p = { rMMcfd: 266.5, wMMcf: 9.54, reserveIdx: 10 };
const cfg = { enrolledHomes: 25000, exemptShare: 0.08, floorF: 62, maxDepthF: 5, overrideRate: 0.06, capacityMMcfd: p.rMMcfd, seed: 42 };
const drift = { kind: 'SCHEDULED_PLUS_DRIFT' as const, driftTempF: 1.5, driftHours: 2, driftPressureIdx: 5, driftFadeH: 12 };

/** Runs every 6 h (first available at hour −5), each covering `coverH` hours ahead, with `offset(h, lead)` added to actuals. */
function withRuns(offset: (h: number, lead: number) => number, sigma: number | null = null, coverH = 120): ScenarioWithForecasts {
  const runs: ForecastRun[] = [];
  for (let k = -1; k * 6 < feb.hours; k++) {
    const runHour = k * 6;
    runs.push({
      runIso: new Date(Date.parse(feb.startIso) + runHour * 3600e3).toISOString(), availableHour: runHour + 1,
      model: 'TEST', station: 'PANC', label: 'assumed', source: 'test',
      outdoorF: feb.outdoorF.map((f, h) => (h >= runHour && h < runHour + coverH ? f + offset(h, h - runHour) : null)),
      sigmaF: feb.outdoorF.map((_, h) => (h >= runHour && h < runHour + coverH ? sigma : null)),
    });
  }
  return { ...feb, forecastRuns: runs };
}

describe('forecast planning', () => {
  it('latestRun picks the newest available run', () => {
    const sc = withRuns(() => 0);
    expect(latestRun(sc, 0)?.availableHour).toBe(-5);
    expect(latestRun(sc, 6)?.availableHour).toBe(1);
    expect(latestRun(sc, 7)?.availableHour).toBe(7);
    expect(latestRun({ ...feb, forecastRuns: undefined }, 10)).toBeNull();
  });

  it('a perfect forecast with zero buffer reproduces the observed scenario exactly', () => {
    const sc = withRuns(() => 0, 2);
    for (const from of [0, 13, 50]) {
      const r = planningScenario(sc, from, 0, consts, shape);
      expect(r.scenario.systemMMcfh).toEqual(feb.systemMMcfh);
      expect(r.planningOutdoorF).toEqual(feb.outdoorF);
      expect((r.scenario as ScenarioWithForecasts).forecastRuns).toBeUndefined();
    }
  });

  it('hours the latest run does not cover carry its last covered value', () => {
    const r = planningScenario(withRuns(() => 0, null, 72), 0, 0, consts, shape);
    expect(r.planningOutdoorF[70]).toBe(feb.outdoorF[65]);
  });

  it('a colder plan raises demand by b × mean difference on the remaining hours only', () => {
    const sc = withRuns(() => -2);
    const r = planningScenario(sc, 30, 0, consts, shape);
    for (let h = 0; h < 30; h++) expect(r.scenario.systemMMcfh[h]).toBe(feb.systemMMcfh[h]);
    const day2 = (a: number[]) => a.slice(24, 48).reduce((s, x) => s + x, 0);
    // Hours 30–47 are 2°F colder: day mean 1.5°F colder → +1.5 × b MMcf on the day.
    expect(day2(r.scenario.systemMMcfh) - day2(feb.systemMMcfh)).toBeCloseTo(1.5 * 3.43655, 6);
    const day3 = (a: number[]) => a.slice(48, 72).reduce((s, x) => s + x, 0);
    expect(day3(r.scenario.systemMMcfh) - day3(feb.systemMMcfh)).toBeCloseTo(2 * 3.43655, 6);
  });

  it('buffer subtracts σ (run spread, else RMSE by lead); drift fades over fadeH', () => {
    const r1 = planningScenario(withRuns(() => 0, 2), 0, 1, consts, shape);
    expect(r1.planningOutdoorF[10]).toBeCloseTo(feb.outdoorF[10] - 2, 9);
    const rmseRaw = { ...raw, forecast_rmse_f: entry([2, 3, 4, 6, 8]) };
    expect(rmseAtLead(rmseRaw, 18)).toBeCloseTo(3.5, 9);
    const c2 = loadConstants(rmseRaw);
    const r2 = planningScenario(withRuns(() => 0), 0, 1, c2, shape);
    // Hour 10 from the run issued at hour −6: lead 16 h → RMSE 3 + (16 − 12)/12 = 3.333.
    expect(r2.planningOutdoorF[10]).toBeCloseTo(feb.outdoorF[10] - (3 + 4 / 12), 6);
    const r3 = planningScenario(withRuns(() => 0), 20, 0, consts, shape, { errorF: 3, fadeH: 12 });
    expect(r3.planningOutdoorF[20]).toBeCloseTo(feb.outdoorF[20] + 3, 9);
    expect(r3.planningOutdoorF[26]).toBeCloseTo(feb.outdoorF[26] + 1.5, 9);
    expect(r3.planningOutdoorF[40]).toBeCloseTo(feb.outdoorF[40], 9);
  });

  it('replanRun with perfect forecasts: only forecast re-plans, and it matches a single solve within 1 point', async () => {
    const sc = withRuns(() => 0);
    const t0 = Date.now();
    const r = await replanRun(sc, cohorts, cfg, consts, p, { mode: 'REPLAN', bufferSigma: 0, policy: drift, strategy: 'OPTIMIZED' });
    const ms = Date.now() - t0;
    expect(r.segments[0].reason).toBe('start');
    expect(r.segments.slice(1).every((s) => s.reason === 'forecast')).toBe(true);
    expect(r.segments.length).toBe(17); // hour 0, then hours 1, 7, …, 91
    expect(r.plan.note).toBeUndefined();
    const single = runPlan(feb, cohorts, cfg, await solvePlan(feb, cohorts, cfg, 'OPTIMIZED', consts, { pressure: p }), consts);
    const idx = (run: typeof single) => pressureIndex(run.hours.map((x) => x.systemMMcfh), p) as number[];
    const a = idx(r.run), b = idx(single);
    a.forEach((v, h) => expect(Math.abs(v - b[h]), `hour ${h}`).toBeLessThan(1));
    expect(pressureSummary(a, p).minIndex).toBeGreaterThan(5);
    expect(ms).toBeLessThan(15000);
  }, 60000);

  it('a forecast that runs warm triggers drift re-plans and deepens the setback', async () => {
    const sc = withRuns((h) => (h >= 40 && h < 60 ? 4 : 0)); // every run 4°F too warm on hours 40–59
    const r = await replanRun(sc, cohorts, cfg, consts, p, { mode: 'REPLAN', bufferSigma: 0, policy: drift, strategy: 'OPTIMIZED' });
    const dr = r.segments.filter((s) => s.reason === 'drift-temp');
    expect(dr.length).toBeGreaterThan(0);
    expect(dr[0].fromHour).toBe(42);
    expect(dr[0].driftF).toBeCloseTo(-4, 9);
    // At most one re-plan per hour, in order.
    r.segments.forEach((s, i) => i > 0 && expect(s.fromHour).toBeGreaterThan(r.segments[i - 1].fromHour));
  }, 60000);

  it('each re-plan reports the upcoming hour where the share of homes turning down changed most', async () => {
    const sc = withRuns((h) => (h >= 40 && h < 60 ? 4 : 0));
    const r = await replanRun(sc, cohorts, cfg, consts, p, { mode: 'REPLAN', bufferSigma: 0, policy: drift, strategy: 'OPTIMIZED' });
    expect(r.segments[0].turnDown).toBeNull();
    for (const s of r.segments.slice(1)) {
      if (!s.turnDown) continue;
      expect(s.turnDown.hour).toBeGreaterThanOrEqual(s.fromHour);
      for (const v of [s.turnDown.before, s.turnDown.after]) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1 + 1e-9); }
      expect(Math.abs(s.turnDown.after - s.turnDown.before)).toBeGreaterThan(0.01);
    }
    expect(r.segments.some((s) => s.turnDown !== null)).toBe(true);
  }, 60000);

  it('FIXED re-plans every intervalH; SINGLE and OBSERVED solve once', async () => {
    const sc = withRuns(() => 0);
    const f = await replanRun(sc, cohorts, cfg, consts, p, { mode: 'REPLAN', bufferSigma: 0, policy: { kind: 'FIXED', intervalH: 24 }, strategy: 'OPTIMIZED' });
    expect(f.segments.map((s) => s.fromHour)).toEqual([0, 24, 48, 72]);
    for (const mode of ['SINGLE', 'OBSERVED'] as const) {
      const s = await replanRun(sc, cohorts, cfg, consts, p, { mode, bufferSigma: 1, policy: drift, strategy: 'OPTIMIZED' });
      expect(s.segments).toHaveLength(1);
      expect(s.segments[0].runIso === null).toBe(mode === 'OBSERVED');
    }
  }, 60000);
});
