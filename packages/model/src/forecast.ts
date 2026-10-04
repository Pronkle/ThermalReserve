import { solvePlan } from './lp';
import { normalSetpointF } from './physics';
import { pressureIndex, type PressureParams } from './pressure';
import { clockHourAt, runPlan } from './strategies';
import type { CohortParams, ConstantsJson, FleetConfig, ModelConstants, Plan, RunResult, Scenario } from './types';

// Forecast-based planning and re-planning (AGENTS.md Section 7, forecast.ts).

export interface ForecastRun {
  runIso: string; availableHour: number; model: string; station: string;
  outdoorF: (number | null)[]; sigmaF: (number | null)[];
  label: 'sourced' | 'assumed'; source: string;
}
export type ScenarioWithForecasts = Scenario & { forecastRuns?: ForecastRun[] };
export type PlanningMode = 'REPLAN' | 'SINGLE' | 'OBSERVED';
export type ReplanPolicy =
  | { kind: 'FIXED'; intervalH: number }
  | { kind: 'SCHEDULED_PLUS_DRIFT'; driftTempF: number; driftHours: number; driftPressureIdx: number; driftFadeH: number };
export type ReplanReason = 'start' | 'forecast' | 'drift-temp' | 'drift-pressure' | 'fixed';

export interface ReplanSegment {
  fromHour: number; reason: ReplanReason; runIso: string | null; driftF: number; plan: Plan; solveMs: number; deepenedF: number;
  // Additive extras for the charts (not in the frozen signature; WEB may ignore them). Full scenario length each.
  forecastF: number[];         // forecast in use, no buffer or drift (observed before fromHour, and where there is no run)
  sigmaF: number[];            // its ±1σ (0 where unknown and before fromHour)
  planningOutdoorF: number[];  // what the segment planned against: forecast + drift − buffer × σ
  expectedIdx: number[];       // pressure index this segment expected (stitched plan so far, its planning weather)
}

const FORECAST_RMSE_LEADS_H = [6, 12, 24, 48, 72];

function rawValue(raw: ConstantsJson | undefined, key: string): number | number[] | undefined {
  const v = raw?.[key]?.value;
  return typeof v === 'number' || Array.isArray(v) ? v : undefined;
}

/**
 * σ for a forecast lead (h) when a run carries no spread: RMSE by lead from data/forecast_error.json, passed in by the
 * web app as constants entry `forecast_rmse_f` = [RMSE at 6, 12, 24, 48, 72 h] (°F), linear between leads and flat
 * outside. 0 when the entry is absent.
 */
export function rmseAtLead(raw: ConstantsJson | undefined, leadH: number): number {
  const v = rawValue(raw, 'forecast_rmse_f');
  if (!Array.isArray(v) || v.length !== FORECAST_RMSE_LEADS_H.length || !v.every(Number.isFinite)) return 0;
  const L = FORECAST_RMSE_LEADS_H;
  if (leadH <= L[0]) return v[0];
  for (let i = 1; i < L.length; i++) {
    if (leadH <= L[i]) return v[i - 1] + ((v[i] - v[i - 1]) * (leadH - L[i - 1])) / (L[i] - L[i - 1]);
  }
  return v[L.length - 1];
}

/** The newest run usable at `hour` (availableHour ≤ hour); ties go to the later runIso. */
export function latestRun(sc: ScenarioWithForecasts, hour: number): ForecastRun | null {
  let best: ForecastRun | null = null;
  for (const r of sc.forecastRuns ?? []) {
    if (r.availableHour > hour) continue;
    if (!best || r.availableHour > best.availableHour || (r.availableHour === best.availableHour && r.runIso > best.runIso)) best = r;
  }
  return best;
}

interface ForecastView { forecastF: number[]; sigmaF: number[]; run: ForecastRun | null }

/**
 * Forecast in use from `fromHour`: the latest run; hours it does not cover fall back to the newest earlier run that
 * does, else to the last covered value. Hours before `fromHour` (and everything when no run exists) are observed.
 */
