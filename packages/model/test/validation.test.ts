import { describe, expect, it } from 'vitest';
import { anchorageSanity, buildCohorts, loadConstants, validateConEdLike, validateSoCalLike } from '../src/index';
import type { CohortSpec, ConstantsJson } from '../src/index';
import { cohorts, consts } from './helpers';
import constantsJson from '../../../data/constants.json';
import cohortSpecJson from '../../../data/cohort_spec.json';

// The tuned parameters live in data/cohort_spec.json (ENGINE, 2026-10-03, H2-approved): furnace Ca 1,500, boiler Ca 3,000,
// hamMult 1.5, tauMassH 40/60, all inside the allowed ranges (Ca 1,500–8,000; Ham ×1–6; τ 15–60 h).
const realConsts = loadConstants(constantsJson as unknown as ConstantsJson);
const realCohorts = buildCohorts(cohortSpecJson as unknown as CohortSpec, realConsts.uaMeanBtuHPerF);

describe('validation (E4)', () => {
  it('Anchorage sanity: about 1.0 Mcf per home per day at −20°F', () => {
    const v = anchorageSanity(cohorts, consts).mcfPerHomeDay;
    expect(v).toBeGreaterThan(0.85);
    expect(v).toBeLessThan(1.15);
  });

  it('SoCal fit reproduces the 15.1% event-hour reduction with r in (0, 1]', () => {
    const v = validateSoCalLike(cohorts, consts);
    expect(v.eventPct).toBeCloseTo(consts.socalEventPct, 9);
    expect(v.responseRate).toBeGreaterThan(0);
    expect(v.responseRate).toBeLessThanOrEqual(1);
    expect(v.hourly).toHaveLength(24);
  });

  it('event day shows snapback: gas above baseline in the hour after the event', () => {
    const v = validateConEdLike(cohorts, consts);
    expect(v.hourly[10].eventCf).toBeGreaterThan(v.hourly[10].baselineCf);
    expect(v.hourly[7].eventCf).toBeLessThan(v.hourly[7].baselineCf);
  });

  it('tuned data/cohort_spec.json: ConEd retention passes; SoCal daily is a stated gap below the band', () => {
    const coned = validateConEdLike(realCohorts, realConsts);
    expect(coned.pass).toBe(true);
    expect(Math.abs(coned.retention - realConsts.conedRetentionTarget)).toBeLessThan(0.03);
    const socal = validateSoCalLike(realCohorts, realConsts);
    // Best reachable inside the allowed ranges is ~1.35%; band floor is 1.5%. Reported honestly (H2 decision), not hidden.
    expect(socal.pass).toBe(false);
    expect(socal.dailyPct).toBeGreaterThan(1.0);
    expect(socal.dailyPct).toBeLessThan(realConsts.socalDailyBand[0]);
  });
});
