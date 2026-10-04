// D0 acceptance: every data/ JSON file type-checks against the contract types (compile time,
// via `tsc --noEmit`) and satisfies the contract's value rules (run time, via vitest).
import { describe, expect, it } from 'vitest';

import constantsJson from '../constants.json';
import cohortSpecJson from '../cohort_spec.json';
import demandShapeJson from '../demand_shape.json';
import anchorsJson from '../anchors.json';
import designJson from '../scenarios/design.json';
import feb2024Json from '../scenarios/feb2024.json';
import lastwinterJson from '../scenarios/lastwinter.json';
import systemFitJson from '../system_fit.json';
import waterMaskJson from '../water_mask.json';
import calibrationJson from '../calibration.json';
import presetsJson from '../presets.json';
import ticksJson from '../deliverability_ticks.json';
import forecastErrorJson from '../forecast_error.json';
import { usableLinepackMMcf, type ForecastRun } from '@thermal-reserve/model';

import {
  REQUIRED_CONSTANT_KEYS,
  type Anchor,
  type CohortSpec,
  type ConstantEntry,
  type DeliverabilityTick,
  type Preset,
  type RequiredConstantKey,
  type Scenario,
  type Widen,
} from './contract-types';

// ---- compile-time checks: these assignments fail `tsc` if a field is missing or mistyped ----
const constants: Record<RequiredConstantKey, Widen<ConstantEntry>> & Record<string, Widen<ConstantEntry>> = constantsJson;
const cohortSpec: Widen<CohortSpec> = cohortSpecJson;
const demandShape: number[] = demandShapeJson;
const anchors: Widen<Anchor>[] = anchorsJson;
const scenarios: Widen<Scenario>[] = [designJson, feb2024Json, lastwinterJson];
const presets: Widen<Preset>[] = presetsJson;
const ticks: Widen<DeliverabilityTick>[] = ticksJson;

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

describe('calibration.json (D1)', () => {
  it('comes from Anchorage International via ACIS, with the raw file saved', async () => {
    const { readFileSync } = await import('node:fs');
    const raw = JSON.parse(readFileSync(new URL('../raw/acis_panc_1996_2025.json', import.meta.url), 'utf8')) as {
      meta: { name: string }; data: unknown[];
    };
    expect(raw.meta.name).toMatch(/ANCHORAGE.*INTERNATIONAL/);
    expect(calibrationJson.station.name).toBe(raw.meta.name);
    expect(calibrationJson.hdd.perYear).toHaveLength(30);
  });

  it('constants.json carries the calibrated HDD and UA', () => {
    expect(constants.hdd_annual.value).toBe(calibrationJson.hdd.annualMean);
    expect(constants.ua_mean_btuh_per_f.value).toBe(calibrationJson.ua.valueBtuHPerF);
    expect(constants.hdd_annual.label).toBe('derived');
  });
});

describe('system_fit.json and scenario demand (D2)', () => {
  const { a, b, inputs } = systemFitJson;
  const dayDemand = (hdd: number): number => a + b * hdd;

  it('reproduces both anchors: January 2024 total and the record day', () => {
    const janBcf = sum(inputs.janDailyHdd.map(dayDemand)) / 1000;
    expect(Math.abs(janBcf - (constants.jan2024_total_bcf.value as number))).toBeLessThan(1e-3);
    expect(Math.abs(dayDemand(inputs.recordDayHdd) - (constants.record_day_mmcf.value as number))).toBeLessThan(0.01);
    expect(inputs.janDailyHdd).toHaveLength(31);
    expect(systemFitJson.label).toBe('derived');
  });

  it('record day is the highest-HDD day from Jan 30 to Feb 2, 2024 (D2 assumption)', () => {
    expect(inputs.recordDay >= '2024-01-30' && inputs.recordDay <= '2024-02-02').toBe(true);
  });

  for (const sc of scenarios) {
    const days = Array.from({ length: sc.hours / 24 }, (_, d) => sc.systemMMcfh.slice(24 * d, 24 * d + 24));
    const coldest = days.reduce((m, d) => (sum(d) > sum(m) ? d : m));

    it(`${sc.id}: each day's hourly demand sums to the fitted daily total, peak hour ≈ 5.4%`, () => {
      for (const d of days) expect(Math.max(...d) / sum(d)).toBeCloseTo(Math.max(...demandShape), 3);
    });

    it(`${sc.id}: capacity note states a daily limit and the linepack/storage assumption`, () => {
      expect(sc.capacityNote).toMatch(/daily limit/i);
      expect(sc.capacityNote).toMatch(/assumed/i);
    });

    if (sc.kind === 'replay') {
      it(`${sc.id}: coldest day is 230–290 MMcf (D2 sanity range)`, () => {
        expect(sum(coldest)).toBeGreaterThanOrEqual(230);
        expect(sum(coldest)).toBeLessThanOrEqual(290);
      });
    } else {
      // design (−20°F mean, HDD 85) is colder than the record day (HDD 77), so its coldest day
      // exceeds the 230–290 range; flagged to H1. Check it equals the fit instead.
      it(`${sc.id}: coldest day equals the fit at HDD 85 (above the 230–290 range by design)`, () => {
        expect(sum(coldest)).toBeCloseTo(dayDemand(85), 1);
      });
    }
  }
});