function forecastView(sc: ScenarioWithForecasts, fromHour: number, raw: ConstantsJson | undefined): ForecastView {
  const run = latestRun(sc, fromHour);
  const forecastF = sc.outdoorF.slice();
  const sigmaF = new Array<number>(sc.hours).fill(0);
  if (!run) return { forecastF, sigmaF, run };
  const lag = rawValue(raw, 'forecast_lag_h');
  const lagH = typeof lag === 'number' ? lag : 0;
  const older = (sc.forecastRuns ?? [])
    .filter((r) => r !== run && r.availableHour <= run.availableHour)
    .sort((a, b) => b.availableHour - a.availableHour || (a.runIso < b.runIso ? 1 : -1));
  let lastF: number | null = null, lastS: number | null = null;
  for (let h = fromHour; h < sc.hours; h++) {
    let src: ForecastRun | null = run.outdoorF[h] != null ? run : older.find((r) => r.outdoorF[h] != null) ?? null;
    let f: number | null = src ? src.outdoorF[h] : lastF;
    let s: number | null = null;
    if (src) {
      s = src.sigmaF[h] ?? rmseAtLead(raw, h - (src.availableHour - lagH));
    } else {
      s = lastS;
    }
    if (f == null) { f = sc.outdoorF[h]; s = 0; src = null; }
    forecastF[h] = f;
    sigmaF[h] = s ?? 0;
    lastF = f; lastS = s;
  }
  return { forecastF, sigmaF, run };
}

/**
 * Planning weather and demand from `fromHour` (Section 7). Demand is shifted, not recomputed: each gas day's extra
 * demand b × (observed mean − planning mean) is spread over that day's hours ≥ fromHour by the demand shape, so a
 * perfect forecast reproduces the observed scenario exactly. b = demand_sensitivity_mmcfd_per_f (MMcf/day per °F).
 */
export function planningScenario(
  sc: ScenarioWithForecasts, fromHour: number, bufferSigma: number, consts: ModelConstants, shape: number[],
  drift?: { errorF: number; fadeH: number },
): { scenario: Scenario; run: ForecastRun | null; planningOutdoorF: number[] } {
  const r = planningDetail(sc, fromHour, bufferSigma, consts, shape, drift);
  return { scenario: r.scenario, run: r.run, planningOutdoorF: r.planningOutdoorF };
}

function planningDetail(
  sc: ScenarioWithForecasts, fromHour: number, bufferSigma: number, consts: ModelConstants, shape: number[],
  drift?: { errorF: number; fadeH: number },
): { scenario: Scenario; run: ForecastRun | null; planningOutdoorF: number[]; forecastF: number[]; sigmaF: number[] } {
  const { forecastRuns: _runs, ...base } = sc;
  const fv = forecastView(sc, fromHour, consts.raw);
  if (!fv.run) return { scenario: { ...base }, run: null, planningOutdoorF: sc.outdoorF.slice(), forecastF: fv.forecastF, sigmaF: fv.sigmaF };
  const planningOutdoorF = fv.forecastF.map((f, h) => {
    if (h < fromHour) return sc.outdoorF[h];
    const fade = drift && drift.fadeH > 0 ? Math.max(0, 1 - (h - fromHour) / drift.fadeH) : 0;
    return f + (drift ? drift.errorF * fade : 0) - bufferSigma * fv.sigmaF[h];
  });
  const bv = rawValue(consts.raw, 'demand_sensitivity_mmcfd_per_f');
  if (typeof bv !== 'number') throw new Error('constants.json missing key: demand_sensitivity_mmcfd_per_f');
  const systemMMcfh = sc.systemMMcfh.slice();
  for (let d = 0; d * 24 < sc.hours; d++) {
    const start = d * 24, end = Math.min(sc.hours, start + 24);
    if (end <= fromHour) continue;
    let diff = 0, wRemain = 0;
    for (let h = start; h < end; h++) {
      diff += sc.outdoorF[h] - planningOutdoorF[h];
      if (h >= fromHour) wRemain += shape[h % 24];
    }
    const extraMMcf = (bv * diff) / (end - start); // b × (observed daily mean − planning daily mean)
    if (wRemain <= 0) continue;
    for (let h = Math.max(start, fromHour); h < end; h++) systemMMcfh[h] += (extraMMcf * shape[h % 24]) / wRemain;
  }
  return {
    scenario: { ...base, outdoorF: planningOutdoorF, systemMMcfh },
    run: fv.run, planningOutdoorF, forecastF: fv.forecastF, sigmaF: fv.sigmaF,
  };
}

