import { describe, expect, it } from 'vitest';
import { anchorageSanity, buildCohorts, validateConEdLike, validateSoCalLike } from '../src/index';
import type { CohortSpec } from '../src/index';
import { cohorts, consts, spec } from './helpers';

// Candidate tuning inside the allowed ranges (Ca 1,500–8,000; Ham ×1–6; τ 15–60 h). Not yet in data/cohort_spec.json.
function tunedSpec(): CohortSpec {
  const s: CohortSpec = JSON.parse(JSON.stringify(spec));
  s.heating[0].caBtuPerF = 1500;
  s.heating[1].caBtuPerF = 3000;
  s.hamMult = 1.5;
  s.mass[0].tauMassH = 60;
  s.mass[1].tauMassH = 60;
  return s;
}

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

  it('tuned candidate: ConEd retention passes; SoCal daily is below band (known gap)', () => {
    const c = buildCohorts(tunedSpec(), consts.uaMeanBtuHPerF);
    const coned = validateConEdLike(c, consts);
    expect(coned.pass).toBe(true);
    const socal = validateSoCalLike(c, consts);
    // Best reachable inside the allowed ranges is ~1.35%; band floor is 1.5%. Reported to H2, not hidden.
    expect(socal.dailyPct).toBeGreaterThan(1.1);
    expect(socal.pass).toBe(false);
  });
});
