// D0 acceptance: every data/ JSON file type-checks against the contract types (compile time,
// via `tsc --noEmit`) and satisfies the contract's value rules (run time, via vitest).
import { describe, expect, it } from 'vitest';

import constantsJson from '../constants.json';
import cohortSpecJson from '../cohort_spec.json';
import demandShapeJson from '../demand_shape.json';
import anchorsJson from '../anchors.json';
import designJson from '../scenarios/design.json';

import {
  REQUIRED_CONSTANT_KEYS,
  type Anchor,
  type CohortSpec,
  type ConstantEntry,
  type RequiredConstantKey,
  type Scenario,
  type Widen,
} from './contract-types';

// ---- compile-time checks: these assignments fail `tsc` if a field is missing or mistyped ----
const constants: Record<RequiredConstantKey, Widen<ConstantEntry>> & Record<string, Widen<ConstantEntry>> = constantsJson;
const cohortSpec: Widen<CohortSpec> = cohortSpecJson;
const demandShape: number[] = demandShapeJson;
const anchors: Widen<Anchor>[] = anchorsJson;
const scenarios: Widen<Scenario>[] = [designJson];

const LABELS = ['sourced', 'derived', 'assumed'];
const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

describe('constants.json', () => {
  it('has every required key', () => {
    for (const k of REQUIRED_CONSTANT_KEYS) expect(constants, k).toHaveProperty(k);
  });

  it('every entry has a finite value, a unit, a valid label and a source', () => {
    for (const [k, c] of Object.entries(constants)) {
      const values = Array.isArray(c.value) ? c.value : [c.value];
      for (const v of values) expect(Number.isFinite(v), k).toBe(true);
      expect(c.unit.length, k).toBeGreaterThan(0);
      expect(LABELS, k).toContain(c.label);
      expect(c.source.length, k).toBeGreaterThan(0);
    }
  });

  it('bands are [low, high] pairs', () => {
    for (const k of ['validation_coned_band', 'validation_socal_daily_band'] as const) {
      const v = constants[k].value;
      expect(Array.isArray(v) && v.length === 2 && v[0] < v[1], k).toBe(true);
    }
  });

  it('fixed values match AGENTS.md Section 6', () => {
    expect(constants.floor_min_f.value).toBe(60);
    expect(constants.max_depth_default_f.value).toBe(5);
    expect(constants.exempt_share.value).toBe(0.08);
    expect(constants.tier2_effectiveness.value).toBe(0.3);
    expect(constants.override_rate.value).toBe(0.06);
    expect(constants.validation_coned_retention_target.value).toBe(0.48);
  });

  it('ua_mean_btuh_per_f equals its stated derivation within 0.1%', () => {
    const v = (k: RequiredConstantKey): number => constants[k].value as number;
    const ua = (v('space_heat_share') * v('avg_home_mcf_year') * 1000 * v('hhv_btu_per_cf') * v('eta_furnace')) /
      (24 * v('hdd_annual'));
    expect(Math.abs(v('ua_mean_btuh_per_f') - ua) / ua).toBeLessThan(0.001);
  });
});

describe('cohort_spec.json', () => {
  it('each factor has shares summing to 1', () => {
    for (const f of [cohortSpec.heating, cohortSpec.schedule, cohortSpec.envelope, cohortSpec.mass]) {
      expect(sum(f.map((x) => x.share))).toBeCloseTo(1, 9);
    }
  });

  it('gives 24 cohorts with furnace and boiler heating', () => {
    const n = cohortSpec.heating.length * cohortSpec.schedule.length * cohortSpec.envelope.length * cohortSpec.mass.length;
    expect(n).toBe(24);
    expect(cohortSpec.heating.map((h) => h.key)).toEqual(['furnace', 'boiler']);
  });
});

describe('demand_shape.json', () => {
  it('has 24 positive fractions summing to 1.000', () => {
    expect(demandShape).toHaveLength(24);
    for (const x of demandShape) expect(x).toBeGreaterThan(0);
    expect(Math.abs(sum(demandShape) - 1)).toBeLessThan(5e-4);
  });
});

describe('anchors.json', () => {
  it('has 12 anchors with weights summing to 1, all in Southcentral Alaska', () => {
    expect(anchors).toHaveLength(12);
    expect(sum(anchors.map((a) => a.weight))).toBeCloseTo(1, 9);
    for (const a of anchors) {
      expect(a.lat, a.name).toBeGreaterThan(60);
      expect(a.lat, a.name).toBeLessThan(62);
      expect(a.lon, a.name).toBeGreaterThan(-152);
      expect(a.lon, a.name).toBeLessThan(-148.5);
    }
  });
});

describe('scenarios', () => {
  for (const sc of scenarios) {
    describe(sc.id, () => {
      it('has a valid kind and 96 hourly series', () => {
        expect(['replay', 'synthetic']).toContain(sc.kind);
        expect(sc.hours).toBe(96);
        expect(sc.outdoorF).toHaveLength(sc.hours);
        expect(sc.systemMMcfh).toHaveLength(sc.hours);
        for (const x of [...sc.outdoorF, ...sc.systemMMcfh]) expect(Number.isFinite(x)).toBe(true);
      });

      it('has the event at hours 12–84 and a parseable start', () => {
        expect(sc.eventStartHour).toBe(12);
        expect(sc.eventEndHour).toBe(84);
        expect(Number.isNaN(Date.parse(sc.startIso))).toBe(false);
      });

      it('sets capacity 3 MMcf/day below the peak day (±1 for rounding)', () => {
        let peak = 0;
        for (let d = 0; d < sc.hours / 24; d++) peak = Math.max(peak, sum(sc.systemMMcfh.slice(d * 24, d * 24 + 24)));
        expect(Math.abs(sc.capacityMMcfd - (peak - 3))).toBeLessThanOrEqual(1);
        expect(sc.capacityNote).toMatch(/hypothetical/i);
      });
    });
  }

  it('design: 10°F lead-in, cold window averages −20°F, eases to 5°F', () => {
    const d = designJson;
    expect(d.outdoorF.slice(0, 12).every((t) => t === 10)).toBe(true);
    expect(sum(d.outdoorF.slice(12, 84)) / 72).toBeCloseTo(-20, 0);
    expect(Math.min(...d.outdoorF.slice(12, 84))).toBeGreaterThanOrEqual(-25);
    expect(Math.max(...d.outdoorF.slice(12, 84))).toBeLessThanOrEqual(-15);
    expect(d.outdoorF[95]).toBe(5);
  });
});
