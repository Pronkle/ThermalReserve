import { describe, expect, it } from 'vitest';
import { compareStrategies, planBaseline, planSustainStagger, runPlan } from '../src/index';
import type { CohortParams, Scenario } from '../src/index';
import { cfg, cohorts, consts, designScenario } from './helpers';

function constantScenario(outdoorF: number, hours = 72): Scenario {
  return {
    id: 'const', name: 'const', kind: 'synthetic', startIso: '2026-01-14T00:00:00-09:00', hours,
    outdoorF: new Array(hours).fill(outdoorF), systemMMcfh: new Array(hours).fill(10),
    eventStartHour: 12, eventEndHour: 60, capacityMMcfd: 300, capacityNote: '', source: '',
  };
}

describe('strategies and runner (E3)', () => {
  it('average home at −20°F, 70°F, no night setback: 0.85–1.15 Mcf/day', () => {
    const avg = cohorts.filter((c) => c.key.includes('-steady-average-'));
    const share = avg.reduce((s, c) => s + c.share, 0);
    const mix: CohortParams[] = avg.map((c, i) => ({ ...c, id: i, share: c.share / share }));
    const sc = constantScenario(-20);
    const r = runPlan(sc, mix, { ...cfg, exemptShare: 0, overrideRate: 0, enrolledHomes: 1000 }, planBaseline(sc, mix), consts);
    const lastDayCf = r.hours.slice(48, 72).reduce((s, h) => s + h.baselineFleetGasMMcfh, 0) * 1e6 / 1000;
    const mcf = lastDayCf / 1000;
    expect(mcf).toBeGreaterThanOrEqual(0.85);
    expect(mcf).toBeLessThanOrEqual(1.15);
  });

  it('NAIVE_4H shows a recovery spike after each event window', () => {
    const sc = designScenario();
    const r = compareStrategies(sc, cohorts, cfg, consts);
    // Event windows 06:00–10:00 on each event day; the hour after is 10:00.
    for (const h of [34, 58, 82]) {
      expect(r.NAIVE_4H.hours[h].fleetGasMMcfh, `hour ${h}`).toBeGreaterThan(r.BASELINE.hours[h].fleetGasMMcfh);
    }
  });

  it('SUSTAIN_STAGGER never drops any cohort below floor', () => {
    const sc = designScenario();
    const r = runPlan(sc, cohorts, cfg, planSustainStagger(sc, cohorts, cfg), consts);
    for (const h of r.hours) for (const c of h.cohorts) expect(c.TaF).toBeGreaterThanOrEqual(cfg.floorF - 1e-6);
    expect(r.totals.netSavedMMcf).toBeGreaterThan(0);
  });

  it('compareStrategies on 96 hours runs under 500 ms', () => {
    const sc = designScenario();
    compareStrategies(sc, cohorts, cfg, consts);
    const t0 = Date.now();
    compareStrategies(sc, cohorts, cfg, consts);
    expect(Date.now() - t0).toBeLessThan(500);
  });
});
