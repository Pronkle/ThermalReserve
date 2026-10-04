import { discretizeHourly, normalSetpointF } from './physics';
import { clockHourAt, planBaseline, planSustainStagger, runPlan } from './strategies';
import type { PressureParams } from './pressure';
import type { CohortParams, FleetConfig, ModelConstants, Plan, Scenario, ThermalState } from './types';

// Dispatch LP (AGENTS.md Section 10, E5), written as CPLEX LP text and solved with HiGHS (WebAssembly).
//
// Per cohort c and hour t (t = from..H-1), with states at hour boundaries:
//   ta_c_t, tm_c_t   °F at the start of hour t (t = from is fixed to the initial state; t = H is the terminal state)
//   q_c_t            delivered heat during hour t, kBtu/h (constant over the hour)
//   s_d              uncovered shortfall on gas day d, Mcf (slack)
// Dynamics: exact hourly discretization. Bounds: max(floor, normal − maxDepth) ≤ ta ≤ normal, 0 ≤ q ≤ Qmax.
// Capacity per gas day d (hours [24d, 24d+24)): Σ_t [Σ_c homes_c ((1 − o_t) q_c_t / (eta_c HHV) + o_t base_c_t) + non-enrolled_t]
//   − s_d ≤ capacity (Mcf), where o_t is the expected overridden share (overridden homes burn baseline gas).
//   Hours of the day before `from` count at their no-program system demand; a partial last day gets a pro-rated limit.
// Terminal: ta_c_H ≥ normal − 0.5.
// Objective (OPTIMIZED): Σ homes (normal − ta) + 1e6 Σ s + 1e-6 Σ gas;  MAX_RELIEF swaps the first and last weights.
// Exempt homes are outside the LP and inside non-enrolled demand. Targets = planned Ta at the end of each hour.

// Per Mcf of daily shortfall. Covering 1 Mcf by setback costs ~2,200 home-°F-hours, so 1e5 keeps slack a last
// resort with a wide margin while keeping the objective well scaled (1e6 tripped HiGHS's default dual simplex).
const SLACK_WEIGHT = 1e5;
const SMALL_WEIGHT = 1e-6;
const TERMINAL_TOL_F = 0.5;
// The LP plans hourly while runPlan/tick use 5-minute sub-steps; planning against a slightly lower limit keeps the
// simulated run under capacity when the LP says it is covered.
const CAPACITY_MARGIN = 2e-4;
const NORMAL_EPS_F = 0.05; // targets this close to the baseline are reported as NaN (follow normal)

interface LpLayout {
  from: number;
  H: number;
  homes: number[];   // non-exempt homes per cohort
  normal: number[][]; // [c][t] normal setpoint during hour t
  reach: number[][];  // [c][t] Ta at the end of hour t when heating toward normal from the initial state (baseline)
  upper: number[][];  // [c][t] max(normal, reach)
}

function fmtNum(x: number): string {
  if (!Number.isFinite(x)) throw new Error(`buildLp: non-finite coefficient ${x}`);
  if (x === 0) return '0';
  return Number(x.toPrecision(12)).toString();
}

/** Appends `+ coef name` / `- coef name` terms. */
function term(coef: number, name: string): string {
  if (coef === 0) return '';
  return coef < 0 ? ` - ${fmtNum(-coef)} ${name}` : ` + ${fmtNum(coef)} ${name}`;
}

function steadyMassF(c: CohortParams, TaF: number, outdoorF: number): number {
  return (c.Ham * TaF + c.Umo * outdoorF) / (c.Ham + c.Umo);
}

function layoutOf(sc: Scenario, cohorts: CohortParams[], cfg: FleetConfig, from: number, initial: ThermalState[]): LpLayout {
  const nonExempt = cfg.enrolledHomes * (1 - cfg.exemptShare);
  const normal = cohorts.map((c) => Array.from({ length: sc.hours }, (_, t) => normalSetpointF(c, clockHourAt(sc, t))));
  // Baseline at hourly resolution: after a night setback a home cannot reach the day setpoint in one hour,
  // and that lag must not be read as (or forced into) a program setback.
  const reach = cohorts.map((c) => {
    const d = discretizeHourly(c);
    const out = new Array<number>(sc.hours).fill(NaN);
    let ta = initial[c.id].TaF, tm = initial[c.id].TmF;
    for (let t = from; t < sc.hours; t++) {
      const to = sc.outdoorF[t];
      const free0 = d.A[0][0] * ta + d.A[0][1] * tm + d.Bo[0] * to;
      const q = Math.min(c.QmaxBtuH, Math.max(0, (normal[c.id][t] - free0) / d.Bq[0]));
      const nta = free0 + d.Bq[0] * q;
      tm = d.A[1][0] * ta + d.A[1][1] * tm + d.Bq[1] * q + d.Bo[1] * to;
      ta = nta;
      out[t] = ta; // above normal when the home cannot coast down to a lower night setpoint within the hour
    }
    return out;
  });
  const upper = reach.map((row, c) => row.map((r, t) => (Number.isFinite(r) ? Math.max(normal[c][t], r) : normal[c][t])));
  return { from, H: sc.hours, homes: cohorts.map((c) => nonExempt * c.share), normal, reach, upper };
}

