import { describe, expect, it } from 'vitest';
import {
  buildCohorts, compareStrategies, curtailedSeriesMMcf, discomfortSeries, loadConstants, planBaseline, pressureIndex, pressureParams,
  pressureSummary, runPlan, solvePlan, usableLinepackMMcf,
} from '../src/index';
import type { CohortSpec, ConstantsJson, PressureParams, Scenario } from '../src/index';
import constantsJson from '../../../data/constants.json';
import cohortSpecJson from '../../../data/cohort_spec.json';
import shape from '../../../data/demand_shape.json';
import feb2024Json from '../../../data/scenarios/feb2024.json';

// AGENTS.md Section 3 and E-A1/E-A2. The anchor table was run with W = 9.1 (the throwaway check); the product uses 9.54.
const consts = loadConstants(constantsJson as unknown as ConstantsJson);
const cohorts = buildCohorts(cohortSpecJson as unknown as CohortSpec, consts.uaMeanBtuHPerF);
const feb = feb2024Json as unknown as Scenario;
const cfg = { enrolledHomes: 25000, exemptShare: 0.08, floorF: 62, maxDepthF: 5, overrideRate: 0.06, capacityMMcfd: 266.5, seed: 42 };
const P = (rMMcfd: number, wMMcf = 9.1, reserveIdx = 10): PressureParams => ({ rMMcfd, wMMcf, reserveIdx });
const score = (sys: number[], p: PressureParams) => pressureSummary(pressureIndex(sys, p) as number[], p);

describe('pressure index', () => {
  it('usable linepack at R2024 is 9.54 MMcf, and a day at exactly R bottoms out at 0', () => {
    const w = usableLinepackMMcf(278, shape);
    expect(w).toBeCloseTo(9.54, 1);
    expect(Math.abs(w - 9.54)).toBeLessThan(0.01);
    const sum = shape.reduce((a, b) => a + b, 0);
    const days = Array.from({ length: 72 }, (_, h) => (278 * shape[h % 24]) / sum);
    expect(Math.abs(score(days, P(278, w)).minIndex)).toBeLessThan(0.01);
  });

  it('reproduces the Section 3 No program anchors', () => {
    const a = score(feb.systemMMcfh, P(265));
    expect(Math.abs(a.minIndex - -23.1)).toBeLessThan(0.5);
    expect(a.minHour).toBe(69);
    expect(a.hoursBelowZero).toBe(9);
    // Anchor says −11.5; this model gives −12.10 (same 5 hours). Off by 0.6, reported to H1 at 04:06 (the anchor
    // matches R ≈ 266.58). Pinned here so drift shows.
    const b = score(feb.systemMMcfh, P(266.5));
    expect(b.minIndex).toBeCloseTo(-12.10, 1);
    expect(b.hoursBelowZero).toBe(5);
  });

  it('pressureIndex stops at the first undefined, starts from initialIdx and throttles inflow at full', () => {
    const p = P(24, 10);
    expect(pressureIndex([1, 1, undefined, 1], p)).toEqual([100, 100, undefined, undefined]);
    expect(pressureIndex([2, 2], p, 50)).toEqual([40, 30]);
    expect(pressureIndex([0, 0], p, 95)).toEqual([100, 100]);
  });

  it('curtailed gas: one episode = its deepest deficit; a re-dip after partial recovery is not double-counted', () => {
    const one = pressureSummary([50, 5, -10, -20, -5, 30], P(24, 10, 10));
    expect(one.curtailedMMcf).toBeCloseTo(2, 9);
    // W 10: 5 → −5 curtails 0.5 and empties the pipes; → 3 refills to 0.8; → −4 drains 0.7, leaving 0.1: no more
    // curtailment. The old per-episode sum would say 0.5 + 0.4 = 0.9.
    const two = pressureSummary([5, -5, 3, -4, 20], P(24, 10, 10));
    expect(two.curtailedMMcf).toBeCloseTo(0.5, 9);
    expect(curtailedSeriesMMcf([5, -5, 3, -4, 20], P(24, 10, 10))).toEqual([0, 0.5, 0.5, 0.5, 0.5]);
  });

  it('summary: hours below, first below, reserve hours and held', () => {
    const s = pressureSummary([50, 5, -10, -20, -5, 3, -4, 20], P(24, 10, 10));
    expect(s.hoursBelowZero).toBe(4);
    expect(s.firstBelowHour).toBe(2);
    expect(s.minIndex).toBe(-20);
    expect(s.minHour).toBe(3);
    expect(s.hoursInReserve).toBe(2);
    expect(s.reserveHeld).toBe(-20);
    expect(pressureSummary([80, 7, 30], P(24, 10, 10)).reserveHeld).toBe(7);
  });

  it('pressureParams: R = 278 − lost, W fixed', () => {
    const raw = { ...(constantsJson as unknown as ConstantsJson) };
    raw.deliverability_2024_mmcfd = { value: 278, unit: 'MMcf/day', label: 'derived', source: 't' };
    raw.linepack_usable_mmcf = { value: 9.54, unit: 'MMcf', label: 'derived', source: 't' };
    expect(pressureParams(consts, raw, 11.5, 10)).toEqual({ rMMcfd: 266.5, wMMcf: 9.54, reserveIdx: 10 });
    expect(pressureParams(consts, raw, 30, 5).wMMcf).toBe(9.54);
  });

  it('discomfortSeries mean sums to degreeHoursBelowNormal within 1% for every strategy', async () => {
    const r = compareStrategies(feb, cohorts, cfg, consts);
    const opt = runPlan(feb, cohorts, cfg, await solvePlan(feb, cohorts, cfg, 'OPTIMIZED', consts, { pressure: P(266.5) }), consts);
    for (const run of [r.BASELINE, r.NAIVE_4H, r.SUSTAIN_STAGGER, opt]) {
      const d = discomfortSeries(run, r.BASELINE, cohorts, cfg);
      const sum = d.meanF.reduce((a, b) => a + b, 0);
      const want = run.totals.degreeHoursBelowNormal;
      if (want === 0) expect(sum).toBe(0);
      else expect(Math.abs(sum / want - 1), run.strategy).toBeLessThan(0.01);
      d.worstF.forEach((w, h) => expect(w).toBeGreaterThanOrEqual(d.meanF[h] - 1e-9));
      expect(Math.max(...d.worstF)).toBeLessThanOrEqual(cfg.maxDepthF + 0.5);
    }
  });
});

