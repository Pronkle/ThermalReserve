import { describe, expect, it } from 'vitest';
import { anchorageSanity, buildCohorts, compareStrategies, gasDays, inWater, loadConstants, runPlan, sampleHomes, solvePlan, whatIf } from '../src/index';
import type { Anchor, CohortSpec, ConstantsJson, Scenario, WaterMask } from '../src/index';
import constantsJson from '../../../data/constants.json';
import cohortSpecJson from '../../../data/cohort_spec.json';
import designJson from '../../../data/scenarios/design.json';
import feb2024Json from '../../../data/scenarios/feb2024.json';
import anchorsJson from '../../../data/anchors.json';
import waterMaskJson from '../../../data/water_mask.json';

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

  it('feb2024 demo preset: OPTIMIZED relieves the over-capacity day and moves snapback to a day with headroom', async () => {
    const feb = feb2024Json as unknown as Scenario;
    const c = { ...cfg, overrideRate: 0, capacityMMcfd: feb.capacityMMcfd };
    const p = await solvePlan(feb, cohorts, c, 'OPTIMIZED', consts);
    expect(p.note).toBeUndefined();
    expect(p.solveMs!).toBeLessThan(5000);
    const opt = gasDays(runPlan(feb, cohorts, c, p, consts));
    const sus = gasDays(compareStrategies(feb, cohorts, c, consts).SUSTAIN_STAGGER);
    const tight = opt.filter((d) => d.overCapacityWithoutProgram);
    expect(tight.length).toBeGreaterThan(0);
    for (const d of tight) {
      expect(d.reliefMMcf).toBeGreaterThan(sus[d.day].reliefMMcf);
      expect(d.uncoveredMMcf).toBeLessThan(sus[d.day].uncoveredMMcf);
    }
    // Snapback (negative relief) only lands on days that stay under capacity.
    for (const d of opt) if (d.reliefMMcf < 0) expect(d.uncoveredMMcf).toBe(0);
  });

  it('real water mask: no sample home in water, and only homes that were in water move', () => {
    const mask = waterMaskJson as unknown as WaterMask;
    const anchors = anchorsJson as unknown as Anchor[];
    for (const a of anchors) expect(inWater(a.lat, a.lon, mask), a.name).toBe(false);
    const feb = feb2024Json as unknown as Scenario;
    const plain = sampleHomes(cohorts, anchors, 1000, cfg, feb);
    const masked = sampleHomes(cohorts, anchors, 1000, cfg, feb, mask);
    let moved = 0;
    masked.forEach((h, i) => {
      expect(inWater(h.lat, h.lon, mask)).toBe(false);
      if (h.lat !== plain[i].lat || h.lon !== plain[i].lon) { moved++; expect(inWater(plain[i].lat, plain[i].lon, mask)).toBe(true); }
    });
    expect(moved).toBeGreaterThan(0);
  });

  it('with overrides on, the plan\'s shortfall matches the run (a "covered" plan stays covered)', async () => {
    const feb = feb2024Json as unknown as Scenario;
    for (const enrolledHomes of [25000, 50000]) {
      const c = { ...cfg, enrolledHomes, capacityMMcfd: feb.capacityMMcfd }; // overrideRate from constants (0.06)
      const p = await solvePlan(feb, cohorts, c, 'OPTIMIZED', consts);
      const planned = p.shortfallMMcfd!.reduce((a, b) => a + b, 0);
      const actual = gasDays(runPlan(feb, cohorts, c, p, consts)).reduce((a, d) => a + d.uncoveredMMcf, 0);
      expect(Math.abs(planned - actual), `${enrolledHomes} homes`).toBeLessThan(0.05);
      if (planned === 0) expect(actual).toBeLessThan(1e-6);
    }
  });
});