function defaultInitial(sc: Scenario, cohorts: CohortParams[], cfg: FleetConfig, consts: ModelConstants, from: number): ThermalState[] {
  if (from <= 0) {
    return cohorts.map((c) => {
      const ta = normalSetpointF(c, clockHourAt(sc, 0));
      return { TaF: ta, TmF: steadyMassF(c, ta, sc.outdoorF[0]) };
    });
  }
  const base = runPlan(sc, cohorts, { ...cfg, overrideRate: 0 }, planBaseline(sc, cohorts), consts);
  return base.hours[from - 1].cohorts.map((s) => ({ TaF: s.TaF, TmF: s.TmF }));
}

interface DemandInputs {
  nonEnrolled: number[];     // [t] Mcf/h of system demand outside the enrolled, non-exempt fleet
  baseCfPerHome: number[][]; // [t][c] baseline gas per home in hour t (what an overridden home burns)
  overrideShare: number[];   // [t] expected share of homes that have overridden by the end of hour t
}

// Overrides follow the same expected ramp runPlan uses (overrideRate spread uniformly over the event), so the plan's
// capacity accounting matches the run: overridden homes burn baseline gas, the rest follow the plan.
function demandInputs(sc: Scenario, cohorts: CohortParams[], cfg: FleetConfig, consts: ModelConstants): DemandInputs {
  const base = runPlan(sc, cohorts, { ...cfg, overrideRate: 0 }, planBaseline(sc, cohorts), consts);
  const len = sc.eventEndHour - sc.eventStartHour;
  return {
    nonEnrolled: sc.systemMMcfh.map((sys, t) => (sys - base.hours[t].baselineFleetGasMMcfh) * 1000),
    baseCfPerHome: base.hours.map((h) => h.cohorts.map((c) => c.gasCfPerHome)),
    overrideShare: sc.systemMMcfh.map((_, t) => (len <= 0 || t + 1 <= sc.eventStartHour ? 0 : cfg.overrideRate * Math.min(1, (t + 1 - sc.eventStartHour) / len))),
  };
}