describe('pressure-mode LP', () => {
  const solve = async (p?: PressureParams) => {
    const c = { ...cfg, capacityMMcfd: p?.rMMcfd ?? 266.5 };
    const plan = await solvePlan(feb, cohorts, c, 'OPTIMIZED', consts, p ? { pressure: p } : undefined);
    const run = runPlan(feb, cohorts, c, plan, consts);
    return { plan, run, s: score(run.hours.map((h) => h.systemMMcfh), p ?? P(266.5)), dh: run.totals.degreeHoursBelowNormal };
  };

  // Anchors (W 9.1, R 266.5): daily LP +1.5 / 69; reserve 0 → +0.2 / 37; reserve 10 → +6.7 / 77. This model, with the
  // 1e4 reserve weight (H1, 08:11Z) and the 0.3-point planning margin: +1.00 / 69.3, +0.46 / 41.1 (the anchor was run
  // with 1e3 and no margin, which gave 39.6 here), +6.21 / 76.6.
  it('reproduces the Section 3 LP rows', async () => {
    const daily = await solve();
    expect(Math.abs(daily.s.minIndex - 1.5)).toBeLessThanOrEqual(0.51);
    expect(Math.abs(daily.dh / 69 - 1)).toBeLessThan(0.05);
    const r0 = await solve(P(266.5, 9.1, 0));
    expect(Math.abs(r0.s.minIndex - 0.2)).toBeLessThan(0.5);
    expect(r0.s.hoursBelowZero).toBe(0);
    expect(r0.dh).toBeCloseTo(41.1, 0);
    const r10 = await solve(P(266.5, 9.1, 10));
    expect(Math.abs(r10.s.minIndex - 6.7)).toBeLessThan(0.5);
    expect(Math.abs(r10.dh / 77 - 1)).toBeLessThan(0.05);
    expect(r10.plan.note).toBeUndefined();
  }, 30000);

  it('reports curtailment per hour and per gas day when the fleet cannot cover it', async () => {
    const { plan, s } = await solve(P(265, 9.1, 10));
    const h = plan.shortfallMMcfh!.reduce((a, b) => a + b, 0);
    const d = plan.shortfallMMcfd!.reduce((a, b) => a + b, 0);
    expect(h).toBeGreaterThan(0);
    expect(d).toBeCloseTo(h, 9);
    expect(s.curtailedMMcf).toBeGreaterThan(0);
    // Planned curtailment and the 5-minute run's curtailment agree to within a tenth of a MMcf.
    expect(Math.abs(s.curtailedMMcf - h)).toBeLessThan(0.1);
  }, 30000);

  it('Near-miss (W 9.54, lost 11.5) holds the run above zero and No program falls below', async () => {
    const p = P(266.5, 9.54, 10);
    const { plan, s } = await solve(p);
    expect(plan.shortfallMMcfh!.every((x) => x === 0)).toBe(true);
    expect(s.minIndex).toBeGreaterThan(5);
    const base = runPlan(feb, cohorts, { ...cfg, capacityMMcfd: 266.5 }, planBaseline(feb, cohorts), consts);
    expect(score(base.hours.map((h) => h.systemMMcfh), p).hoursBelowZero).toBeGreaterThan(0);
  }, 30000);
});
