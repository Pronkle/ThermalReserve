import { solvePlan } from './lp';
import { planBaseline, runPlan } from './strategies';
import type { CohortParams, ConstantsJson, FleetConfig, ModelConstants, Plan, RunResult, Scenario } from './types';

// Pressure index (AGENTS.md Section 3). Hour by hour, with inflow u, demand D (MMcf/h) and linepack L (MMcf):
//   L[t+1] = L[t] + u[t] − D[t],   u[t] = min(R/24, W − L[t] + D[t]),   L[0] = W × initialIdx / 100
//   P = 100 × L / W
// Inflow throttles only when the pipes are full. Below zero is not clamped: a negative P is gas that must be curtailed.
// Series convention: index[t] is P at the END of hour t (after hour t's inflow and demand).

export interface PressureParams { rMMcfd: number; wMMcf: number; reserveIdx: number; }

export interface PressureSummary {
  minIndex: number; minHour: number;
  hoursBelowZero: number; firstBelowHour: number | null;
  hoursInReserve: number;          // 0 <= P < reserveIdx
  curtailedMMcf: number;           // clamped-replay total (= deepest deficit for a single below-zero episode); see curtailedSeriesMMcf
  reserveHeld: number;             // min(minIndex, reserveIdx), for "7 of 10 held"
}

export interface CoverageRow { scenarioId: string; homes: number; maxLostAboveZero: number; maxLostAtReserve: number; degreeHoursAtThatLoss: number; }

/**
 * Smallest linepack (MMcf) that absorbs a day at exactly R (MMcf/day) spread over `shape` with constant inflow R/24:
 * the deepest cumulative drawdown of (demand − inflow) over the repeating day.
 */
export function usableLinepackMMcf(rMMcfd: number, shape: number[]): number {
  const n = shape.length;
  if (n === 0) throw new Error('usableLinepackMMcf: empty shape');
  const sum = shape.reduce((s, x) => s + x, 0);
  const net = shape.map((f) => (rMMcfd * f) / sum - rMMcfd / n); // demand − inflow per hour; sums to 0 over a day
  // Two cycles so a drawdown that wraps past midnight is found.
  let cum = 0, peak = 0, worst = 0;
  for (let k = 0; k < 2 * n; k++) {
    cum -= net[k % n];
    peak = Math.max(peak, cum);
    worst = Math.max(worst, peak - cum);
  }
  return worst;
}

function rawNum(raw: ConstantsJson, key: string): number {
  const e = raw[key];
  if (!e) throw new Error(`constants.json missing key: ${key}`);
  if (typeof e.value !== 'number' || !Number.isFinite(e.value)) throw new Error(`constants.json key ${key} is not a finite number`);
  return e.value;
}

/** R = deliverability_2024_mmcfd − lost; W = linepack_usable_mmcf (fixed; never recomputed from the slider). */
export function pressureParams(_consts: ModelConstants, raw: ConstantsJson, lostMMcfd: number, reserveIdx: number): PressureParams {
  return {
    rMMcfd: rawNum(raw, 'deliverability_2024_mmcfd') - lostMMcfd,
    wMMcf: rawNum(raw, 'linepack_usable_mmcf'),
    reserveIdx,
  };
}

/** Pressure index per hour (end of hour). Entries from the first undefined demand onward are undefined. */
export function pressureIndex(systemMMcfh: (number | undefined)[], p: PressureParams, initialIdx = 100): (number | undefined)[] {
  const out: (number | undefined)[] = new Array(systemMMcfh.length).fill(undefined);
  const uMax = Math.max(0, p.rMMcfd / 24);
  let L = (p.wMMcf * initialIdx) / 100;
  for (let t = 0; t < systemMMcfh.length; t++) {
    const D = systemMMcfh[t];
    if (D === undefined || !Number.isFinite(D)) break;
    const u = Math.max(0, Math.min(uMax, p.wMMcf - L + D));
    L = L + u - D;
    out[t] = (100 * L) / p.wMMcf;
  }
  return out;
}

/**
 * Cumulative gas curtailed by the end of each hour (MMcf), from a clamped replay of the same series: each hour,
 * curtail just enough to keep linepack ≥ 0. Rebuilt from the unclamped index alone: away from full, an hour's index
 * change is (R/24 − D) whichever way linepack is counted; at 100 the pipes are full either way. With one below-zero
 * episode the total equals that episode's deepest deficit (Section 3); with several it does not double-count gas
 * already curtailed (H1 [REQUEST] 2026-10-04 08:13Z).
 */
export function curtailedSeriesMMcf(index: (number | undefined)[], p: PressureParams): (number | undefined)[] {
  const W = p.wMMcf;
  const out: (number | undefined)[] = new Array(index.length).fill(undefined);
  let prev: number | null = null; // unclamped linepack at the end of the previous hour
  let lc = 0, total = 0;          // clamped linepack, cumulative curtailment
  for (let t = 0; t < index.length; t++) {
    const P = index[t];
    if (P === undefined || !Number.isFinite(P)) break;
    const L = (P * W) / 100;
    if (prev === null) lc = L;
    else if (P >= 100 - 1e-9) lc = W;
    else lc = Math.min(W, lc + (L - prev));
    if (lc < 0) { total -= lc; lc = 0; }
    prev = L;
    out[t] = total;
  }
  return out;
}

