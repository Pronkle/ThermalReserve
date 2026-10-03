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

  it('Anchorage sanity and what-if stay near their targets', () => {
    const a = anchorageSanity(cohorts, consts).mcfPerHomeDay;
    expect(a).toBeGreaterThan(0.85);
    expect(a).toBeLessThan(1.15);
    const w = whatIf({ participationPct: (25000 / consts.customers) * 100, setbackF: 5, outdoorF: -20, days: 3, tier2Pct: 0 }, consts);
    expect(Math.abs(w.mmcfPerDay - 1.4)).toBeLessThanOrEqual(0.05);
  });
});
