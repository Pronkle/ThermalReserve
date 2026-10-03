// Thermal Reserve Spacetime module (Contract C, AGENTS.md Section 8).
// S1: simulation clock and the baseline twin. S2: plans, simulated overrides, reassignment,
// event log, operator passcode. S3: households.
// Reducer exports are snake_case so the reducer names match the contract verbatim.
import { ScheduleAt } from 'spacetimedb';
import { SenderError, t, type InferSchema, type ReducerCtx } from 'spacetimedb/server';
import { SUBSTEP_HOURS, gasCf, heatToHold, normalSetpointF, stepState } from './physics';
import type { CohortParams, HeatingType, ThermalState } from './types';
import spacetimedb, { tickSchedule } from './schema';

export { default } from './schema';

type Ctx = ReducerCtx<InferSchema<typeof spacetimedb>>;

const SUBSTEPS_PER_HOUR = Math.round(1 / SUBSTEP_HOURS);
const TICK_INTERVAL_MICROS = 1_000_000n;
const FLOOR_MIN_F = 60;
const MAX_HOMES_PER_CHUNK = 250;
const NICKNAME_MAX = 24;
// S5 input limits (AGENTS.md §12 S5; ranges set by H1 via STDB's request).
const FLOOR_MAX_F = 70;
const ENROLLED_MIN = 1_000;
const ENROLLED_MAX = 50_000;
const MAX_DEPTH_F = 10;
const SPEED_MIN = 0.5;
const SPEED_MAX = 4;
const HOURS_MAX = 240;
const COHORTS_MAX = 64;
const SAMPLE_HOMES_MAX = 2_000;
const HOUSEHOLDS_MAX = 50;
const TARGET_MIN_F = 40;
const TARGET_MAX_F = 80;
// Fallback household position when no sample homes are loaded: the map center (Section 9).
const MAP_CENTER = { lat: 61.2, lon: -149.9 };
const STRATEGIES = ['BASELINE', 'NAIVE_4H', 'OPTIMIZED', 'MAX_RELIEF', 'SUSTAIN_STAGGER'];

// ---------- helpers ----------

function getConfig(ctx: Ctx) {
  const cfg = ctx.db.simConfig.id.find(0);
  if (!cfg) throw new SenderError('sim_config row missing');
  return cfg;
}

function requireOperator(ctx: Ctx) {
  const cfg = getConfig(ctx);
  if (!cfg.operator || !cfg.operator.equals(ctx.sender)) {
    throw new SenderError('operator only: call claim_operator first');
  }
  return cfg;
}

function parseJson(json: string, what: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    throw new SenderError(`${what}: invalid JSON`);
  }
}

function num(v: unknown, what: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new SenderError(`${what}: expected a finite number`);
  return v;
}

function str(v: unknown, what: string): string {
  if (typeof v !== 'string') throw new SenderError(`${what}: expected a string`);
  return v;
}

function obj(v: unknown, what: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SenderError(`${what}: expected an object`);
  return v as Record<string, unknown>;
}

function arr(v: unknown, what: string): unknown[] {
  if (!Array.isArray(v)) throw new SenderError(`${what}: expected an array`);
  return v;
}

function int(v: unknown, what: string, min: number, max: number): number {
  const n = num(v, what);
  if (!Number.isInteger(n) || n < min || n > max) throw new SenderError(`${what}: expected a whole number from ${min} to ${max}`);
  return n;
}

function inRange(v: unknown, what: string, min: number, max: number): number {
  const n = num(v, what);
  if (n < min || n > max) throw new SenderError(`${what}: must be between ${min} and ${max}`);
  return n;
}

function positive(v: unknown, what: string): number {
  const n = num(v, what);
  if (n <= 0) throw new SenderError(`${what}: must be positive`);
  return n;
}

// Fleet settings shared by load_scenario and set_params. Missing keys keep `current`.
// The comfort floor is raised to 60 °F if lower (the safety rule) and rejected above 70 °F.
function fleetSettings(fc: Record<string, unknown>, current: {
  enrolled_homes: number; exempt_share: number; floor_f: number; max_depth_f: number;
  override_rate: number; speed_hours_per_sec: number; homes_per_dot: number; capacity_mmcfd: number;
}) {
  const has = (k: string) => fc[k] !== undefined && fc[k] !== null;
  const floor = has('floorF') ? num(fc.floorF, 'config.floorF') : current.floor_f;
  if (floor > FLOOR_MAX_F) throw new SenderError(`config.floorF: must be at most ${FLOOR_MAX_F} °F`);
  return {
    enrolled_homes: has('enrolledHomes') ? int(fc.enrolledHomes, 'config.enrolledHomes', ENROLLED_MIN, ENROLLED_MAX) : current.enrolled_homes,
    exempt_share: has('exemptShare') ? inRange(fc.exemptShare, 'config.exemptShare', 0, 1) : current.exempt_share,
    floor_f: Math.max(FLOOR_MIN_F, floor),
    max_depth_f: has('maxDepthF') ? inRange(fc.maxDepthF, 'config.maxDepthF', 0, MAX_DEPTH_F) : current.max_depth_f,
    override_rate: has('overrideRate') ? inRange(fc.overrideRate, 'config.overrideRate', 0, 1) : current.override_rate,
    speed_hours_per_sec: has('speedHoursPerSec') ? inRange(fc.speedHoursPerSec, 'config.speedHoursPerSec', SPEED_MIN, SPEED_MAX) : current.speed_hours_per_sec,
    homes_per_dot: has('homesPerDot') ? positive(fc.homesPerDot, 'config.homesPerDot') : current.homes_per_dot,
    capacity_mmcfd: has('capacityMMcfd') ? positive(fc.capacityMMcfd, 'config.capacityMMcfd') : current.capacity_mmcfd,
  };
}

