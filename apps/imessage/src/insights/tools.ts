// Insights tools (CHAT brief §7.2): deterministic code over the live mirror and packages/model.
// The model only picks tools and writes prose; every number it may say comes from these outputs.
import type Anthropic from '@anthropic-ai/sdk';
import { whatIf } from '@thermal-reserve/model';
import type { ChatConstants } from '../config';
import type { HouseholdView, SimView, World } from '../types';
import { clockLabel, degF } from '../watcher/compose';
import { heatMode, SETBACK_ENTER_F } from '../watcher/detect';
import { cohorts, compare, constantsJson, modelConstants, scenario } from './model';

type Label = 'sourced' | 'derived' | 'assumed';
export interface Num { value: number; unit: string; label: Label | string; }
const num = (value: number, unit: string, label: Label | string, digits = 2): Num => ({ value: round(value, digits), unit, label });
export const round = (x: number, digits = 2) => Math.round(x * 10 ** digits) / 10 ** digits;
const mmcf = (x: number) => `${round(x, 2).toFixed(2)} MMcf`;

const SIMULATED = 'derived · simulated';
const constLabel = (key: string) => constantsJson[key]?.label ?? 'assumed';

export interface ToolContext {
  world: World;
  consts: ChatConstants;
  identity: string;            // the asker's household; tools never take another identity
}

export class ToolError extends Error {}

function need(ctx: ToolContext): { sim: SimView; h: HouseholdView } {
  const sim = ctx.world.sim();
  const h = ctx.world.household(ctx.identity);
  if (!sim) throw new ToolError('No scenario is loaded yet.');
  if (!h) throw new ToolError('This household is not in the current simulation.');
  return { sim, h };
}

const clampHour = (sim: SimView, hour: unknown) => {
  const n = typeof hour === 'number' && Number.isFinite(hour) ? hour : sim.simHour;
  return Math.max(0, Math.min(sim.hours - 1, Math.floor(n)));
};

// Planned target for the household's template cohort, or the normal setpoint when the plan says
// "follow normal" (or there is no plan, or the household is exempt or overridden).
function plannedTargetF(ctx: ToolContext, sim: SimView, h: HouseholdView, hour: number): number {
  if (h.exempt || sim.strategy === 'BASELINE') return ctx.consts.setpointDayF;
  const t = ctx.world.planTargetF(h.cohortId, hour);
  return t === undefined ? ctx.consts.setpointDayF : Math.min(ctx.consts.setpointDayF, Math.max(sim.floorF, t));
}

function scenarioInfo(sim: SimView) {
  const sc = scenario(sim.scenarioId);
  return { id: sim.scenarioId, name: sc?.name ?? sim.scenarioId, kind: sc?.kind ?? 'unknown', source: sc?.source ?? 'unknown', capacityNote: sc?.capacityNote ?? '' };
}

// Plain names for the strategies, so an answer never confuses one with another.
export const STRATEGY_NAMES: Record<string, string> = {
  BASELINE: 'no program (nobody\'s heat is lowered)',
  NAIVE_4H: 'simple 4-hour morning setback (-4°F, 06:00-10:00 every event day; what earlier pilots did)',
  SUSTAIN_STAGGER: 'rule-based stagger (smaller setbacks spread across homes and hours)',
  OPTIMIZED: 'optimized plan (computed by the optimizer: the least setback that keeps each gas day under capacity)',
  MAX_RELIEF: 'maximum-relief plan (computed by the optimizer: as much relief as the comfort limits allow)',
};

const dispatchedFor = (ctx: ToolContext, sim: SimView) => ctx.world.dispatchedPlan(cohorts.length, sim.hours);

// ---------- tools ----------

export function householdNow(ctx: ToolContext) {
  const { sim, h } = need(ctx);
  const mode = heatMode(h, ctx.consts.setpointDayF);
  return {
    nickname: h.nickname,
    simulatedTime: clockLabel(sim.startIso, sim.simHour),
    simHour: round(sim.simHour, 1),
    runStatus: sim.status,
    strategy: sim.strategy,
    indoorF: num(h.taF, '°F', SIMULATED, 1),
    targetF: num(mode === 'overridden' || mode === 'exempt' ? ctx.consts.setpointDayF : h.targetF, '°F', SIMULATED, 1),
    normalSetpointF: num(ctx.consts.setpointDayF, '°F', constLabel('setpoint_day_f')),
    floorF: num(Math.max(h.floorF, ctx.consts.floorDefaultF), '°F', constLabel('floor_default_f')),
    status: mode,
    overridden: h.overridden,
    exempt: h.exempt,
    netSavedCf: num(h.savedCf, 'cubic feet', `${SIMULATED}; includes reheat`, 0),
    homeType: 'gas furnace or boiler, average insulation, light thermal mass (simulation template)',
    eventWindow: { start: clockLabel(sim.startIso, sim.eventStartHour), end: clockLabel(sim.startIso, sim.eventEndHour) },
  };
}

