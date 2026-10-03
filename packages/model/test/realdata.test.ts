import { describe, expect, it } from 'vitest';
import { anchorageSanity, buildCohorts, compareStrategies, loadConstants, solvePlan, whatIf } from '../src/index';
import type { CohortSpec, ConstantsJson, Scenario } from '../src/index';
import constantsJson from '../../../data/constants.json';
import cohortSpecJson from '../../../data/cohort_spec.json';
import designJson from '../../../data/scenarios/design.json';

// Smoke test against DATA's live files (fixtures pin the numbers; this catches drift between them).
const consts = loadConstants(constantsJson as unknown as ConstantsJson);
const cohorts = buildCohorts(cohortSpecJson as unknown as CohortSpec, consts.uaMeanBtuHPerF);
const sc = designJson as unknown as Scenario;
const cfg = { enrolledHomes: 25000, exemptShare: consts.exemptShare, floorF: consts.floorDefaultF, maxDepthF: consts.maxDepthDefaultF, overrideRate: consts.overrideRate, capacityMMcfd: sc.capacityMMcfd, seed: 42 };

describe('real data files', () => {
  it('design scenario runs through every strategy and the LP', async () => {
    expect(sc.hours).toBe(96);
    const r = compareStrategies(sc, cohorts, cfg, consts);
    expect(r.BASELINE.hours).toHaveLength(96);
    expect(r.SUSTAIN_STAGGER.totals.netSavedMMcf).toBeGreaterThan(0);
    const p = await solvePlan(sc, cohorts, cfg, 'OPTIMIZED', consts);
    expect(p.note).toBeUndefined();
  });

  // Expected values are computed from constants.json (H1, 2026-10-03), so a recalibrated UA moves them too.
  it('Anchorage sanity within ±15% of UA × 90 × 24 ÷ (eta × HHV)', () => {
    const eta = cohorts.reduce((s, c) => s + c.share * c.eta, 0);
    const expected = (consts.uaMeanBtuHPerF * 90 * 24) / (eta * consts.hhvBtuPerCf) / 1000;
    const a = anchorageSanity(cohorts, consts).mcfPerHomeDay;
    expect(Math.abs(a - expected) / expected).toBeLessThanOrEqual(0.15);
  });

  it('what-if for 25,000 homes at 5°F within ±3% of UA × 5 × 24 ÷ (eta × HHV) × homes', () => {
    const homes = 25000;
    const expected = ((consts.uaMeanBtuHPerF * 5 * 24) / (consts.etaFurnace * consts.hhvBtuPerCf)) * homes / 1e6;
    const w = whatIf({ participationPct: (homes / consts.customers) * 100, setbackF: 5, outdoorF: -20, days: 3, tier2Pct: 0 }, consts);
    expect(Math.abs(w.mmcfPerDay - expected) / expected).toBeLessThanOrEqual(0.03);
  });
});
