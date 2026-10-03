import { describe, expect, it } from 'vitest';
import { buildCohorts, sampleHomes } from '../src/index';
import type { Anchor } from '../src/index';
import { cfg, consts, designScenario, spec } from './helpers';

const anchors: Anchor[] = [
  { name: 'Downtown', lat: 61.2176, lon: -149.8997, weight: 0.5 },
  { name: 'Eagle River', lat: 61.3214, lon: -149.5681, weight: 0.3 },
  { name: 'Wasilla', lat: 61.5814, lon: -149.4394, weight: 0.2 },
];

function km(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const r = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

describe('fleet (E2)', () => {
  const cohorts = buildCohorts(spec, consts.uaMeanBtuHPerF);

  it('shares sum to 1 and share-weighted UA hits the target', () => {
    expect(Math.abs(cohorts.reduce((s, c) => s + c.share, 0) - 1)).toBeLessThan(1e-9);
    const ua = cohorts.reduce((s, c) => s + c.share * c.UA, 0);
    expect(Math.abs(ua - consts.uaMeanBtuHPerF) / consts.uaMeanBtuHPerF).toBeLessThan(0.001);
  });

  it('steady-state conductance of each cohort equals UA', () => {
    for (const c of cohorts) {
      const g = c.Uao + (c.Ham * c.Umo) / (c.Ham + c.Umo);
      expect(g).toBeCloseTo(c.UA, 9);
      expect(c.Umo).toBeGreaterThan(0);
    }
  });

  it('sampleHomes is deterministic and stays within 3 km of an anchor', () => {
    const sc = designScenario();
    const a = sampleHomes(cohorts, anchors, 1000, cfg, sc);
    const b = sampleHomes(cohorts, anchors, 1000, cfg, sc);
    expect(a).toEqual(b);
    for (const h of a) {
      const near = Math.min(...anchors.map((x) => km(x, h)));
      expect(near).toBeLessThanOrEqual(3);
      if (h.overrideHour !== null) {
        expect(h.exempt).toBe(false);
        expect(h.overrideHour).toBeGreaterThanOrEqual(sc.eventStartHour);
        expect(h.overrideHour).toBeLessThanOrEqual(sc.eventEndHour);
      }
    }
    const exempt = a.filter((h) => h.exempt).length / a.length;
    expect(exempt).toBeGreaterThan(0.05);
    expect(exempt).toBeLessThan(0.11);
  });
});
