import { describe, expect, it } from 'vitest';
import { buildCohorts, inWater, sampleHomes } from '../src/index';
import type { Anchor, WaterMask } from '../src/index';
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

describe('sampleHomes water mask', () => {
  const cohorts = buildCohorts(spec, consts.uaMeanBtuHPerF);
  // A box covering the western half of the Downtown anchor's jitter circle.
  const mask: WaterMask = [[[61.20, -149.96], [61.24, -149.96], [61.24, -149.8997], [61.20, -149.8997]]];

  it('inWater handles inside, outside and multiple rings', () => {
    expect(inWater(61.22, -149.93, mask)).toBe(true);
    expect(inWater(61.22, -149.88, mask)).toBe(false);
    expect(inWater(61.5, -149.93, [...mask, [[61.4, -150], [61.6, -150], [61.6, -149.9], [61.4, -149.9]]])).toBe(true);
  });

  it('moves only homes in water, keeps them near their anchor, and is deterministic', () => {
    const sc = designScenario();
    const plain = sampleHomes(cohorts, anchors, 1000, cfg, sc);
    const masked = sampleHomes(cohorts, anchors, 1000, cfg, sc, mask);
    expect(sampleHomes(cohorts, anchors, 1000, cfg, sc, mask)).toEqual(masked);
    let moved = 0;
    plain.forEach((h, i) => {
      const m = masked[i];
      expect(inWater(m.lat, m.lon, mask)).toBe(false);
      expect({ ...m, lat: 0, lon: 0 }).toEqual({ ...h, lat: 0, lon: 0 });
      if (inWater(h.lat, h.lon, mask)) moved++;
      else expect(m).toEqual(h);
      expect(Math.min(...anchors.map((x) => km(x, m)))).toBeLessThanOrEqual(3);
    });
    expect(moved).toBeGreaterThan(0);
  });
});
