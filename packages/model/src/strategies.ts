import { SUBSTEP_HOURS, gasCf, heatToHold, normalSetpointF, stepState } from './physics';
import type { CohortParams, FleetConfig, HourResult, ModelConstants, Plan, RunResult, Scenario, ThermalState } from './types';

/** Local clock hour (fractional) at simulation hour h, from the scenario's startIso local time. */
export function clockHourAt(sc: Scenario, hour: number): number {
  const m = /T(\d{2}):(\d{2})/.exec(sc.startIso);
  const start = m ? Number(m[1]) + Number(m[2]) / 60 : 0;
  return (((start + hour) % 24) + 24) % 24;
}

function emptyTargets(sc: Scenario, cohorts: CohortParams[]): number[][] {
  return cohorts.map(() => new Array<number>(sc.hours).fill(NaN));
}

export function planBaseline(sc: Scenario, cohorts: CohortParams[]): Plan {
  return { id: `${sc.id}-BASELINE`, strategy: 'BASELINE', targetsF: emptyTargets(sc, cohorts) };
}

const NAIVE_DEPTH_F = 4;
const NAIVE_START_CLOCK = 6;
const NAIVE_END_CLOCK = 10;

/** −4°F, 06:00–10:00 local on each event day. */
export function planNaive4h(sc: Scenario, cohorts: CohortParams[], cfg: FleetConfig): Plan {
  const targetsF = emptyTargets(sc, cohorts);
  for (let h = sc.eventStartHour; h < Math.min(sc.eventEndHour, sc.hours); h++) {
    const clock = clockHourAt(sc, h);
    if (clock < NAIVE_START_CLOCK || clock >= NAIVE_END_CLOCK) continue;
    for (const c of cohorts) {
      const normal = normalSetpointF(c, clock);
      targetsF[c.id][h] = Math.max(cfg.floorF, normal - NAIVE_DEPTH_F);
    }
  }
  return { id: `${sc.id}-NAIVE_4H`, strategy: 'NAIVE_4H', targetsF };
}

/**
 * E0 provisional: hold the full allowed depth for the whole event, with cohort start and end times
 * staggered over 3 hours (id mod 3) to spread the cool-down and the recovery. Refined in E3.
 */
export function planSustainStagger(sc: Scenario, cohorts: CohortParams[], cfg: FleetConfig): Plan {
  const targetsF = emptyTargets(sc, cohorts);
  for (const c of cohorts) {
    const offset = c.id % 3;
    const start = sc.eventStartHour + offset;
    const end = Math.min(sc.hours, sc.eventEndHour - 2 + offset);
    for (let h = start; h < end; h++) {
      const normal = normalSetpointF(c, clockHourAt(sc, h));
      targetsF[c.id][h] = Math.max(cfg.floorF, normal - cfg.maxDepthF);
    }
  }
  return { id: `${sc.id}-SUSTAIN_STAGGER`, strategy: 'SUSTAIN_STAGGER', targetsF };
}

function steadyMassF(c: CohortParams, TaF: number, outdoorF: number): number {
  return (c.Ham * TaF + c.Umo * outdoorF) / (c.Ham + c.Umo);
}

/** Share of non-exempt homes that have overridden by sim hour h (uniform override times within the event). */
function overriddenShareAt(sc: Scenario, cfg: FleetConfig, h: number): number {
  const len = sc.eventEndHour - sc.eventStartHour;
  if (len <= 0 || h <= sc.eventStartHour) return 0;
  return cfg.overrideRate * Math.min(1, (h - sc.eventStartHour) / len);
}

/**
 * Runs a plan with 5-minute sub-steps. Each cohort has an actual twin (plan targets) and a baseline twin
 * (normal setpoint). Exempt homes are excluded from fleet gas; overridden homes count at baseline-twin gas.
 */