export function planWindow(ctx: ToolContext, input: { fromHour?: number; toHour?: number }) {
  const { sim, h } = need(ctx);
  const from = clampHour(sim, input.fromHour);
  const to = Math.min(clampHour(sim, input.toHour ?? from + 23), from + 47);
  const hours = [];
  for (let hour = from; hour <= to; hour++) {
    const t = plannedTargetF(ctx, sim, h, hour);
    hours.push({ hour, clock: clockLabel(sim.startIso, hour, true), plannedTargetF: round(t, 1), setbackF: round(ctx.consts.setpointDayF - t, 1) });
  }
  return { strategy: sim.strategy, planId: sim.planId, normalSetpointF: num(ctx.consts.setpointDayF, '°F', constLabel('setpoint_day_f')), label: 'derived (dispatch plan for this home type)', hours };
}

export function weather(ctx: ToolContext, input: { fromHour?: number; toHour?: number }) {
  const sim = ctx.world.sim();
  if (!sim) throw new ToolError('No scenario is loaded yet.');
  const from = clampHour(sim, input.fromHour);
  const to = Math.min(clampHour(sim, input.toHour ?? from + 23), from + 47);
  const info = scenarioInfo(sim);
  const rows = ctx.world.weather().filter(w => w.hour >= from && w.hour <= to);
  const temps = rows.map(r => r.outdoorF);
  return {
    scenario: info.name,
    source: info.source,
    label: info.kind === 'replay' ? 'sourced (ACIS daily max/min; hourly shape assumed)' : 'assumed (synthetic scenario)',
    minOutdoorF: temps.length ? round(Math.min(...temps), 1) : null,
    maxOutdoorF: temps.length ? round(Math.max(...temps), 1) : null,
    hours: rows.map(r => ({ hour: r.hour, clock: clockLabel(sim.startIso, r.hour, true), outdoorF: round(r.outdoorF, 1) })),
  };
}

export function gasDay(ctx: ToolContext, input: { day?: number }) {
  const sim = ctx.world.sim();
  if (!sim) throw new ToolError('No scenario is loaded yet.');
  const result = compare(sim);
  if (!result) throw new ToolError(`Scenario ${sim.scenarioId} is not available to the model.`);
  const day = Math.max(0, Math.min(result.days.length - 1, Math.floor(input.day ?? sim.simHour / 24)));
  const d = result.days[day];
  const live = ctx.world.aggregates().filter(a => a.hour >= day * 24 && a.hour < day * 24 + 24);
  const info = scenarioInfo(sim);
  return {
    day,
    starts: clockLabel(sim.startIso, day * 24),
    noProgramDemand: num(d.noProgramDemandMMcf, 'MMcf/day', 'derived (system fit × demand shape)'),
    capacity: num(d.capacityMMcf, 'MMcf/day', `assumed (hypothetical): ${info.capacityNote}`),
    shortfallWithoutProgram: num(d.shortfallMMcf, 'MMcf/day', 'derived'),
    liveReliefSoFar: num(live.reduce((s, a) => s + a.reliefMMcf, 0), 'MMcf', `${SIMULATED}; ${live.length} completed hours`),
    liveHoursCompleted: live.length,
  };
}

