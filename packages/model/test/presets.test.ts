import { describe, expect, it } from 'vitest';
import { buildCohorts, compareStrategies, coverageTable, evaluateLoss, loadConstants, pressureIndex, pressureSummary } from '../src/index';
import type { CohortSpec, ConstantsJson, Scenario } from '../src/index';
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

  it('Stress: the fleet curtails less gas than No program and than Staggered, but cannot remove it', async () => {
    const st = preset('stress');
    const r = await evaluateLoss(feb, cohorts, cfgFor(st.enrolledHomes), consts, raw, st.lostMMcfd, st.reserveIdx);
    expect(r.plan.note).toBeUndefined();
    expect(r.planned.curtailedMMcf).toBeGreaterThan(0);
    expect(r.planned.curtailedMMcf).toBeLessThan(r.noProgram.curtailedMMcf);
    expect(r.planned.hoursBelowZero).toBeLessThan(r.noProgram.hoursBelowZero);
    expect(r.noProgram.curtailedMMcf).toBeCloseTo(40.15, 1);
    expect(r.planned.curtailedMMcf).toBeCloseTo(34.43, 1);
    const stag = compareStrategies(feb, cohorts, { ...cfgFor(st.enrolledHomes), capacityMMcfd: r.pressure.rMMcfd }, consts).SUSTAIN_STAGGER;
    expect(r.planned.curtailedMMcf).toBeLessThan(pressureSummary(pressureIndex(stag.hours.map((h) => h.systemMMcfh), r.pressure) as number[], r.pressure).curtailedMMcf);
  }, 60000);
});