export function runPlan(sc: Scenario, cohorts: CohortParams[], cfg: FleetConfig, plan: Plan, consts: ModelConstants): RunResult {
  const hhv = consts.hhvBtuPerCf;
  const subPerHour = Math.round(1 / SUBSTEP_HOURS);
  const nonExemptHomes = cfg.enrolledHomes * (1 - cfg.exemptShare);
  const capacityMMcfh = cfg.capacityMMcfd / 24;

  const o0 = sc.outdoorF[0];
  const act: ThermalState[] = cohorts.map((c) => {
    const ta = normalSetpointF(c, clockHourAt(sc, 0));
    return { TaF: ta, TmF: steadyMassF(c, ta, o0) };
  });
  const base: ThermalState[] = act.map((s) => ({ ...s }));

  const hours: HourResult[] = [];
  let degreeHours = 0;

  for (let h = 0; h < sc.hours; h++) {
    const outdoorF = sc.outdoorF[h];
    const gasAct = new Array<number>(cohorts.length).fill(0);
    const gasBase = new Array<number>(cohorts.length).fill(0);
    const qSum = new Array<number>(cohorts.length).fill(0);
    const holding = new Array<boolean>(cohorts.length).fill(false);

    for (let k = 0; k < subPerHour; k++) {
      const t = h + k * SUBSTEP_HOURS;
      const clock = clockHourAt(sc, t);
      for (const c of cohorts) {
        const normal = normalSetpointF(c, clock);
        const planned = plan.targetsF[c.id]?.[h];
        let target = normal;
        if (planned !== undefined && Number.isFinite(planned)) {
          target = Math.min(normal, Math.max(cfg.floorF, planned));
          if (target < normal - 1e-9) holding[c.id] = true;
        }
        const qa = heatToHold(c, act[c.id], outdoorF, target, SUBSTEP_HOURS);
        act[c.id] = stepState(c, act[c.id], outdoorF, qa, SUBSTEP_HOURS);
        gasAct[c.id] += gasCf(c, qa, SUBSTEP_HOURS, hhv);
        qSum[c.id] += qa;

        const qb = heatToHold(c, base[c.id], outdoorF, normal, SUBSTEP_HOURS);
        base[c.id] = stepState(c, base[c.id], outdoorF, qb, SUBSTEP_HOURS);
        gasBase[c.id] += gasCf(c, qb, SUBSTEP_HOURS, hhv);
      }
    }

    const ovr = overriddenShareAt(sc, cfg, h + 1);
    let fleetCf = 0;
    let baseCf = 0;
    let minTaF = Infinity;
    let atFloor = 0;
    const endClock = clockHourAt(sc, h + 1);
    const cohortRows: HourResult['cohorts'] = cohorts.map((c) => {
      const homes = nonExemptHomes * c.share;
      fleetCf += homes * ((1 - ovr) * gasAct[c.id] + ovr * gasBase[c.id]);
      baseCf += homes * gasBase[c.id];
      const s = act[c.id];
      if (c.share > 0) minTaF = Math.min(minTaF, s.TaF);
      if (s.TaF <= cfg.floorF + 0.1) atFloor += c.share;
      const normal = normalSetpointF(c, endClock);
      // Discomfort is measured against the baseline twin, so the program's own effect is counted, not night setbacks.
      degreeHours += c.share * (1 - ovr) * Math.max(0, base[c.id].TaF - s.TaF);
      const mode: 'normal' | 'holding' | 'recovering' = holding[c.id] ? 'holding' : s.TaF < normal - 0.25 ? 'recovering' : 'normal';
      return { TaF: s.TaF, TmF: s.TmF, qBtuH: qSum[c.id] / subPerHour, gasCfPerHome: gasAct[c.id], mode };
    });

    const fleetGasMMcfh = fleetCf / 1e6;
    const baselineFleetGasMMcfh = baseCf / 1e6;
    hours.push({
      hour: h,
      outdoorF,
      fleetGasMMcfh,
      baselineFleetGasMMcfh,
      systemMMcfh: sc.systemMMcfh[h] - baselineFleetGasMMcfh + fleetGasMMcfh,
      capacityMMcfh,
      minTaF,
      shareAtFloor: atFloor * (1 - ovr),
      overrides: Math.round(nonExemptHomes * ovr),
      cohorts: cohortRows,
    });
  }

  return { strategy: plan.strategy, hours, totals: totalsOf(sc, hours, degreeHours) };
}

function totalsOf(sc: Scenario, hours: HourResult[], degreeHoursBelowNormal: number): RunResult['totals'] {
  let fleet = 0, baseline = 0, eventHourSaved = 0;
  let peakIdx = -1, peakBase = -Infinity;
  for (const r of hours) {
    fleet += r.fleetGasMMcfh;
    baseline += r.baselineFleetGasMMcfh;
    if (r.cohorts.some((c) => c.mode === 'holding')) eventHourSaved += r.baselineFleetGasMMcfh - r.fleetGasMMcfh;
    const sysBase = r.systemMMcfh - r.fleetGasMMcfh + r.baselineFleetGasMMcfh;
    if (r.hour >= sc.eventStartHour && r.hour < sc.eventEndHour && sysBase > peakBase) {
      peakBase = sysBase;
      peakIdx = r.hour;
    }
  }
  // Capacity is a daily limit per gas day (hours [24d, 24d+24)); a partial last day gets a pro-rated limit.
  let uncovered = 0;
  for (let d = 0; d * 24 < hours.length; d++) {
    const day = hours.slice(d * 24, d * 24 + 24);
    const total = day.reduce((s, r) => s + r.systemMMcfh, 0);
    const cap = day.reduce((s, r) => s + r.capacityMMcfh, 0);
    uncovered += Math.max(0, total - cap);
  }
  const eventDays = Math.max(1e-9, (sc.eventEndHour - sc.eventStartHour) / 24);
  const peak = peakIdx >= 0 ? hours[peakIdx] : undefined;
  return {
    fleetGasMMcf: fleet,
    baselineFleetGasMMcf: baseline,
    netSavedMMcf: baseline - fleet,
    netSavedMMcfdDuringEvent: (baseline - fleet) / eventDays,
    eventHourSavedMMcf: eventHourSaved,
    peakHourReliefMMcfh: peak ? peak.baselineFleetGasMMcfh - peak.fleetGasMMcfh : 0,
    degreeHoursBelowNormal,
    uncoveredShortfallMMcf: uncovered,
  };
}

export function compareStrategies(sc: Scenario, cohorts: CohortParams[], cfg: FleetConfig, consts: ModelConstants): Record<'BASELINE' | 'NAIVE_4H' | 'SUSTAIN_STAGGER', RunResult> {
  return {
    BASELINE: runPlan(sc, cohorts, cfg, planBaseline(sc, cohorts), consts),
    NAIVE_4H: runPlan(sc, cohorts, cfg, planNaive4h(sc, cohorts, cfg), consts),
    SUSTAIN_STAGGER: runPlan(sc, cohorts, cfg, planSustainStagger(sc, cohorts, cfg), consts),
  };
}