/** Share-weighted mean setback (°F below normal) per hour; NaN targets count as 0. */
function meanSetbackF(sc: Scenario, cohorts: CohortParams[], plan: Plan, h: number): number {
  const clock = clockHourAt(sc, h);
  let s = 0;
  for (const c of cohorts) {
    const t = plan.targetsF[c.id]?.[h];
    if (t !== undefined && Number.isFinite(t)) s += c.share * Math.max(0, normalSetpointF(c, clock) - t);
  }
  return s;
}

function stitch(prev: Plan, next: Plan, fromHour: number, id: string): Plan {
  const targetsF = prev.targetsF.map((row, c) => row.map((v, h) => (h < fromHour ? v : next.targetsF[c]?.[h] ?? NaN)));
  const hours = prev.targetsF[0]?.length ?? 0;
  const shortfallMMcfh = Array.from({ length: hours }, (_, h) => (h < fromHour ? prev.shortfallMMcfh?.[h] ?? 0 : next.shortfallMMcfh?.[h] ?? 0));
  const shortfallMMcfd = Array.from({ length: Math.ceil(hours / 24) }, (_, d) => shortfallMMcfh.slice(d * 24, d * 24 + 24).reduce((a, b) => a + b, 0));
  const note = prev.note ?? next.note;
  return { id, strategy: next.strategy, targetsF, solveMs: (prev.solveMs ?? 0) + (next.solveMs ?? 0), shortfallMMcfh, shortfallMMcfd, ...(note ? { note } : {}) };
}

/**
 * Plans the scenario the way a live run would (Section 7): solve at hour 0, then re-plan when a newer forecast run
 * becomes available or observed weather / pressure drifts from the plan (SCHEDULED_PLUS_DRIFT), or every intervalH
 * hours (FIXED). Each re-plan starts from the house states and pressure of the plan so far run against ACTUAL weather.
 * The returned run is the stitched plan against actual weather. Pressure mode throughout; cfg.capacityMMcfd is set to R.
 */