// Local clock hour at scenario start, read from the ISO string's own wall-clock fields.
function startClockHour(startIso: string): number {
  const m = /T(\d{2}):(\d{2})/.exec(startIso);
  return m ? Number(m[1]) + Number(m[2]) / 60 : 0;
}

function clockHour(startIso: string, simHour: number): number {
  return (((startClockHour(startIso) + simHour) % 24) + 24) % 24;
}

type CohortRow = NonNullable<ReturnType<Ctx['db']['cohort']['id']['find']>>;

function toParams(r: CohortRow): CohortParams {
  return {
    id: r.id,
    key: r.key,
    heating: r.heating as HeatingType,
    share: r.share,
    UA: r.ua,
    Uao: r.uao,
    Umo: r.umo,
    Ham: r.ham,
    Ca: r.ca,
    Cm: r.cm,
    QmaxBtuH: r.qmax_btuh,
    eta: r.eta,
    setpointDayF: r.setpoint_day_f,
    setpointNightF: r.setpoint_night_f,
    nightStartHour: r.night_start_hour,
    nightEndHour: r.night_end_hour,
  };
}

function logEvent(ctx: Ctx, simHour: number, kind: string, message: string) {
  ctx.db.eventLog.insert({ id: 0n, sim_hour: simHour, kind, message, at: ctx.timestamp });
}

function stopSchedule(ctx: Ctx) {
  for (const row of [...ctx.db.tickSchedule.iter()]) {
    ctx.db.tickSchedule.scheduled_id.delete(row.scheduled_id);
  }
}

// Both twins start with air at the normal setpoint for the scenario's first clock hour and
// the mass at its steady-state temperature for hour 0's outdoor temperature, as runPlan does.
function initStates(ctx: Ctx, startIso: string) {
  for (const row of [...ctx.db.cohortState.iter()]) ctx.db.cohortState.cohort_id.delete(row.cohort_id);
  const clock = clockHour(startIso, 0);
  const outdoor0 = ctx.db.weatherHour.hour.find(0)?.outdoor_f;
  for (const row of [...ctx.db.cohort.iter()]) {
    const sp = normalSetpointF(toParams(row), clock);
    const tm = outdoor0 === undefined ? sp : (row.ham * sp + row.umo * outdoor0) / (row.ham + row.umo);
    ctx.db.cohortState.insert({
      cohort_id: row.id,
      ta_f: sp,
      tm_f: tm,
      q_btuh: 0,
      target_f: sp,
      base_ta_f: sp,
      base_tm_f: tm,
      gas_cf_this_hour: 0,
      base_gas_cf_this_hour: 0,
      overridden_share: 0,
      mode: 'normal',
    });
  }
}

function clearRun(ctx: Ctx) {
  stopSchedule(ctx);
  for (const row of [...ctx.db.aggregateHour.iter()]) ctx.db.aggregateHour.hour.delete(row.hour);
  for (const row of [...ctx.db.eventLog.iter()]) ctx.db.eventLog.id.delete(row.id);
  for (const row of [...ctx.db.sampleHome.iter()]) {
    if (row.overridden) ctx.db.sampleHome.id.update({ ...row, overridden: false });
  }
}

// Households keep their enrollment but restart from their template cohort's state.
function resetHouseholdStates(ctx: Ctx) {
  for (const hh of [...ctx.db.household.iter()]) {
    const cs = ctx.db.cohortState.cohort_id.find(hh.cohort_id) ?? [...ctx.db.cohortState.iter()][0];
    if (!cs) continue;
    ctx.db.household.identity.update({
      ...hh,
      cohort_id: cs.cohort_id,
      ta_f: cs.ta_f,
      tm_f: cs.tm_f,
      base_ta_f: cs.base_ta_f,
      base_tm_f: cs.base_tm_f,
      target_f: cs.target_f,
      overridden: false,
      saved_cf: 0,
    });
  }
}