describe('water_mask.json', () => {
  // ENGINE's WaterMask: rings of [lat, lon]; a point is water if inside any ring.
  const mask: [number, number][][] = waterMaskJson as [number, number][][];
  const inRing = (lat: number, lon: number, ring: [number, number][]): boolean => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [yi, xi] = ring[i];
      const [yj, xj] = ring[j];
      if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };

  it('is a non-empty array of closed [lat, lon] rings near the anchors', () => {
    expect(mask.length).toBeGreaterThan(0);
    for (const ring of mask) {
      expect(ring.length).toBeGreaterThanOrEqual(4);
      expect(ring[0]).toEqual(ring[ring.length - 1]);
      for (const [lat, lon] of ring) {
        expect(lat).toBeGreaterThan(60);
        expect(lat).toBeLessThan(62);
        expect(lon).toBeGreaterThan(-152);
        expect(lon).toBeLessThan(-148.5);
      }
    }
  });

  it('leaves every anchor on land', () => {
    for (const a of anchors) expect(mask.some((r) => inRing(a.lat, a.lon, r)), a.name).toBe(false);
  });

  it('covers the water points found in the 2026-10-03 check (Knik Arm, Lake Hood, tidal flats)', () => {
    for (const [lat, lon] of [[61.2309, -149.913], [61.1799, -149.961], [61.2018, -149.9533], [61.2098, -149.9239]]) {
      expect(mask.some((r) => inRing(lat, lon, r)), `${lat},${lon}`).toBe(true);
    }
  });
});

describe('pressure constants, presets and ticks (D-A1)', () => {
  const v = (k: RequiredConstantKey): number => constants[k].value as number;

  it('fixed values match AGENTS.md Section 6', () => {
    expect(v('headroom_2024_mmcfd')).toBe(10);
    expect(v('reserve_default_idx')).toBe(10);
    expect(v('reserve_min_idx')).toBe(5);
    expect(v('forecast_buffer_sigma_default')).toBe(0.75);
    expect(v('forecast_lag_h')).toBe(1);
    expect(v('replan_interval_h')).toBe(6);
    expect(v('drift_temp_f')).toBe(1.5);
    expect(v('drift_hours')).toBe(2);
    expect(v('drift_pressure_idx')).toBe(5);
    expect(v('drift_fade_h')).toBe(12);
  });

  it('deliverability_2024_mmcfd = feb2024 peak gas day + headroom', () => {
    let peak = 0;
    for (let d = 0; d < feb2024Json.hours / 24; d++) peak = Math.max(peak, sum(feb2024Json.systemMMcfh.slice(d * 24, d * 24 + 24)));
    expect(Math.abs(v('deliverability_2024_mmcfd') - (peak + v('headroom_2024_mmcfd')))).toBeLessThan(0.05);
    expect(constants.deliverability_2024_mmcfd.label).toBe('derived');
  });

  it('linepack_usable_mmcf equals usableLinepackMMcf at the 2024 rate within 0.01', () => {
    expect(Math.abs(v('linepack_usable_mmcf') - usableLinepackMMcf(v('deliverability_2024_mmcfd'), demandShape))).toBeLessThan(0.01);
  });

  it('demand_sensitivity_mmcfd_per_f is system_fit.json b', () => {
    expect(v('demand_sensitivity_mmcfd_per_f')).toBe(systemFitJson.b);
  });

  it('presets: Near-miss and Stress on known scenarios, 25,000 homes, default reserve', () => {
    expect(presets.map((p) => p.id)).toEqual(['nearmiss', 'stress']);
    for (const p of presets) {
      expect(scenarios.map((s) => s.id)).toContain(p.scenarioId);
      expect(p.enrolledHomes).toBe(25000);
      expect(p.reserveIdx).toBe(v('reserve_default_idx'));
      expect(p.lostMMcfd).toBeGreaterThanOrEqual(0);
      expect(p.lostMMcfd).toBeLessThanOrEqual(17.5);
      expect(p.lostMMcfd % 0.5).toBe(0);
      expect(typeof p.provisional).toBe('boolean');
    }
    expect(presets[1].lostMMcfd).toBe(15);
    expect(presets[1].lostMMcfd).toBeGreaterThan(presets[0].lostMMcfd);
  });

  it('deliverability ticks: 0, Near-miss and Stress, each labeled and sourced', () => {
    expect(ticks.map((t) => t.lostMMcfd)).toEqual([0, presets[0].lostMMcfd, presets[1].lostMMcfd]);
    for (const t of ticks) {
      expect(['sourced', 'derived', 'assumed']).toContain(t.label_kind);
      expect(t.label.length).toBeGreaterThan(0);
      expect(t.source.length).toBeGreaterThan(0);
    }
  });
});