export function pressureSummary(index: number[], p: PressureParams): PressureSummary {
  let minIndex = Infinity, minHour = -1, hoursBelowZero = 0, hoursInReserve = 0;
  let firstBelowHour: number | null = null;
  let n = 0;
  for (let t = 0; t < index.length; t++) {
    const P = index[t];
    if (P === undefined || !Number.isFinite(P)) break;
    n = t + 1;
    if (P < minIndex) { minIndex = P; minHour = t; }
    if (P < 0) {
      hoursBelowZero++;
      if (firstBelowHour === null) firstBelowHour = t;
    } else if (P < p.reserveIdx) hoursInReserve++;
  }
  const curtailedMMcf = n > 0 ? curtailedSeriesMMcf(index, p)[n - 1] ?? 0 : 0;
  if (minHour < 0) minIndex = 100;
  return { minIndex, minHour: Math.max(0, minHour), hoursBelowZero, firstBelowHour, hoursInReserve, curtailedMMcf, reserveHeld: Math.min(minIndex, p.reserveIdx) };
}

/**
 * Per hour: degrees below each home's own no-program temperature (the BASELINE run), averaged over enrolled
 * non-exempt homes with overridden homes counted at zero, as runPlan's degreeHoursBelowNormal does. `worstF` is the
 * coldest home type's gap (largest cohort gap, before overrides).
 */
export function discomfortSeries(run: RunResult, baseline: RunResult, cohorts: CohortParams[], cfg: FleetConfig): { meanF: number[]; worstF: number[] } {
  const nonExempt = cfg.enrolledHomes * (1 - cfg.exemptShare);
  const meanF: number[] = [], worstF: number[] = [];
  for (let h = 0; h < run.hours.length; h++) {
    const r = run.hours[h], b = baseline.hours[h];
    const ovr = nonExempt > 0 ? r.overrides / nonExempt : 0;
    let mean = 0, worst = 0;
    for (const c of cohorts) {
      if (c.share <= 0) continue;
      const gap = Math.max(0, (b?.cohorts[c.id]?.TaF ?? r.cohorts[c.id].TaF) - r.cohorts[c.id].TaF);
      mean += c.share * (1 - ovr) * gap;
      worst = Math.max(worst, gap);
    }
    meanF.push(mean);
    worstF.push(worst);
  }
  return { meanF, worstF };
}

export interface PresetResult {
  lostMMcfd: number; plan: Plan; run: RunResult; baseline: RunResult;
  pressure: PressureParams; planned: PressureSummary; noProgram: PressureSummary; degreeHours: number;
}

/** Solves OPTIMIZED in pressure mode at one loss and scores the 5-minute run and No program on the pressure index. */
export async function evaluateLoss(sc: Scenario, cohorts: CohortParams[], cfg: FleetConfig, consts: ModelConstants, raw: ConstantsJson, lostMMcfd: number, reserveIdx: number): Promise<PresetResult> {
  const p = pressureParams(consts, raw, lostMMcfd, reserveIdx);
  const c = { ...cfg, capacityMMcfd: p.rMMcfd };
  const plan = await solvePlan(sc, cohorts, c, 'OPTIMIZED', consts, { pressure: p });
  const run = runPlan(sc, cohorts, c, plan, consts);
  const baseline = runPlan(sc, cohorts, c, planBaseline(sc, cohorts), consts);
  const score = (r: RunResult) => pressureSummary(pressureIndex(r.hours.map((h) => h.systemMMcfh), p) as number[], p);
  return { lostMMcfd, plan, run, baseline, pressure: p, planned: score(run), noProgram: score(baseline), degreeHours: run.totals.degreeHoursBelowNormal };
}

const LOST_STEP = 0.5;
const LOST_MAX = 35;

/**
 * Per scenario at cfg.enrolledHomes: the largest loss (0–35 MMcf/day, step 0.5) at which the Optimized pressure plan,
 * run at 5-minute resolution, keeps the index ≥ 0 and ≥ reserve_default_idx, with °F·h per home at the reserve loss.
 * Assumes coverage falls as the loss grows (bisection on the 0.5 grid). −1 when even a loss of 0 fails.
 */
export async function coverageTable(scenarios: Scenario[], cohorts: CohortParams[], cfg: FleetConfig, consts: ModelConstants, raw: ConstantsJson): Promise<CoverageRow[]> {
  const reserve = rawNum(raw, 'reserve_default_idx');
  const rows: CoverageRow[] = [];
  for (const sc of scenarios) {
    const memo = new Map<number, PresetResult>();
    const at = async (k: number) => {
      let r = memo.get(k);
      if (!r) { r = await evaluateLoss(sc, cohorts, cfg, consts, raw, k * LOST_STEP, reserve); memo.set(k, r); }
      return r;
    };
    const largest = async (ok: (r: PresetResult) => boolean): Promise<number> => {
      if (!ok(await at(0))) return -1;
      let lo = 0, hi = Math.round(LOST_MAX / LOST_STEP);
      if (ok(await at(hi))) return hi;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (ok(await at(mid))) lo = mid; else hi = mid;
      }
      return lo;
    };
    const kZero = await largest((r) => r.planned.minIndex >= 0);
    const kRes = await largest((r) => r.planned.minIndex >= reserve);
    rows.push({
      scenarioId: sc.id, homes: cfg.enrolledHomes,
      maxLostAboveZero: kZero < 0 ? -1 : kZero * LOST_STEP,
      maxLostAtReserve: kRes < 0 ? -1 : kRes * LOST_STEP,
      degreeHoursAtThatLoss: kRes < 0 ? 0 : (await at(kRes)).degreeHours,
    });
  }
  return rows;
}
