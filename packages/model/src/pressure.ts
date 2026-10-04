import type { CohortParams, ConstantsJson, FleetConfig, ModelConstants, RunResult, Scenario } from './types';

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
  curtailedMMcf: number;           // sum over below-zero episodes of each episode's deepest deficit
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

export function pressureSummary(index: number[], p: PressureParams): PressureSummary {
  let minIndex = Infinity, minHour = -1, hoursBelowZero = 0, hoursInReserve = 0, curtailedMMcf = 0;
  let firstBelowHour: number | null = null;
  let episodeMin = 0; // most negative P in the current below-zero episode (0 when not in one)
  for (let t = 0; t < index.length; t++) {
    const P = index[t];
    if (P === undefined || !Number.isFinite(P)) break;
    if (P < minIndex) { minIndex = P; minHour = t; }
    if (P < 0) {
      hoursBelowZero++;
      if (firstBelowHour === null) firstBelowHour = t;
      episodeMin = Math.min(episodeMin, P);
    } else {
      if (P < p.reserveIdx) hoursInReserve++;
      if (episodeMin < 0) { curtailedMMcf += (-episodeMin * p.wMMcf) / 100; episodeMin = 0; }
    }
  }
  if (episodeMin < 0) curtailedMMcf += (-episodeMin * p.wMMcf) / 100;
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

/** E-A0 stub: shaped rows, real search lands in E-A3. */
export async function coverageTable(scenarios: Scenario[], _cohorts: CohortParams[], cfg: FleetConfig, _consts: ModelConstants, _raw: ConstantsJson): Promise<CoverageRow[]> {
  return scenarios.map((sc) => ({ scenarioId: sc.id, homes: cfg.enrolledHomes, maxLostAboveZero: 0, maxLostAtReserve: 0, degreeHoursAtThatLoss: 0 }));
}