function buildLpText(
  sc: Scenario, cohorts: CohortParams[], cfg: FleetConfig, mode: 'OPTIMIZED' | 'MAX_RELIEF',
  initial: ThermalState[], consts: ModelConstants, from: number, demand: DemandInputs,
): { text: string; layout: LpLayout } {
  const L = layoutOf(sc, cohorts, cfg, from, initial);
  const { H } = L;
  const hhv = consts.hhvBtuPerCf;
  const capMcfd = cfg.capacityMMcfd * 1000 * (1 - CAPACITY_MARGIN);
  const wDiscomfort = mode === 'OPTIMIZED' ? 1 : SMALL_WEIGHT;
  const wGas = mode === 'OPTIMIZED' ? SMALL_WEIGHT : 1;

  const obj: string[] = [];
  const rows: string[] = [];
  const bounds: string[] = [];
  let objConst = 0;

  for (const c of cohorts) {
    const d = discretizeHourly(c);
    const homes = L.homes[c.id];
    const gasPerKbtu = homes / (c.eta * hhv); // Mcf/h per kBtu/h, summed over the cohort's homes
    const lower = (t: number) => Math.min(L.normal[c.id][t], L.reach[c.id][t], Math.max(cfg.floorF, L.normal[c.id][t] - cfg.maxDepthF));
    bounds.push(` ta_${c.id}_${from} = ${fmtNum(initial[c.id].TaF)}`);
    bounds.push(` tm_${c.id}_${from} = ${fmtNum(initial[c.id].TmF)}`);
    for (let t = from; t < H; t++) {
      const qName = `q_${c.id}_${t}`;
      bounds.push(` 0 <= ${qName} <= ${fmtNum(c.QmaxBtuH / 1000)}`);
      // Dynamics into t+1.
      const to = sc.outdoorF[t];
      rows.push(` da_${c.id}_${t}: ta_${c.id}_${t + 1}${term(-d.A[0][0], `ta_${c.id}_${t}`)}${term(-d.A[0][1], `tm_${c.id}_${t}`)}${term(-d.Bq[0] * 1000, qName)} = ${fmtNum(d.Bo[0] * to)}`);
      rows.push(` dm_${c.id}_${t}: tm_${c.id}_${t + 1}${term(-d.A[1][0], `ta_${c.id}_${t}`)}${term(-d.A[1][1], `tm_${c.id}_${t}`)}${term(-d.Bq[1] * 1000, qName)} = ${fmtNum(d.Bo[1] * to)}`);
      // State at end of hour t is governed by hour t's setpoint.
      const normal = L.normal[c.id][t];
      const lo = lower(t);
      const taNext = `ta_${c.id}_${t + 1}`;
      const hi = L.upper[c.id][t];
      if (t + 1 === H) bounds.push(` ${fmtNum(Math.max(lo, Math.min(normal, L.reach[c.id][t]) - TERMINAL_TOL_F))} <= ${taNext} <= ${fmtNum(hi)}`);
      else bounds.push(` ${fmtNum(lo)} <= ${taNext} <= ${fmtNum(hi)}`);
      bounds.push(` tm_${c.id}_${t + 1} free`);
      // Objective: homes × (normal − ta) = const − homes × ta.
      objConst += wDiscomfort * homes * normal;
      obj.push(term(-wDiscomfort * homes, taNext));
      obj.push(term(wGas * gasPerKbtu, qName));
    }
  }

  for (let d = Math.floor(from / 24); d * 24 < H; d++) {
    const start = d * 24, end = Math.min(H, start + 24);
    let rhs = (capMcfd * (end - start)) / 24;
    let row = ` cap_${d}:`;
    for (let t = start; t < end; t++) {
      if (t < from) { rhs -= sc.systemMMcfh[t] * 1000; continue; }
      rhs -= demand.nonEnrolled[t];
      const ovr = demand.overrideShare[t];
      for (const c of cohorts) {
        rhs -= (L.homes[c.id] * ovr * demand.baseCfPerHome[t][c.id]) / 1000;
        row += term((L.homes[c.id] * (1 - ovr)) / (c.eta * hhv), `q_${c.id}_${t}`);
      }
    }
    row += ` - s_${d} <= ${fmtNum(rhs)}`;
    rows.push(row);
    obj.push(term(SLACK_WEIGHT, `s_${d}`));
    bounds.push(` s_${d} >= 0`);
  }

  // The constant Σ homes × normal is dropped from the text; it does not change the optimum.
  void objConst;
  const objLine = ` obj:${obj.join('')}`;
  const text = [
    `\\ Thermal Reserve ${mode} LP: ${cohorts.length} cohorts × hours ${from}..${H - 1}`,
    'Minimize',
    objLine,
    'Subject To',
    ...rows,
    'Bounds',
    ...bounds,
    'End',
    '',
  ].join('\n');
  return { text, layout: L };
}

export function buildLp(sc: Scenario, cohorts: CohortParams[], cfg: FleetConfig, mode: 'OPTIMIZED' | 'MAX_RELIEF', initial: ThermalState[], consts: ModelConstants): string {
  return buildLpText(sc, cohorts, cfg, mode, initial, consts, 0, demandInputs(sc, cohorts, cfg, consts)).text;
}

// ---- HiGHS loading ----

type HighsModule = typeof import('highs');
type HighsInstance = Awaited<ReturnType<HighsModule['default']>>;
type HighsInit = Parameters<HighsModule['default']>[0];

let highsInit: HighsInit | undefined;
let highsPromise: Promise<HighsInstance> | undefined;

/**
 * Browser/Worker hook: pass `{ locateFile: (f) => wasmUrl }` (e.g. Vite's `import wasmUrl from 'highs/runtime?url'`)
 * before the first solvePlan call. Node finds highs.wasm on its own.
 */
export function configureHighs(init: HighsInit): void {
  highsInit = init;
  highsPromise = undefined;
}

async function getHighs(): Promise<HighsInstance> {
  if (!highsPromise) {
    highsPromise = import('highs').then((m) => m.default(highsInit));
    highsPromise.catch(() => { highsPromise = undefined; });
  }
  return highsPromise;
}

function nowMs(): number {
  const perf = (globalThis as { performance?: { now(): number } }).performance;
  return perf ? perf.now() : 0;
}

