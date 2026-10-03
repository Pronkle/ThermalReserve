import { describe, expect, it } from 'vitest';
import { buildLp, compareStrategies, runPlan, solvePlan } from '../src/index';
import type { Scenario } from '../src/index';
import { cfg, cohorts, consts, designScenario } from './helpers';

const noOverride = { ...cfg, overrideRate: 0 };

/** Design fixture with flat hourly demand, so capacity ÷ 24 per hour is coverable by the fleet. */
function flatDesign(): Scenario {
  const sc = designScenario();
  sc.systemMMcfh = sc.outdoorF.map((o) => (o < -10 ? 265 : 230) / 24);
  return sc;
}

const finiteTargets = (t: number[][]) => t.flat().filter(Number.isFinite);

describe('LP (E5)', () => {
  it('buildLp emits CPLEX LP text with dynamics, capacity rows and bounds', () => {
    const sc = designScenario();
    const init = cohorts.map(() => ({ TaF: 70, TmF: 60 }));
    const lp = buildLp(sc, cohorts, cfg, 'OPTIMIZED', init, consts);
    expect(lp).toMatch(/^\\/);
    for (const s of ['Minimize', 'Subject To', 'Bounds', 'End', ' cap_3:', ' da_23_95:', ' dm_0_0:']) expect(lp).toContain(s);
  });

  it('solves the design scenario (24 × 96) under 5 s with every target ≥ floor', async () => {
    const p = await solvePlan(designScenario(), cohorts, cfg, 'OPTIMIZED', consts);
    expect(p.note).toBeUndefined();
    expect(p.solveMs!).toBeLessThan(5000);
    expect(p.targetsF).toHaveLength(24);
    expect(p.targetsF[0]).toHaveLength(96);
    const t = finiteTargets(p.targetsF);
    expect(t.length).toBeGreaterThan(0);
    for (const v of t) expect(v).toBeGreaterThanOrEqual(cfg.floorF);
    expect(p.shortfallMMcfh).toHaveLength(96);
    expect(p.shortfallMMcfd).toHaveLength(4);
    const hourly = p.shortfallMMcfh!.reduce((a, b) => a + b, 0);
    const daily = p.shortfallMMcfd!.reduce((a, b) => a + b, 0);
    expect(hourly).toBeCloseTo(daily, 9);
  });

  it('generous capacity: OPTIMIZED returns all-normal targets', async () => {
    const p = await solvePlan(designScenario(), cohorts, { ...cfg, capacityMMcfd: 400 }, 'OPTIMIZED', consts);
    expect(p.note).toBeUndefined();
    expect(finiteTargets(p.targetsF)).toHaveLength(0);
    expect(p.shortfallMMcfh!.every((s) => s === 0)).toBe(true);
  });

  it('tight daily capacity: OPTIMIZED covers it and beats SUSTAIN_STAGGER on net savings and degree-hours', async () => {
    const sc = designScenario(); // 265 MMcf/day with the hourly demand shape
    const c2 = { ...noOverride, capacityMMcfd: 264 };
    const p = await solvePlan(sc, cohorts, c2, 'OPTIMIZED', consts);
    expect(p.shortfallMMcfd!.every((s) => s === 0)).toBe(true);
    const opt = runPlan(sc, cohorts, c2, p, consts).totals;
    const sus = compareStrategies(sc, cohorts, c2, consts).SUSTAIN_STAGGER.totals;
    expect(opt.uncoveredShortfallMMcf).toBeLessThan(1e-6);
    expect(opt.netSavedMMcf).toBeGreaterThanOrEqual(sus.netSavedMMcf);
    expect(opt.degreeHoursBelowNormal).toBeLessThan(sus.degreeHoursBelowNormal);
  });

  it('capacity the fleet cannot cover: daily slack is reported and matches the run', async () => {
    const sc = designScenario();
    const c2 = { ...noOverride, capacityMMcfd: 262 };
    const p = await solvePlan(sc, cohorts, c2, 'OPTIMIZED', consts);
    const slack = p.shortfallMMcfd!.reduce((a, b) => a + b, 0);
    expect(slack).toBeGreaterThan(0);
    const run = runPlan(sc, cohorts, c2, p, consts).totals;
    expect(Math.abs(run.uncoveredShortfallMMcf - slack)).toBeLessThan(0.1);
  });

  it('MAX_RELIEF saves more net gas than SUSTAIN_STAGGER within the same depth limit', async () => {
    const sc = flatDesign();
    const c2 = { ...noOverride, capacityMMcfd: 400 };
    const p = await solvePlan(sc, cohorts, c2, 'MAX_RELIEF', consts);
    expect(p.note).toBeUndefined();
    const max = runPlan(sc, cohorts, c2, p, consts).totals;
    const sus = compareStrategies(sc, cohorts, c2, consts).SUSTAIN_STAGGER.totals;
    expect(max.netSavedMMcf).toBeGreaterThan(sus.netSavedMMcf);
  });

  // Bounds follow the reachable baseline and capacity has slack, so the LP is feasible by construction;
  // the fallback path is exercised with a malformed input instead.
  it('solver error returns the rule-based fallback', async () => {
    const sc = designScenario();
    sc.outdoorF[50] = NaN;
    const p = await solvePlan(sc, cohorts, cfg, 'OPTIMIZED', consts);
    expect(p.note).toBe('Rule-based fallback');
    expect(p.strategy).toBe('SUSTAIN_STAGGER');
  });

  it('timeout returns the rule-based fallback', async () => {
    const p = await solvePlan(designScenario(), cohorts, cfg, 'OPTIMIZED', consts, { timeoutMs: 0 });
    expect(p.note).toBe('Rule-based fallback');
  });

  it('re-solves from a mid-run hour, leaving earlier hours untouched', async () => {
    const p = await solvePlan(designScenario(), cohorts, cfg, 'OPTIMIZED', consts, { fromHour: 40 });
    expect(p.note).toBeUndefined();
    for (const row of p.targetsF) for (let h = 0; h < 40; h++) expect(Number.isNaN(row[h])).toBe(true);
  });

  it('solves without falling back across re-solve hours and capacities', async () => {
    const sc = designScenario();
    for (const capacityMMcfd of [262, 264, 400]) {
      for (const fromHour of [0, 12, 30, 40, 61, 83]) {
        const p = await solvePlan(sc, cohorts, { ...cfg, capacityMMcfd }, 'OPTIMIZED', consts, { fromHour });
        expect(p.note, `cap ${capacityMMcfd} from ${fromHour}`).toBeUndefined();
      }
    }
  }, 20000);
});