export function compareStrategiesTool(ctx: ToolContext) {
  const sim = ctx.world.sim();
  if (!sim) throw new ToolError('No scenario is loaded yet.');
  const live = dispatchedFor(ctx, sim);
  const result = compare(sim, live);
  if (!result) throw new ToolError(`Scenario ${sim.scenarioId} is not available to the model.`);
  const liveKey = live ? sim.strategy : 'BASELINE';
  const entries: { key: string; run: typeof result.runs.BASELINE }[] = [
    { key: 'BASELINE', run: result.runs.BASELINE },
    { key: 'NAIVE_4H', run: result.runs.NAIVE_4H },
    { key: 'SUSTAIN_STAGGER', run: result.runs.SUSTAIN_STAGGER },
  ];
  if (live && result.dispatched && !['BASELINE', 'NAIVE_4H', 'SUSTAIN_STAGGER'].includes(sim.strategy)) entries.push({ key: sim.strategy, run: result.dispatched });
  const uncoveredFor = (key: string, d: (typeof result.days)[number]) =>
    key === sim.strategy && d.uncoveredMMcf.DISPATCHED !== undefined ? d.uncoveredMMcf.DISPATCHED
      : d.uncoveredMMcf[key as 'BASELINE' | 'NAIVE_4H' | 'SUSTAIN_STAGGER'] ?? 0;
  return {
    scenario: scenarioInfo(sim).name,
    enrolledHomes: sim.enrolledHomes,
    thisHomeIsOn: STRATEGY_NAMES[liveKey] ?? liveKey,
    note: 'Each strategy below was simulated on the same scenario and settings. "uncovered" is that gas day\'s demand above capacity under the strategy (0 = covered). "netSaved" is gas saved over the whole run including reheat. Only the strategy marked thisHomeIsOn is the one this home actually ran; the others are comparisons.',
    label: 'derived (model runs, simulated)',
    strategies: entries.map(({ key, run }) => ({
      strategy: STRATEGY_NAMES[key] ?? key,
      thisHomeIsOn: key === liveKey,
      netSavedMMcf: round(run.totals.netSavedMMcf, 2),
      peakHourReliefMMcfh: round(run.totals.peakHourReliefMMcfh, 3),
      uncoveredByDayMMcf: result.days.map(d => ({ day: d.day, starts: clockLabel(sim.startIso, d.day * 24, true), uncovered: round(uncoveredFor(key, d), 2) })),
    })),
  };
}

