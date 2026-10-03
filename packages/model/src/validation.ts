import { planBaseline, runPlan } from './strategies';
import type { CohortParams, FleetConfig, ModelConstants, Plan, Scenario } from './types';

// Event-day checks against published pilot results (AGENTS.md Section 10, E4).
// Each check runs the whole cohort mix through runPlan for two days at a constant outdoor temperature and a
// fixed setpoint (no night setback), with a −4°F setback 06:00–10:00 on day 2. Day 1 is warm-up; day 2 is measured.

type HourlyCf = { hour: number; baselineCf: number; eventCf: number }[];

const EVENT_DEPTH_F = 4;
const EVENT_START_CLOCK = 6;
const EVENT_END_CLOCK = 10;
const DAY2 = 24;

interface EventDay {
  hourly: HourlyCf;        // per home, day 2, clock hours 0..23
  baselineDailyCf: number;
  eventDailyCf: number;
  baselineEventHoursCf: number;
  eventEventHoursCf: number;
}

function simulateEventDay(cohorts: CohortParams[], consts: ModelConstants, outdoorF: number, setpointF: number): EventDay {
  const fixed = cohorts.map((c) => ({ ...c, setpointDayF: setpointF, setpointNightF: setpointF }));
  const hours = 48;
  const sc: Scenario = {
    id: 'validation', name: 'Validation event day', kind: 'synthetic',
    startIso: '2026-01-01T00:00:00-09:00', hours,
    outdoorF: new Array<number>(hours).fill(outdoorF), systemMMcfh: new Array<number>(hours).fill(0),
    eventStartHour: DAY2 + EVENT_START_CLOCK, eventEndHour: DAY2 + EVENT_END_CLOCK,
    capacityMMcfd: 1e9, capacityNote: '', source: 'validation',
  };
  const homes = 1e6; // fleet gas in MMcf/h equals cf per home
  const cfg: FleetConfig = { enrolledHomes: homes, exemptShare: 0, floorF: consts.floorMinF, maxDepthF: EVENT_DEPTH_F, overrideRate: 0, capacityMMcfd: 1e9, seed: 1 };
  const plan: Plan = planBaseline(sc, fixed);
  plan.strategy = 'NAIVE_4H';
  for (const c of fixed) for (let h = sc.eventStartHour; h < sc.eventEndHour; h++) plan.targetsF[c.id][h] = setpointF - EVENT_DEPTH_F;
  const run = runPlan(sc, fixed, cfg, plan, consts);

  const hourly: HourlyCf = [];
  let baselineDailyCf = 0, eventDailyCf = 0, baselineEventHoursCf = 0, eventEventHoursCf = 0;
  for (let k = 0; k < 24; k++) {
    const r = run.hours[DAY2 + k];
    const baselineCf = (r.baselineFleetGasMMcfh * 1e6) / homes;
    const eventCf = (r.fleetGasMMcfh * 1e6) / homes;
    hourly.push({ hour: k, baselineCf, eventCf });
    baselineDailyCf += baselineCf;
    eventDailyCf += eventCf;
    if (k >= EVENT_START_CLOCK && k < EVENT_END_CLOCK) {
      baselineEventHoursCf += baselineCf;
      eventEventHoursCf += eventCf;
    }
  }
  return { hourly, baselineDailyCf, eventDailyCf, baselineEventHoursCf, eventEventHoursCf };
}

/** ConEd-like: To 30°F, 70°F, −4°F 06:00–10:00. Retention = net daily saving ÷ event-hour saving (target 0.48). */
export function validateConEdLike(cohorts: CohortParams[], consts: ModelConstants): { retention: number; band: [number, number]; pass: boolean; hourly: HourlyCf } {
  const d = simulateEventDay(cohorts, consts, 30, 70);
  const eventSaved = d.baselineEventHoursCf - d.eventEventHoursCf;
  const retention = eventSaved > 0 ? (d.baselineDailyCf - d.eventDailyCf) / eventSaved : 0;
  const band = consts.conedBand;
  return { retention, band, pass: retention >= band[0] && retention <= band[1], hourly: d.hourly };
}

/**
 * SoCal-like: To 45°F, 68°F, −4°F 06:00–10:00. The response rate r (share of homes that actually set back) is
 * fitted so the fleet's event-hour reduction equals socal_event_pct; the model's daily reduction is then r times
 * the per-responder daily reduction. Hourly values are fleet-average per home at the fitted r.
 */
export function validateSoCalLike(cohorts: CohortParams[], consts: ModelConstants): { responseRate: number; eventPct: number; dailyPct: number; band: [number, number]; pass: boolean; hourly: HourlyCf } {
  const d = simulateEventDay(cohorts, consts, 45, 68);
  const responderEventPct = (100 * (d.baselineEventHoursCf - d.eventEventHoursCf)) / d.baselineEventHoursCf;
  const responderDailyPct = (100 * (d.baselineDailyCf - d.eventDailyCf)) / d.baselineDailyCf;
  const responseRate = responderEventPct > 0 ? Math.min(1, consts.socalEventPct / responderEventPct) : 0;
  const eventPct = responseRate * responderEventPct;
  const dailyPct = responseRate * responderDailyPct;
  const band = consts.socalDailyBand;
  const hourly = d.hourly.map((x) => ({ hour: x.hour, baselineCf: x.baselineCf, eventCf: x.baselineCf + responseRate * (x.eventCf - x.baselineCf) }));
  return { responseRate, eventPct, dailyPct, band, pass: dailyPct >= band[0] && dailyPct <= band[1], hourly };
}

/** Anchorage sanity: fleet-average Mcf per home per day at a constant −20°F and 70°F, no setback (expect ~1.0). */
export function anchorageSanity(cohorts: CohortParams[], consts: ModelConstants): { mcfPerHomeDay: number } {
  const d = simulateEventDay(cohorts, consts, -20, 70);
  return { mcfPerHomeDay: d.baselineDailyCf / 1000 };
}