export async function replanRun(
  sc: ScenarioWithForecasts, cohorts: CohortParams[], cfg: FleetConfig, consts: ModelConstants, p: PressureParams,
  opts: { mode: PlanningMode; bufferSigma: number; policy: ReplanPolicy; strategy: 'OPTIMIZED' | 'MAX_RELIEF'; timeoutMs?: number },
  shape?: number[],
): Promise<{ plan: Plan; run: RunResult; segments: ReplanSegment[] }> {
  const { forecastRuns: _runs, ...actual } = sc;
  const c = { ...cfg, capacityMMcfd: p.rMMcfd };
  const sh = shape ?? defaultShape(sc);
  const hasRuns = (sc.forecastRuns?.length ?? 0) > 0;
  const mode: PlanningMode = hasRuns ? opts.mode : 'OBSERVED';
  const idPrefix = `${sc.id}-${opts.strategy === 'OPTIMIZED' ? 'OPT' : 'MAX'}`;
  const indexOf = (r: RunResult, initialIdx = 100) => pressureIndex(r.hours.map((x) => x.systemMMcfh), p, initialIdx) as number[];

  const segments: ReplanSegment[] = [];
  const solveSegment = async (fromHour: number, reason: ReplanReason, prev: Plan | null, prevActual: RunResult | null, prevActualIdx: number[] | null, drift?: { errorF: number; fadeH: number }) => {
    const det = mode === 'OBSERVED'
      ? { scenario: actual as Scenario, run: null, planningOutdoorF: sc.outdoorF.slice(), forecastF: sc.outdoorF.slice(), sigmaF: new Array<number>(sc.hours).fill(0) }
      : planningDetail(sc, fromHour, opts.bufferSigma, consts, sh, drift);
    const initial = prevActual && fromHour > 0 ? prevActual.hours[fromHour - 1].cohorts.map((s) => ({ TaF: s.TaF, TmF: s.TmF })) : undefined;
    const initialIdx = prevActualIdx && fromHour > 0 ? prevActualIdx[fromHour - 1] : 100;
    const next = await solvePlan(det.scenario, cohorts, c, opts.strategy, consts, { timeoutMs: opts.timeoutMs, fromHour, initial, pressure: { ...p, initialIdx } });
    const plan = prev ? stitch(prev, next, fromHour, `${idPrefix}-rp${fromHour}`) : { ...next, id: `${idPrefix}-rp0` };
    let deepenedF = 0;
    if (prev) {
      for (let h = fromHour; h < sc.hours; h++) deepenedF = Math.max(deepenedF, meanSetbackF(actual, cohorts, plan, h) - meanSetbackF(actual, cohorts, prev, h));
    }
    // What this segment expects: the stitched plan run against its planning weather (observed before fromHour).
    const expectedIdx = indexOf(runPlan(det.scenario, cohorts, c, plan, consts));
    segments.push({
      fromHour, reason, runIso: det.run?.runIso ?? null, driftF: drift?.errorF ?? 0, plan: next, solveMs: next.solveMs ?? 0, deepenedF,
      forecastF: det.forecastF, sigmaF: det.sigmaF, planningOutdoorF: det.planningOutdoorF, expectedIdx,
    });
    const act = runPlan(actual, cohorts, c, plan, consts);
    return { plan, act, actIdx: indexOf(act), run: det.run, forecastF: det.forecastF, expectedIdx };
  };

  let cur = await solveSegment(0, 'start', null, null, null);
  if (mode === 'REPLAN') {
    const pol = opts.policy;
    let tempCount = 0;
    for (let h = 1; h < sc.hours; h++) {
      let reason: ReplanReason | null = null;
      let drift: { errorF: number; fadeH: number } | undefined;
      if (pol.kind === 'FIXED') {
        if (pol.intervalH > 0 && h % pol.intervalH === 0) reason = 'fixed';
      } else {
        const k = h - 1; // last observed hour
        tempCount = Math.abs(sc.outdoorF[k] - cur.forecastF[k]) > pol.driftTempF ? tempCount + 1 : 0;
        const newer = latestRun(sc, h);
        if (newer && newer !== cur.run) reason = 'forecast';
        else if (tempCount >= pol.driftHours) reason = 'drift-temp';
        else if (cur.actIdx[k] < cur.expectedIdx[k] - pol.driftPressureIdx) reason = 'drift-pressure';
        if (reason === 'drift-temp' || reason === 'drift-pressure') drift = { errorF: sc.outdoorF[k] - cur.forecastF[k], fadeH: pol.driftFadeH };
      }
      if (!reason) continue;
      cur = await solveSegment(h, reason, cur.plan, cur.act, cur.actIdx, drift);
      tempCount = 0;
    }
  }
  return { plan: cur.plan, run: cur.act, segments };
}

/** data/demand_shape.json is not imported by the model; without a shape, recover it from the scenario's first day. */
function defaultShape(sc: Scenario): number[] {
  const day = sc.systemMMcfh.slice(0, 24);
  const sum = day.reduce((a, b) => a + b, 0);
  return day.length === 24 && sum > 0 ? day.map((x) => x / sum) : new Array<number>(24).fill(1 / 24);
}