describe('forecast runs and forecast error (D-A3, D-B1)', () => {
  const lagH = constants.forecast_lag_h.value as number;
  const withRuns: { id: string; kind: string; startIso: string; hours: number; forecastRuns: Widen<ForecastRun>[] }[] =
    [designJson, feb2024Json, lastwinterJson];

  for (const sc of withRuns) {
    it(`${sc.id}: every run has one entry per scenario hour and the Section 6 fields`, () => {
      expect(sc.forecastRuns.length).toBeGreaterThan(0);
      for (const r of sc.forecastRuns) {
        expect(r.outdoorF, r.runIso).toHaveLength(sc.hours);
        expect(r.sigmaF, r.runIso).toHaveLength(sc.hours);
        for (const v of [...r.outdoorF, ...r.sigmaF]) expect(v === null || Number.isFinite(v), r.runIso).toBe(true);
        expect(r.availableHour, r.runIso).toBe((Date.parse(r.runIso) - Date.parse(sc.startIso)) / 3_600_000 + lagH);
        expect(r.label, r.runIso).toBe(sc.kind === 'replay' ? 'sourced' : 'assumed');
        expect(r.source.length, r.runIso).toBeGreaterThan(0);
        if (sc.kind === 'replay') {
          expect(r.station).toBe('PANC');
          expect(r.source).toMatch(/IEM MOS archive.*data\/raw\/iem_mos_nbs_panc_/);
        } else {
          expect(r.source).toMatch(/not a real forecast/);
        }
      }
    });

    it(`${sc.id}: includes a run usable at hour 0 and one issued in each 6 hours of the scenario`, () => {
      const available = sc.forecastRuns.map((r) => r.availableHour).sort((a, b) => a - b);
      expect(available.some((a) => a <= 0)).toBe(true);
      const during = available.filter((a) => a > 0);
      for (let i = 1; i < during.length; i++) expect(during[i] - during[i - 1]).toBe(6);
      expect(during[during.length - 1]).toBeGreaterThanOrEqual(sc.hours - 7);
    });

    it(`${sc.id}: at hour 0 every scenario hour has a forecast from a run already issued`, () => {
      const usable = sc.forecastRuns.filter((r) => r.availableHour <= 0);
      for (let h = 0; h < sc.hours; h++) expect(usable.some((r) => r.outdoorF[h] !== null), `hour ${h}`).toBe(true);
    });
  }

  it('design: constructed runs are 3°F too warm at 72 h of lead and exact at 0 h', () => {
    const r = designJson.forecastRuns[0];
    const runHour = r.availableHour - lagH;
    expect(r.outdoorF[0]).toBeCloseTo(designJson.outdoorF[0] + 3 / 72, 1);
    expect(r.outdoorF[runHour + 72]).toBeCloseTo(designJson.outdoorF[runHour + 72] + 3, 1);
  });

  it('raw forecast files record station, model and run times', async () => {
    const { readFileSync } = await import('node:fs');
    for (const id of ['feb2024', 'lastwinter']) {
      for (const model of ['NBS', 'NBE']) {
        const raw = JSON.parse(readFileSync(new URL(`../raw/iem_mos_${model.toLowerCase()}_panc_${id}.json`, import.meta.url), 'utf8')) as {
          request: { station: string; model: string; runtimes: string[] }; runs: { runIso: string; rows: { station: string; model: string }[] }[];
        };
        expect(raw.request.station).toBe('PANC');
        expect(raw.request.model).toBe(model);
        expect(raw.runs.map((r) => r.runIso)).toEqual(raw.request.runtimes);
        for (const run of raw.runs) for (const row of run.rows) expect(row.station === 'PANC' && row.model === model).toBe(true);
      }
    }
  });

  it('forecast_error.json: leads 6, 12, 24, 48, 72 h with counts, and forecast_rmse_f follows the pooled RMSE', () => {
    expect(forecastErrorJson.label).toBe('derived');
    expect(forecastErrorJson.pooled.map((p) => p.leadH)).toEqual([6, 12, 24, 48, 72]);
    for (const id of ['feb2024', 'lastwinter'] as const) {
      const s = forecastErrorJson.scenarios[id];
      expect(s.byLead.map((p) => p.leadH)).toEqual([6, 12, 24, 48, 72]);
      expect(s.runs).toBeGreaterThan(0);
    }
    const rmse = constants.forecast_rmse_f.value as number[];
    expect(rmse).toHaveLength(5);
    forecastErrorJson.pooled.forEach((p, i) => {
      const expected = p.rmseF ?? forecastErrorJson.pooled.slice(i).find((q) => q.rmseF !== null)?.rmseF;
      expect(rmse[i]).toBe(expected);
    });
  });
});