// The core "why": a structured reason list for one hour of this household's plan.
export function explainDecision(ctx: ToolContext, input: { hour?: number }) {
  const { sim, h } = need(ctx);
  const hour = clampHour(sim, input.hour);
  const normalF = ctx.consts.setpointDayF;
  const floorF = Math.max(h.floorF, ctx.consts.floorDefaultF);
  const target = plannedTargetF(ctx, sim, h, hour);
  const before = hour > 0 ? plannedTargetF(ctx, sim, h, hour - 1) : normalF;
  const depth = normalF - target;
  const result = compare(sim, dispatchedFor(ctx, sim));
  const dayIndex = Math.floor(hour / 24);
  const day = result?.days[dayIndex];
  const clock = clockLabel(sim.startIso, hour);
  const dayName = clockLabel(sim.startIso, dayIndex * 24).split(' ').slice(0, 3).join(' ');
  const reasons: string[] = [];
  let action: 'setback' | 'recovery' | 'normal' | 'overridden' | 'exempt' | 'no_plan';

  if (h.exempt) {
    action = 'exempt';
    reasons.push(`${h.nickname} is marked as needing steady heat, so it stays at ${degF(normalF)} through every event.`);
  } else if (h.overridden && Math.abs(hour - sim.simHour) < 1) {
    action = 'overridden';
    reasons.push(`${h.nickname} is overridden, so it is on normal heat (${degF(normalF)}); other homes cover its share.`);
  } else if (sim.strategy === 'BASELINE' || !sim.planId) {
    action = 'no_plan';
    reasons.push('No setback plan is dispatched in this run, so heat follows the normal setpoint.');
  } else if (depth >= SETBACK_ENTER_F) {
    action = 'setback';
    reasons.push(`At ${clock} the plan holds ${h.nickname} at ${degF(target)}, ${degF(depth)} below normal (the most allowed is ${degF(sim.maxDepthF)}, and never below ${degF(floorF)}).`);
  } else if (before <= normalF - SETBACK_ENTER_F) {
    action = 'recovery';
    reasons.push(`At ${clock} the plan raises ${h.nickname} back to ${degF(normalF)} after holding at ${degF(before)}.`);
  } else {
    action = 'normal';
    reasons.push(`At ${clock} the plan keeps ${h.nickname} at the normal ${degF(normalF)}.`);
  }

  let shortfallDay: { day: number; starts: string; shortfallMMcf: number } | undefined;
  if (day) {
    if (day.shortfallMMcf > 0) {
      reasons.push(`That hour belongs to the gas day starting ${dayName}: without the program, demand is ${mmcf(day.noProgramDemandMMcf)} against capacity of ${mmcf(day.capacityMMcf)}, a shortfall of ${mmcf(day.shortfallMMcf)}.`);
    } else {
      reasons.push(`That hour belongs to the gas day starting ${dayName}, which has spare capacity: demand ${mmcf(day.noProgramDemandMMcf)} against capacity ${mmcf(day.capacityMMcf)}.`);
    }
    if (action === 'setback') {
      reasons.push(day.shortfallMMcf > 0
        ? 'The setback is there to cover that day\'s shortfall; the optimizer spreads it across homes and hours to keep each one as small as possible.'
        : 'This day has no shortfall of its own; the optimizer lowers heat here so the home is already cool when a short day begins.');
    }
    if (action === 'recovery') {
      reasons.push(day.shortfallMMcf > 0
        ? 'The reheat lands on a short day; the optimizer judged it the least costly place for it.'
        : 'The reheat happens on a day with spare capacity, so it doesn\'t add to a shortfall.');
    }
    if (day.shortfallMMcf > 0 && action !== 'exempt') {
      const mine = day.uncoveredMMcf.DISPATCHED;
      const own = mine === undefined ? '' : ` The ${sim.strategy === 'OPTIMIZED' ? 'optimized plan this home is on' : 'plan this home is on'} leaves ${mmcf(mine)} uncovered.`;
      reasons.push(`For comparison, a simple 4-hour morning setback would leave ${mmcf(day.uncoveredMMcf.NAIVE_4H)} uncovered that day, and no program would leave ${mmcf(day.uncoveredMMcf.BASELINE)}.${own}`);
    }
    if (action === 'setback' && day.shortfallMMcf === 0 && result) {
      const next = result.days.find(d => d.day > dayIndex && d.shortfallMMcf > 0);
      if (next) shortfallDay = { day: next.day, starts: clockLabel(sim.startIso, next.day * 24), shortfallMMcf: round(next.shortfallMMcf, 2) };
    }
  }

  return {
    hour,
    clock,
    action,
    plannedTargetF: num(target, '°F', 'derived (dispatch plan)', 1),
    normalSetpointF: num(normalF, '°F', constLabel('setpoint_day_f')),
    setbackDepthF: num(Math.max(0, depth), '°F', 'derived', 1),
    maxDepthF: num(sim.maxDepthF, '°F', 'assumed (operator setting)'),
    floorF: num(floorF, '°F', constLabel('floor_default_f')),
    gasDay: day ? {
      day: dayIndex,
      starts: dayName,
      noProgramDemand: num(day.noProgramDemandMMcf, 'MMcf/day', 'derived'),
      capacity: num(day.capacityMMcf, 'MMcf/day', 'assumed (hypothetical)'),
      shortfallWithoutProgram: num(day.shortfallMMcf, 'MMcf/day', 'derived'),
      uncoveredWithNaive4h: num(day.uncoveredMMcf.NAIVE_4H, 'MMcf/day', 'derived (model run)'),
      uncoveredWithThisHomesPlan: day.uncoveredMMcf.DISPATCHED === undefined ? null : num(day.uncoveredMMcf.DISPATCHED, 'MMcf/day', 'derived (model run of the dispatched plan)'),
    } : null,
    thisHomeIsOn: STRATEGY_NAMES[sim.strategy] ?? sim.strategy,
    nextShortfallDay: shortfallDay ?? null,
    reasons,
    simulated: true,
  };
}

export function constant(_ctx: ToolContext, input: { key: string }) {
  const c = constantsJson[input.key] as { value: unknown; unit?: string; label?: string; source?: string } | undefined;
  if (!c) throw new ToolError(`Unknown constant ${input.key}. Known keys: ${Object.keys(constantsJson).join(', ')}`);
  return { key: input.key, value: c.value, unit: c.unit ?? '', label: c.label ?? 'assumed', source: c.source ?? '' };
}