function setOnline(ctx: Ctx, online: boolean) {
  const hh = ctx.db.household.identity.find(ctx.sender);
  if (hh && hh.online !== online) ctx.db.household.identity.update({ ...hh, online });
}

// Plain text only: drop markup characters and control characters, collapse whitespace.
function cleanText(v: string, max: number): string {
  return v.replace(/[<>&"`\\]/g, '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

// ---------- lifecycle ----------

export const init = spacetimedb.init(ctx => {
  ctx.db.simConfig.insert({
    id: 0,
    scenario_id: '',
    status: 'idle',
    sim_hour: 0,
    speed_hours_per_sec: 2,
    strategy: 'BASELINE',
    plan_id: '',
    enrolled_homes: 25000,
    exempt_share: 0.08,
    floor_f: 62,
    max_depth_f: 5,
    capacity_mmcfd: 0,
    override_rate: 0.06,
    hours: 0,
    event_start_hour: 0,
    event_end_hour: 0,
    homes_per_dot: 25,
    operator: undefined,
    updated_at: ctx.timestamp,
    start_iso: '',
    hhv_btu_per_cf: 0,
  });
});

export const onConnect = spacetimedb.clientConnected(ctx => setOnline(ctx, true));

export const onDisconnect = spacetimedb.clientDisconnected(ctx => setOnline(ctx, false));

// ---------- operator reducers ----------

export const claim_operator = spacetimedb.reducer(
  { passcode: t.string() },
  (ctx, { passcode }) => {
    // The first claim sets the passcode. A later claim with the same passcode takes over,
    // so the team can recover if the operator's browser loses its identity.
    const cfg = getConfig(ctx);
    const secret = ctx.db.operatorSecret.id.find(0);
    if (!secret) {
      if (passcode.length < 4) throw new SenderError('passcode must be at least 4 characters');
      ctx.db.operatorSecret.insert({ id: 0, passcode });
    } else if (secret.passcode !== passcode) {
      throw new SenderError('wrong passcode');
    }
    if (cfg.operator && cfg.operator.equals(ctx.sender)) return;
    ctx.db.simConfig.id.update({ ...cfg, operator: ctx.sender, updated_at: ctx.timestamp });
    logEvent(ctx, cfg.sim_hour, 'system', 'Operator claimed');
  }
);

// scenario_json: Scenario. cohorts_json: CohortParams[]. config_json: FleetConfig plus
// hhvBtuPerCf (required), speedHoursPerSec and homesPerDot (optional).
export const load_scenario = spacetimedb.reducer(
  { scenario_json: t.string(), cohorts_json: t.string(), config_json: t.string() },
  (ctx, { scenario_json, cohorts_json, config_json }) => {
    const cfg = requireOperator(ctx);
    const sc = obj(parseJson(scenario_json, 'scenario_json'), 'scenario_json');
    const cohorts = arr(parseJson(cohorts_json, 'cohorts_json'), 'cohorts_json');
    const fc = obj(parseJson(config_json, 'config_json'), 'config_json');

    // Validate everything before touching any table (S5).
    const hours = int(sc.hours, 'scenario.hours', 1, HOURS_MAX);
    const outdoorF = arr(sc.outdoorF, 'scenario.outdoorF').map((v, h) => num(v, `scenario.outdoorF[${h}]`));
    const systemMMcfh = arr(sc.systemMMcfh, 'scenario.systemMMcfh').map((v, h) => num(v, `scenario.systemMMcfh[${h}]`));
    if (outdoorF.length !== hours || systemMMcfh.length !== hours) {
      throw new SenderError('scenario: outdoorF and systemMMcfh must each have `hours` entries');
    }
    const eventStart = int(sc.eventStartHour, 'scenario.eventStartHour', 0, hours);
    const eventEnd = int(sc.eventEndHour, 'scenario.eventEndHour', 0, hours);
    if (eventStart >= eventEnd) throw new SenderError('scenario: eventStartHour must be before eventEndHour');
    const startIso = str(sc.startIso, 'scenario.startIso');
    const scenarioId = str(sc.id, 'scenario.id');
    const scenarioCapacity = positive(sc.capacityMMcfd, 'scenario.capacityMMcfd');

    if (cohorts.length < 1 || cohorts.length > COHORTS_MAX) throw new SenderError(`cohorts_json: expected 1 to ${COHORTS_MAX} cohorts`);
    const ids = new Set<number>();
    let shareSum = 0;
    const cohortRows = cohorts.map((raw, i) => {
      const c = obj(raw, `cohort[${i}]`);
      const id = int(c.id, `cohort[${i}].id`, 0, 0xffff_ffff);
      if (ids.has(id)) throw new SenderError(`cohort[${i}].id: duplicate id ${id}`);
      ids.add(id);
      const share = inRange(c.share, `cohort[${i}].share`, 0, 1);
      shareSum += share;
      const eta = num(c.eta, `cohort[${i}].eta`);
      if (eta <= 0 || eta > 1) throw new SenderError(`cohort[${i}].eta: must be above 0 and at most 1`);
      return {
        id,
        key: str(c.key, `cohort[${i}].key`),
        heating: str(c.heating, `cohort[${i}].heating`),
        share,
        ua: positive(c.UA, `cohort[${i}].UA`),
        uao: positive(c.Uao, `cohort[${i}].Uao`),
        umo: positive(c.Umo, `cohort[${i}].Umo`),
        ham: positive(c.Ham, `cohort[${i}].Ham`),
        ca: positive(c.Ca, `cohort[${i}].Ca`),
        cm: positive(c.Cm, `cohort[${i}].Cm`),
        qmax_btuh: positive(c.QmaxBtuH, `cohort[${i}].QmaxBtuH`),
        eta,
        setpoint_day_f: num(c.setpointDayF, `cohort[${i}].setpointDayF`),
        setpoint_night_f: num(c.setpointNightF, `cohort[${i}].setpointNightF`),
        night_start_hour: int(c.nightStartHour, `cohort[${i}].nightStartHour`, 0, 23),
        night_end_hour: int(c.nightEndHour, `cohort[${i}].nightEndHour`, 0, 23),
      };
    });
    if (Math.abs(shareSum - 1) > 1e-6) throw new SenderError(`cohorts_json: shares sum to ${shareSum}, expected 1`);

    const hhv = positive(fc.hhvBtuPerCf, 'config.hhvBtuPerCf');
    const fleet = fleetSettings(fc, { ...cfg, capacity_mmcfd: scenarioCapacity });

    clearRun(ctx);
    for (const row of [...ctx.db.weatherHour.iter()]) ctx.db.weatherHour.hour.delete(row.hour);
    for (const row of [...ctx.db.cohort.iter()]) ctx.db.cohort.id.delete(row.id);
    for (const row of [...ctx.db.planHour.iter()]) ctx.db.planHour.id.delete(row.id);
    for (const row of [...ctx.db.sampleHome.iter()]) ctx.db.sampleHome.id.delete(row.id);

    for (let h = 0; h < hours; h++) {
      ctx.db.weatherHour.insert({ hour: h, outdoor_f: outdoorF[h], system_mmcfh: systemMMcfh[h] });
    }
    for (const row of cohortRows) ctx.db.cohort.insert(row);

    ctx.db.simConfig.id.update({
      ...cfg,
      ...fleet,
      scenario_id: scenarioId,
      status: 'idle',
      sim_hour: 0,
      strategy: 'BASELINE',
      plan_id: '',
      hours,
      event_start_hour: eventStart,
      event_end_hour: eventEnd,
      updated_at: ctx.timestamp,
      start_iso: startIso,
      hhv_btu_per_cf: hhv,
    });

    initStates(ctx, startIso);
    resetHouseholdStates(ctx);
    logEvent(ctx, 0, 'system', `Scenario loaded: ${scenarioId}`);
  }
);

// chunk_json: SampleHome[] (at most 250 per call).
export const load_homes = spacetimedb.reducer(
  { chunk_json: t.string() },
  (ctx, { chunk_json }) => {
    requireOperator(ctx);
    const homes = arr(parseJson(chunk_json, 'chunk_json'), 'chunk_json');
    if (homes.length > MAX_HOMES_PER_CHUNK) {
      throw new SenderError(`chunk_json: at most ${MAX_HOMES_PER_CHUNK} homes per call`);
    }
    let total = [...ctx.db.sampleHome.iter()].length;
    for (const raw of homes) {
      const h = obj(raw, 'home');
      const id = int(h.id, 'home.id', 0, 0xffff_ffff);
      const cohortId = int(h.cohortId, 'home.cohortId', 0, 0xffff_ffff);
      if (!ctx.db.cohort.id.find(cohortId)) throw new SenderError(`home ${id}: no cohort ${cohortId}`);
      const exists = Boolean(ctx.db.sampleHome.id.find(id));
      if (!exists && ++total > SAMPLE_HOMES_MAX) throw new SenderError(`load_homes: at most ${SAMPLE_HOMES_MAX} sample homes in total`);
      const row = {
        id,
        cohort_id: cohortId,
        lat: inRange(h.lat, 'home.lat', -90, 90),
        lon: inRange(h.lon, 'home.lon', -180, 180),
        exempt: h.exempt === true,
        override_hour: h.overrideHour === null || h.overrideHour === undefined ? -1 : num(h.overrideHour, 'home.overrideHour'),
        overridden: false,
      };
      if (ctx.db.sampleHome.id.find(id)) ctx.db.sampleHome.id.update(row);
      else ctx.db.sampleHome.insert(row);
    }
  }
);

// config_json: any subset of enrolledHomes, floorF, maxDepthF, capacityMMcfd, overrideRate,
// speedHoursPerSec, homesPerDot.
export const set_params = spacetimedb.reducer(
  { config_json: t.string() },
  (ctx, { config_json }) => {
    const cfg = requireOperator(ctx);
    const fc = obj(parseJson(config_json, 'config_json'), 'config_json');
    ctx.db.simConfig.id.update({ ...cfg, ...fleetSettings(fc, cfg), updated_at: ctx.timestamp });
  }
);

// targets_json: Plan.targetsF, i.e. [cohortId][hour] in °F; null (JSON's NaN) = normal setpoint.
// Only one plan is kept: dispatching replaces every plan_hour row.
export const set_plan = spacetimedb.reducer(
  { plan_id: t.string(), strategy: t.string(), targets_json: t.string() },
  (ctx, { plan_id, strategy, targets_json }) => {
    const cfg = requireOperator(ctx);
    if (!STRATEGIES.includes(strategy)) throw new SenderError(`unknown strategy: ${strategy}`);
    if (plan_id.length === 0 || plan_id.length > 64) throw new SenderError('plan_id must be 1-64 characters');
    const targets = arr(parseJson(targets_json, 'targets_json'), 'targets_json');

    for (const row of [...ctx.db.planHour.iter()]) ctx.db.planHour.id.delete(row.id);
    let rows = 0;
    targets.forEach((perHour, cohortId) => {
      if (perHour === null || perHour === undefined) return;
      if (!ctx.db.cohort.id.find(cohortId)) throw new SenderError(`targets_json: no cohort ${cohortId}`);
      arr(perHour, `targets_json[${cohortId}]`).forEach((v, hour) => {
        if (v === null || v === undefined) return;
        if (hour >= cfg.hours) throw new SenderError(`targets_json[${cohortId}]: more than ${cfg.hours} hours`);
        const target = inRange(v, `targets_json[${cohortId}][${hour}]`, TARGET_MIN_F, TARGET_MAX_F);
        ctx.db.planHour.insert({ id: 0n, plan_id, cohort_id: cohortId, hour, target_f: target });
        rows++;
      });
    });

    ctx.db.simConfig.id.update({ ...cfg, plan_id, strategy, updated_at: ctx.timestamp });
    logEvent(ctx, cfg.sim_hour, 'dispatch', `Dispatched ${strategy} (${rows} setback cohort-hours)`);
  }
);

export const start = spacetimedb.reducer(ctx => {
  const cfg = requireOperator(ctx);
  if (cfg.hours === 0) throw new SenderError('load a scenario first');
  if (cfg.status === 'running') return;
  if (cfg.status === 'finished') throw new SenderError('run finished; reset first');
  stopSchedule(ctx);
  ctx.db.tickSchedule.insert({ scheduled_id: 0n, scheduled_at: ScheduleAt.interval(TICK_INTERVAL_MICROS) });
  ctx.db.simConfig.id.update({ ...cfg, status: 'running', updated_at: ctx.timestamp });
  logEvent(ctx, cfg.sim_hour, 'system', 'Run started');
});

export const pause = spacetimedb.reducer(ctx => {
  const cfg = requireOperator(ctx);
  stopSchedule(ctx);
  if (cfg.status !== 'running') return;
  ctx.db.simConfig.id.update({ ...cfg, status: 'paused', updated_at: ctx.timestamp });
  logEvent(ctx, cfg.sim_hour, 'system', 'Run paused');
});

export const reset = spacetimedb.reducer(ctx => {
  const cfg = requireOperator(ctx);
  clearRun(ctx);
  initStates(ctx, cfg.start_iso);
  resetHouseholdStates(ctx);
  ctx.db.simConfig.id.update({ ...cfg, status: 'idle', sim_hour: 0, updated_at: ctx.timestamp });
  logEvent(ctx, 0, 'system', 'Run reset');
});

export const reset_households = spacetimedb.reducer(ctx => {
  const cfg = requireOperator(ctx);
  const all = [...ctx.db.household.iter()];
  for (const hh of all) ctx.db.household.identity.delete(hh.identity);
  logEvent(ctx, cfg.sim_hour, 'system', `Households reset (${all.length} removed)`);
});

// ---------- household reducers ----------

// One household per identity; joining again updates the profile and keeps the state.
export const join_household = spacetimedb.reducer(
  { nickname: t.string(), heating: t.string(), thermostat: t.string(), exempt: t.bool() },
  (ctx, { nickname, heating, thermostat, exempt }) => {
    const cfg = getConfig(ctx);
    const name = cleanText(nickname, NICKNAME_MAX) || `Home ${ctx.random.integerInRange(1000, 9999)}`;
    const heat = heating === 'boiler' ? 'boiler' : heating === 'furnace' ? 'furnace' : 'other';
    const stat = cleanText(thermostat, NICKNAME_MAX) || 'other';

    const existing = ctx.db.household.identity.find(ctx.sender);
    if (existing) {
      ctx.db.household.identity.update({ ...existing, nickname: name, heating: heat, thermostat: stat, exempt, online: true });
      return;
    }

    if ([...ctx.db.household.iter()].length >= HOUSEHOLDS_MAX) {
      throw new SenderError(`Sorry, the demo is full (${HOUSEHOLDS_MAX} households). Watch the operator screen instead.`);
    }

    // Template: matching heating type (other uses furnace), steady schedule, average envelope, light mass.
    const templateHeating = heat === 'boiler' ? 'boiler' : 'furnace';
    const cohorts = [...ctx.db.cohort.iter()];
    const template =
      cohorts.find(c => c.key === `${templateHeating}-steady-average-light`) ??
      cohorts.find(c => c.heating === templateHeating) ??
      cohorts[0];
    if (!template) throw new SenderError('no scenario loaded yet; try again in a moment');
    const cs = ctx.db.cohortState.cohort_id.find(template.id);
    if (!cs) throw new SenderError('no scenario loaded yet; try again in a moment');

    // Jittered position near a random sample home (which sit near the placement anchors).
    const homes = [...ctx.db.sampleHome.iter()];
    const near = homes.length > 0 ? homes[ctx.random.integerInRange(0, homes.length - 1)] : MAP_CENTER;
    const lat = near.lat + (ctx.random() - 0.5) * 0.006;
    const lon = near.lon + (ctx.random() - 0.5) * 0.012;

    ctx.db.household.insert({
      identity: ctx.sender,
      nickname: name,
      heating: heat,
      thermostat: stat,
      exempt,
      floor_f: cfg.floor_f,
      cohort_id: template.id,
      lat,
      lon,
      ta_f: cs.ta_f,
      tm_f: cs.tm_f,
      base_ta_f: cs.base_ta_f,
      base_tm_f: cs.base_tm_f,
      target_f: cs.target_f,
      overridden: false,
      saved_cf: 0,
      joined_at: ctx.timestamp,
      online: true,
    });
    logEvent(ctx, cfg.sim_hour, 'join', `${name} joined${exempt ? ' (exempt: needs steady heat)' : ''}`);
  }
);

function setOverride(ctx: Ctx, overridden: boolean) {
  const cfg = getConfig(ctx);
  const hh = ctx.db.household.identity.find(ctx.sender);
  if (!hh) throw new SenderError('join first');
  if (hh.overridden === overridden) return;
  ctx.db.household.identity.update({ ...hh, overridden });
  logEvent(ctx, cfg.sim_hour, 'override', overridden ? `${hh.nickname} overrode: normal heat restored` : `${hh.nickname} rejoined the event`);
  // The tick spreads an overridden household's setback over participating homes from its next run.
  const cs = ctx.db.cohortState.cohort_id.find(hh.cohort_id);
  if (overridden && !hh.exempt && cs && cs.mode === 'holding') {
    logEvent(ctx, cfg.sim_hour, 'reassign', `${hh.nickname}'s setback reassigned across participating homes`);
  }
}

export const override = spacetimedb.reducer(ctx => setOverride(ctx, true));

export const cancel_override = spacetimedb.reducer(ctx => setOverride(ctx, false));

// ---------- tick ----------

export const tick = spacetimedb.reducer(
  { onSchedule: tickSchedule },
  { timer: tickSchedule.rowType },
  (ctx, _args) => {
    // Scheduler only: scheduled calls run with the database's own identity.
    if (!ctx.sender.equals(ctx.databaseIdentity)) throw new SenderError('tick is scheduler-only');

    const cfg = getConfig(ctx);
    if (cfg.status !== 'running') return;

    const cohorts = [...ctx.db.cohort.iter()].map(row => toParams(row));
    const states = new Map([...ctx.db.cohortState.iter()].map(s => [s.cohort_id, { ...s }]));
    const byId = new Map(cohorts.map(c => [c.id, c]));
    const households = [...ctx.db.household.iter()].map(h => ({ ...h }));
    const dt = SUBSTEP_HOURS;
    const hhv = cfg.hhv_btu_per_cf;
    const homesIn = (c: CohortParams) => cfg.enrolled_homes * c.share * (1 - cfg.exempt_share);

    // Integer sub-step counter avoids drift in the f64 sim_hour.
    let k = Math.round(cfg.sim_hour * SUBSTEPS_PER_HOUR);
    const kEnd = cfg.hours * SUBSTEPS_PER_HOUR;
    const nSub = Math.max(1, Math.round(cfg.speed_hours_per_sec * SUBSTEPS_PER_HOUR));

    let plannedHour = -1;
    let planned = new Map<number, number>(); // cohort id -> planned target for plannedHour

    for (let i = 0; i < nSub && k < kEnd; i++, k++) {
      const hourIdx = Math.floor(k / SUBSTEPS_PER_HOUR);
      const weather = ctx.db.weatherHour.hour.find(hourIdx);
      if (!weather) throw new SenderError(`weather_hour ${hourIdx} missing`);
      const clock = clockHour(cfg.start_iso, k / SUBSTEPS_PER_HOUR);

      if (hourIdx !== plannedHour) {
        plannedHour = hourIdx;
        planned = new Map();
        if (cfg.plan_id !== '') {
          for (const c of cohorts) {
            for (const row of ctx.db.planHour.by_cohort_hour.filter([c.id, hourIdx])) {
              if (row.plan_id === cfg.plan_id) planned.set(c.id, row.target_f);
            }
          }
        }
      }

      // Plan targets, clamped to [floor, normal].
      const normals = new Map<number, number>();
      const targets = new Map<number, number>();
      for (const c of cohorts) {
        const normal = normalSetpointF(c, clock);
        const p = planned.get(c.id);
        normals.set(c.id, normal);
        targets.set(c.id, p === undefined ? normal : Math.min(normal, Math.max(cfg.floor_f, p)));
      }

      // Reassignment (fast path): the depth lost to overridden homes is spread as extra depth
      // over the homes still participating, never beyond max depth or below the floor.
      let lostDepthHomes = 0;
      let remainingHomes = 0;
      for (const c of cohorts) {
        const s = states.get(c.id);
        if (!s) continue;
        const homes = homesIn(c);
        lostDepthHomes += homes * s.overridden_share * ((normals.get(c.id) ?? 0) - (targets.get(c.id) ?? 0));
        remainingHomes += homes * (1 - s.overridden_share);
      }
      // Each overridden real household counts as one home.
      for (const hh of households) {
        if (hh.overridden && !hh.exempt) lostDepthHomes += (normals.get(hh.cohort_id) ?? 0) - (targets.get(hh.cohort_id) ?? 0);
      }
      const boostF = remainingHomes > 0 ? lostDepthHomes / remainingHomes : 0;

      for (const c of cohorts) {
        const s = states.get(c.id);
        if (!s) continue;
        const normal = normals.get(c.id) ?? 0;
        let target = targets.get(c.id) ?? normal;
        if (boostF > 0) {
          const deepest = Math.min(normal, Math.max(cfg.floor_f, normal - cfg.max_depth_f));
          target = Math.max(Math.min(target, deepest), target - boostF);
        }

        const actual: ThermalState = { TaF: s.ta_f, TmF: s.tm_f };
        const q = heatToHold(c, actual, weather.outdoor_f, target, dt);
        const next = stepState(c, actual, weather.outdoor_f, q, dt);

        const base: ThermalState = { TaF: s.base_ta_f, TmF: s.base_tm_f };
        const qBase = heatToHold(c, base, weather.outdoor_f, normal, dt);
        const nextBase = stepState(c, base, weather.outdoor_f, qBase, dt);

        s.ta_f = next.TaF;
        s.tm_f = next.TmF;
        s.q_btuh = q;
        s.target_f = target;
        s.base_ta_f = nextBase.TaF;
        s.base_tm_f = nextBase.TmF;
        s.gas_cf_this_hour += gasCf(c, q, dt, hhv);
        s.base_gas_cf_this_hour += gasCf(c, qBase, dt, hhv);
        s.mode = target < normal - 1e-9 ? 'holding' : next.TaF < normal - 0.25 ? 'recovering' : 'normal';
        targets.set(c.id, target);
      }

      // Households follow their template cohort's target; overridden or exempt ones stay normal.
      for (const hh of households) {
        const c = byId.get(hh.cohort_id);
        if (!c) continue;
        const normal = normals.get(c.id) ?? 0;
        const cohortTarget = targets.get(c.id) ?? normal;
        const target = hh.overridden || hh.exempt ? normal : Math.min(normal, Math.max(hh.floor_f, cohortTarget));

        const actual: ThermalState = { TaF: hh.ta_f, TmF: hh.tm_f };
        const q = heatToHold(c, actual, weather.outdoor_f, target, dt);
        const next = stepState(c, actual, weather.outdoor_f, q, dt);
        const base: ThermalState = { TaF: hh.base_ta_f, TmF: hh.base_tm_f };
        const qBase = heatToHold(c, base, weather.outdoor_f, normal, dt);
        const nextBase = stepState(c, base, weather.outdoor_f, qBase, dt);

        hh.ta_f = next.TaF;
        hh.tm_f = next.TmF;
        hh.base_ta_f = nextBase.TaF;
        hh.base_tm_f = nextBase.TmF;
        hh.target_f = target;
        hh.saved_cf += gasCf(c, qBase, dt, hhv) - gasCf(c, q, dt, hhv);
      }

      // Hour boundary: apply simulated overrides, write the aggregate, reset the accumulators.
      if ((k + 1) % SUBSTEPS_PER_HOUR === 0) {
        // Simulated overrides: a home overrides once its override_hour has passed.
        const total = new Map<number, number>();
        const over = new Map<number, number>();
        let newOverrides = 0;
        for (const home of [...ctx.db.sampleHome.iter()]) {
          if (home.exempt) continue;
          total.set(home.cohort_id, (total.get(home.cohort_id) ?? 0) + 1);
          let overridden = home.overridden;
          if (!overridden && home.override_hour >= 0 && home.override_hour <= hourIdx + 1) {
            overridden = true;
            newOverrides++;
            ctx.db.sampleHome.id.update({ ...home, overridden: true });
          }
          if (overridden) over.set(home.cohort_id, (over.get(home.cohort_id) ?? 0) + 1);
        }

        let fleetCf = 0;
        let baseCf = 0;
        let minTa = Infinity;
        let shareAtFloor = 0;
        let overriddenHomes = 0;
        for (const c of cohorts) {
          const s = states.get(c.id);
          if (!s) continue;
          const n = total.get(c.id) ?? 0;
          s.overridden_share = n > 0 ? (over.get(c.id) ?? 0) / n : 0;
          const homes = homesIn(c);
          // Overridden homes are counted at baseline-twin gas.
          fleetCf += homes * ((1 - s.overridden_share) * s.gas_cf_this_hour + s.overridden_share * s.base_gas_cf_this_hour);
          baseCf += homes * s.base_gas_cf_this_hour;
          overriddenHomes += homes * s.overridden_share;
          if (c.share > 0) minTa = Math.min(minTa, s.ta_f);
          if (s.ta_f <= cfg.floor_f + 0.1) shareAtFloor += c.share * (1 - s.overridden_share);
          s.gas_cf_this_hour = 0;
          s.base_gas_cf_this_hour = 0;
        }
        const fleet = fleetCf / 1e6;
        const baseline = baseCf / 1e6;
        const agg = {
          hour: hourIdx,
          fleet_gas_mmcf: fleet,
          baseline_gas_mmcf: baseline,
          system_mmcf: weather.system_mmcfh - baseline + fleet,
          capacity_mmcf: cfg.capacity_mmcfd / 24,
          relief_mmcf: baseline - fleet,
          min_ta_f: Number.isFinite(minTa) ? minTa : 0,
          share_at_floor: shareAtFloor,
          overrides: Math.round(overriddenHomes) + households.filter(h => h.overridden).length,
          households: households.length,
          strategy: cfg.strategy,
        };
        if (ctx.db.aggregateHour.hour.find(hourIdx)) ctx.db.aggregateHour.hour.update(agg);
        else ctx.db.aggregateHour.insert(agg);

        if (newOverrides > 0) {
          const simHour = hourIdx + 1;
          logEvent(ctx, simHour, 'override', `${newOverrides} sample homes overrode; about ${Math.round(overriddenHomes)} homes now overridden`);
          if (boostF > 0) {
            logEvent(ctx, simHour, 'reassign', `Lost relief reassigned: up to ${boostF.toFixed(2)} °F extra depth on participating homes`);
          }
        }

        // Capacity is a daily limit: report when a completed gas day's total exceeds it.
        if ((hourIdx + 1) % 24 === 0) {
          let dayTotal = 0;
          for (let h = hourIdx - 23; h <= hourIdx; h++) dayTotal += ctx.db.aggregateHour.hour.find(h)?.system_mmcf ?? 0;
          const excess = dayTotal - cfg.capacity_mmcfd;
          if (excess > 0) {
            logEvent(ctx, hourIdx + 1, 'system', `Gas day ${(hourIdx + 1) / 24} closed ${excess.toFixed(2)} MMcf over capacity`);
          }
        }
      }
    }

    for (const s of states.values()) ctx.db.cohortState.cohort_id.update(s);
    // Re-read each household so an override made during this tick is not overwritten.
    for (const hh of households) {
      const current = ctx.db.household.identity.find(hh.identity);
      if (!current) continue;
      ctx.db.household.identity.update({
        ...current,
        ta_f: hh.ta_f,
        tm_f: hh.tm_f,
        base_ta_f: hh.base_ta_f,
        base_tm_f: hh.base_tm_f,
        target_f: hh.target_f,
        saved_cf: hh.saved_cf,
      });
    }

    const finished = k >= kEnd;
    ctx.db.simConfig.id.update({
      ...cfg,
      sim_hour: k / SUBSTEPS_PER_HOUR,
      status: finished ? 'finished' : 'running',
      updated_at: ctx.timestamp,
    });
    if (finished) {
      stopSchedule(ctx);
      logEvent(ctx, cfg.hours, 'system', 'Run finished');
    }
  }
);