function fallbackPlan(sc: Scenario, cohorts: CohortParams[], cfg: FleetConfig, mode: string, solveMs: number, why: string): Plan {
  const p = planSustainStagger(sc, cohorts, cfg);
  // `why` goes in the id so the note stays the exact string WEB matches on.
  return { ...p, id: `${sc.id}-${mode}-fallback-${why.replace(/\W+/g, '_').slice(0, 40)}`, solveMs, shortfallMMcfh: new Array<number>(sc.hours).fill(0), shortfallMMcfd: new Array<number>(Math.ceil(sc.hours / 24)).fill(0), note: 'Rule-based fallback' };
}

/** `pressure`: plan against the hourly linepack balance (Section 7) instead of the daily capacity rows. */
export interface SolveOpts { timeoutMs?: number; fromHour?: number; initial?: ThermalState[]; pressure?: PressureParams & { initialIdx?: number } }

export async function solvePlan(
  sc: Scenario,
  cohorts: CohortParams[],
  cfg: FleetConfig,
  mode: 'OPTIMIZED' | 'MAX_RELIEF',
  consts: ModelConstants,
  opts?: SolveOpts,
): Promise<Plan> {
  const t0 = nowMs();
  const timeoutMs = opts?.timeoutMs ?? 5000;
  const from = Math.max(0, Math.min(sc.hours - 1, Math.floor(opts?.fromHour ?? 0)));
  try {
    const initial = opts?.initial ?? defaultInitial(sc, cohorts, cfg, consts, from);
    const { text, layout } = buildLpText(sc, cohorts, cfg, mode, initial, consts, from, demandInputs(sc, cohorts, cfg, consts));
    const highs = await getHighs();
    const remainingS = Math.max(0.1, (timeoutMs - (nowMs() - t0)) / 1000);
    // HiGHS's default path occasionally fails with status -1 on these models; presolve-off simplex and IPM
    // solve the same LP, so retry before falling back to the rule-based plan.
    const attempts = [{}, { presolve: 'off' }, { solver: 'ipm' }] as const;
    let res: ReturnType<typeof highs.solve> | undefined;
    let lastErr = 'solver error';
    for (const extra of attempts) {
      const left = (timeoutMs - (nowMs() - t0)) / 1000;
      if (left <= 0) break;
      try {
        res = highs.solve(text, { output_flag: false, time_limit: Math.max(0.1, Math.min(remainingS, left)), ...extra });
        if (res.Status === 'Optimal') break;
        lastErr = res.Status;
      } catch (e) {
        res = undefined;
        lastErr = e instanceof Error ? e.message : 'solver error';
      }
    }
    if (!res) return fallbackPlan(sc, cohorts, cfg, mode, nowMs() - t0, lastErr);
    const solveMs = nowMs() - t0;
    if (res.Status !== 'Optimal') return fallbackPlan(sc, cohorts, cfg, mode, solveMs, res.Status);
    if (solveMs > timeoutMs) return fallbackPlan(sc, cohorts, cfg, mode, solveMs, 'timeout');

    const col = (name: string): number => {
      const v = (res.Columns[name] as { Primal?: number } | undefined)?.Primal;
      return typeof v === 'number' ? v : NaN;
    };
    const targetsF = cohorts.map(() => new Array<number>(sc.hours).fill(NaN));
    for (const c of cohorts) {
      for (let t = from; t < layout.H; t++) {
        const ta = col(`ta_${c.id}_${t + 1}`);
        if (Number.isFinite(ta) && ta < layout.reach[c.id][t] - NORMAL_EPS_F) targetsF[c.id][t] = Math.max(cfg.floorF, ta);
      }
    }
    const firstDay = Math.floor(from / 24);
    // Report slack against the true limit: the planning margin is not a shortfall.
    const marginMMcfd = (d: number) => (cfg.capacityMMcfd * CAPACITY_MARGIN * (Math.min(sc.hours, d * 24 + 24) - d * 24)) / 24;
    const shortfallMMcfd = Array.from({ length: Math.ceil(sc.hours / 24) }, (_, d) => (d < firstDay ? 0 : Math.max(0, col(`s_${d}`) / 1000 - marginMMcfd(d))));
    const shortfallMMcfh = Array.from({ length: sc.hours }, (_, t) => shortfallMMcfd[Math.floor(t / 24)] / 24);
    return { id: `${sc.id}-${mode}`, strategy: mode, targetsF, solveMs, shortfallMMcfh, shortfallMMcfd };
  } catch (e) {
    return fallbackPlan(sc, cohorts, cfg, mode, nowMs() - t0, e instanceof Error ? e.message : 'error');
  }
}