export function whatIfTool(_ctx: ToolContext, input: { participationPct: number; setbackF: number; outdoorF?: number; days?: number; tier2Pct?: number }) {
  const r = whatIf({
    participationPct: input.participationPct, setbackF: input.setbackF,
    outdoorF: input.outdoorF ?? -20, days: input.days ?? 3, tier2Pct: input.tier2Pct ?? 0,
  }, modelConstants);
  return {
    inputs: { participationPct: input.participationPct, setbackF: input.setbackF, outdoorF: input.outdoorF ?? -20, days: input.days ?? 3, tier2Pct: input.tier2Pct ?? 0 },
    customers: num(Number(constantsJson.customers?.value ?? 0), 'customers', constLabel('customers'), 0),
    mmcfPerDay: num(r.mmcfPerDay, 'MMcf/day', 'derived (steady state)'),
    shareOfNeedlePeakPct: num(r.needlePeakShare * 100, '%', 'derived'),
    shareOfDeliverabilityLossPct: num(r.deliverabilityLossShare * 100, '%', 'derived'),
    shareOfShortfallPct: num(r.shortfallShare * 100, '%', 'derived'),
    usdPerDay: num(Math.round(r.usdPerDay / 100) * 100, 'USD/day', 'derived', 0),
    formulaLines: r.formulaLines,
  };
}

// ---------- registry ----------

const hourProp = { type: 'number', description: 'Simulation hour from scenario start (0 = first hour). Omit for the current hour.' } as const;

export const TOOLS: Anthropic.Tool[] = [
  { name: 'household_now', description: "The asker's home right now: indoor and target °F, normal setpoint, floor, status, net gas saved, simulated clock, event window.", input_schema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'explain_decision', description: 'The reasons behind the plan for this home at one hour: setback, recovery or normal; that gas day\'s demand vs capacity and shortfall; depth vs the maximum and the floor; what a simple 4-hour setback or no program would leave uncovered. Use this for any "why" question.', input_schema: { type: 'object', properties: { hour: hourProp }, additionalProperties: false } },
  { name: 'plan_window', description: "Planned heat target per hour for this home's type, between two hours (at most 48).", input_schema: { type: 'object', properties: { fromHour: hourProp, toHour: hourProp }, additionalProperties: false } },
  { name: 'weather', description: 'Outdoor °F per hour from the scenario, with its source.', input_schema: { type: 'object', properties: { fromHour: hourProp, toHour: hourProp }, additionalProperties: false } },
  { name: 'gas_day', description: 'One gas day (24 h from scenario start): no-program system demand, capacity, shortfall, and live relief so far.', input_schema: { type: 'object', properties: { day: { type: 'number', description: 'Gas day index from scenario start (0-based). Omit for today.' } }, additionalProperties: false } },
  { name: 'compare_strategies', description: 'The strategy this home is on (thisHomeIsOn) and, for comparison, no program, a simple 4-hour morning setback and a rule-based stagger: per gas day how much demand each leaves above capacity, plus net savings. Always say which strategy a number belongs to.', input_schema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'constant', description: 'One sourced/derived/assumed constant from data/constants.json with its unit, label and source (e.g. needle_peak_mmcfd, marginal_price_usd_mcf, floor_default_f, customers, shortfall_bcf).', input_schema: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'], additionalProperties: false } },
  { name: 'what_if', description: 'Steady-state what-if for many homes: MMcf/day saved, share of the needle peak, of the 2024 deliverability loss and of the shortfall, dollars per day, with formulas.', input_schema: { type: 'object', properties: { participationPct: { type: 'number', description: 'Percent of ~150,000 customers, 0–50' }, setbackF: { type: 'number', description: '1–10 °F' }, outdoorF: { type: 'number' }, days: { type: 'number' }, tier2Pct: { type: 'number' } }, required: ['participationPct', 'setbackF'], additionalProperties: false } },
];

export function runTool(ctx: ToolContext, name: string, input: Record<string, unknown>): unknown {
  switch (name) {
    case 'household_now': return householdNow(ctx);
    case 'explain_decision': return explainDecision(ctx, input as { hour?: number });
    case 'plan_window': return planWindow(ctx, input as { fromHour?: number; toHour?: number });
    case 'weather': return weather(ctx, input as { fromHour?: number; toHour?: number });
    case 'gas_day': return gasDay(ctx, input as { day?: number });
    case 'compare_strategies': return compareStrategiesTool(ctx);
    case 'constant': return constant(ctx, input as { key: string });
    case 'what_if': return whatIfTool(ctx, input as { participationPct: number; setbackF: number });
    default: throw new ToolError(`Unknown tool ${name}`);
  }
}
