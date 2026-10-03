import { describe, expect, it } from 'vitest';
import * as model from '../src/index';
import { cfg, cohorts, consts, designScenario } from './helpers';

describe('E0 scaffold', () => {
  it('exports every Contract B function', () => {
    const names = [
      'SUBSTEP_HOURS', 'stepState', 'heatToHold', 'gasCf', 'normalSetpointF', 'discretizeHourly',
      'mulberry32', 'buildCohorts', 'sampleHomes', 'homesPerDot',
      'planBaseline', 'planNaive4h', 'planSustainStagger', 'runPlan', 'compareStrategies',
      'buildLp', 'solvePlan',
      'fitSystemDemand', 'hourlySystemMMcfh', 'nonEnrolledMMcfh',
      'validateConEdLike', 'validateSoCalLike', 'anchorageSanity',
      'whatIf', 'loadConstants',
    ] as const;
    for (const n of names) expect(model[n], n).toBeDefined();
  });

  it('builds 24 cohorts whose shares sum to 1', () => {
    expect(cohorts).toHaveLength(24);
    expect(cohorts[0].key).toBe('furnace-night-tight-light');
    expect(cohorts.reduce((s, c) => s + c.share, 0)).toBeCloseTo(1, 9);
  });

  it('compareStrategies returns 96 shaped hours per strategy', () => {
    const sc = designScenario();
    const r = model.compareStrategies(sc, cohorts, cfg, consts);
    for (const k of ['BASELINE', 'NAIVE_4H', 'SUSTAIN_STAGGER'] as const) {
      expect(r[k].hours).toHaveLength(96);
      expect(r[k].hours[50].cohorts).toHaveLength(24);
      expect(Number.isFinite(r[k].totals.netSavedMMcf)).toBe(true);
    }
    expect(r.BASELINE.totals.netSavedMMcf).toBeCloseTo(0, 9);
    expect(r.BASELINE.totals.degreeHoursBelowNormal).toBeCloseTo(0, 9);
  });

  it('solvePlan stub returns a shaped plan', async () => {
    const sc = designScenario();
    const p = await model.solvePlan(sc, cohorts, cfg, 'OPTIMIZED', consts);
    expect(p.targetsF).toHaveLength(24);
    expect(p.targetsF[0]).toHaveLength(96);
  });
});

describe('demand (E1b)', () => {
  it('fit reproduces both anchors and hourly sums match daily', () => {
    const hdd = Array.from({ length: 31 }, (_, i) => 50 + (i % 7) * 5);
    const fit = model.fitSystemDemand(hdd, 5.6, 90, 268);
    const month = hdd.reduce((s, x) => s + fit.a + fit.b * x, 0);
    expect(month).toBeCloseTo(5600, 6);
    expect(fit.a + fit.b * 90).toBeCloseTo(268, 9);
    const shape = Array.from({ length: 24 }, () => 1 / 24);
    const hourly = model.hourlySystemMMcfh(hdd, fit, shape);
    expect(hourly).toHaveLength(31 * 24);
    for (let d = 0; d < hdd.length; d++) {
      const s = hourly.slice(d * 24, d * 24 + 24).reduce((a, b) => a + b, 0);
      expect(s).toBeCloseTo(fit.a + fit.b * hdd[d], 9);
    }
  });
});

describe('whatIf (E6 targets)', () => {
  const base = { setbackF: 5, outdoorF: -20, days: 3, tier2Pct: 0 };
  it('25,000 homes at 5°F ≈ 1.40 MMcf/day', () => {
    const r = model.whatIf({ ...base, participationPct: (25000 / 150000) * 100 }, consts);
    expect(Math.abs(r.mmcfPerDay - 1.4)).toBeLessThanOrEqual(0.05);
    expect(r.formulaLines.length).toBeGreaterThan(0);
  });
  it('10,000 homes at 5°F ≈ 0.56 MMcf/day', () => {
    const r = model.whatIf({ ...base, participationPct: (10000 / 150000) * 100 }, consts);
    expect(Math.abs(r.mmcfPerDay - 0.56)).toBeLessThanOrEqual(0.03);
  });
});
