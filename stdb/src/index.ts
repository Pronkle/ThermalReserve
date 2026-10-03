// Thermal Reserve Spacetime module (Contract C, AGENTS.md Section 8).
// S1: simulation clock with BASELINE behavior and the baseline twin.
// Plans, overrides, reassignment (S2) and households (S3) are still stubs.
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

// ---------- helpers ----------

function getConfig(ctx: Ctx) {
  const cfg = ctx.db.simConfig.id.find(0);
  if (!cfg) throw new SenderError('sim_config row missing');
  return cfg;
}

// Until claim_operator has been called, operator reducers are open (S2 adds the passcode).
function requireOperator(ctx: Ctx) {
  const cfg = getConfig(ctx);
  if (cfg.operator && !cfg.operator.equals(ctx.sender)) {
    throw new SenderError('operator only');
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

function optNum(v: unknown, fallback: number, what: string): number {
  return v === undefined || v === null ? fallback : num(v, what);
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

// Both twins start at the normal setpoint for the scenario's first clock hour.
function initStates(ctx: Ctx, startIso: string) {
  for (const row of [...ctx.db.cohortState.iter()]) ctx.db.cohortState.cohort_id.delete(row.cohort_id);
  const clock = clockHour(startIso, 0);
  for (const row of [...ctx.db.cohort.iter()]) {
    const sp = normalSetpointF(toParams(row), clock);
    ctx.db.cohortState.insert({
      cohort_id: row.id,
      ta_f: sp,
      tm_f: sp,
      q_btuh: 0,
      target_f: sp,
      base_ta_f: sp,
      base_tm_f: sp,
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
  for (const row of [...ctx.db.sampleHome.iter()]) {
    if (row.overridden) ctx.db.sampleHome.id.update({ ...row, overridden: false });
  }
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

export const onConnect = spacetimedb.clientConnected(_ctx => {});

export const onDisconnect = spacetimedb.clientDisconnected(_ctx => {});

// ---------- operator reducers ----------

export const claim_operator = spacetimedb.reducer(
  { passcode: t.string() },
  (ctx, _args) => {
    const cfg = getConfig(ctx);
    if (cfg.operator) {
      if (cfg.operator.equals(ctx.sender)) return;
      throw new SenderError('operator already claimed');
    }
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

    const hours = num(sc.hours, 'scenario.hours');
    const outdoorF = arr(sc.outdoorF, 'scenario.outdoorF');
    const systemMMcfh = arr(sc.systemMMcfh, 'scenario.systemMMcfh');
    if (!Number.isInteger(hours) || hours < 1 || outdoorF.length !== hours || systemMMcfh.length !== hours) {
      throw new SenderError('scenario: outdoorF and systemMMcfh must each have `hours` entries');
    }
    const startIso = str(sc.startIso, 'scenario.startIso');

    clearRun(ctx);
    for (const row of [...ctx.db.weatherHour.iter()]) ctx.db.weatherHour.hour.delete(row.hour);
    for (const row of [...ctx.db.cohort.iter()]) ctx.db.cohort.id.delete(row.id);
    for (const row of [...ctx.db.planHour.iter()]) ctx.db.planHour.id.delete(row.id);
    for (const row of [...ctx.db.sampleHome.iter()]) ctx.db.sampleHome.id.delete(row.id);

    for (let h = 0; h < hours; h++) {
      ctx.db.weatherHour.insert({
        hour: h,
        outdoor_f: num(outdoorF[h], `scenario.outdoorF[${h}]`),
        system_mmcfh: num(systemMMcfh[h], `scenario.systemMMcfh[${h}]`),
      });
    }

    for (const raw of cohorts) {
      const c = obj(raw, 'cohort');
      const heating = str(c.heating, 'cohort.heating');
      ctx.db.cohort.insert({
        id: num(c.id, 'cohort.id'),
        key: str(c.key, 'cohort.key'),
        heating,
        share: num(c.share, 'cohort.share'),
        ua: num(c.UA, 'cohort.UA'),
        uao: num(c.Uao, 'cohort.Uao'),
        umo: num(c.Umo, 'cohort.Umo'),
        ham: num(c.Ham, 'cohort.Ham'),
        ca: num(c.Ca, 'cohort.Ca'),
        cm: num(c.Cm, 'cohort.Cm'),
        qmax_btuh: num(c.QmaxBtuH, 'cohort.QmaxBtuH'),
        eta: num(c.eta, 'cohort.eta'),
        setpoint_day_f: num(c.setpointDayF, 'cohort.setpointDayF'),
        setpoint_night_f: num(c.setpointNightF, 'cohort.setpointNightF'),
        night_start_hour: num(c.nightStartHour, 'cohort.nightStartHour'),
        night_end_hour: num(c.nightEndHour, 'cohort.nightEndHour'),
      });
    }

    const hhv = num(fc.hhvBtuPerCf, 'config.hhvBtuPerCf');
    if (hhv <= 0) throw new SenderError('config.hhvBtuPerCf must be positive');

    ctx.db.simConfig.id.update({
      ...cfg,
      scenario_id: str(sc.id, 'scenario.id'),
      status: 'idle',
      sim_hour: 0,
      speed_hours_per_sec: optNum(fc.speedHoursPerSec, cfg.speed_hours_per_sec, 'config.speedHoursPerSec'),
      strategy: 'BASELINE',
      plan_id: '',
      enrolled_homes: optNum(fc.enrolledHomes, cfg.enrolled_homes, 'config.enrolledHomes'),
      exempt_share: optNum(fc.exemptShare, cfg.exempt_share, 'config.exemptShare'),
      floor_f: Math.max(FLOOR_MIN_F, optNum(fc.floorF, cfg.floor_f, 'config.floorF')),
      max_depth_f: optNum(fc.maxDepthF, cfg.max_depth_f, 'config.maxDepthF'),
      capacity_mmcfd: optNum(fc.capacityMMcfd, num(sc.capacityMMcfd, 'scenario.capacityMMcfd'), 'config.capacityMMcfd'),
      override_rate: optNum(fc.overrideRate, cfg.override_rate, 'config.overrideRate'),
      hours,
      event_start_hour: num(sc.eventStartHour, 'scenario.eventStartHour'),
      event_end_hour: num(sc.eventEndHour, 'scenario.eventEndHour'),
      homes_per_dot: optNum(fc.homesPerDot, cfg.homes_per_dot, 'config.homesPerDot'),
      updated_at: ctx.timestamp,
      start_iso: startIso,
      hhv_btu_per_cf: hhv,
    });

    initStates(ctx, startIso);
    logEvent(ctx, 0, 'system', `Scenario loaded: ${str(sc.id, 'scenario.id')}`);
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
    for (const raw of homes) {
      const h = obj(raw, 'home');
      const id = num(h.id, 'home.id');
      const row = {
        id,
        cohort_id: num(h.cohortId, 'home.cohortId'),
        lat: num(h.lat, 'home.lat'),
        lon: num(h.lon, 'home.lon'),
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
    const speed = optNum(fc.speedHoursPerSec, cfg.speed_hours_per_sec, 'config.speedHoursPerSec');
    if (speed <= 0) throw new SenderError('config.speedHoursPerSec must be positive');
    ctx.db.simConfig.id.update({
      ...cfg,
      enrolled_homes: optNum(fc.enrolledHomes, cfg.enrolled_homes, 'config.enrolledHomes'),
      floor_f: Math.max(FLOOR_MIN_F, optNum(fc.floorF, cfg.floor_f, 'config.floorF')),
      max_depth_f: optNum(fc.maxDepthF, cfg.max_depth_f, 'config.maxDepthF'),
      capacity_mmcfd: optNum(fc.capacityMMcfd, cfg.capacity_mmcfd, 'config.capacityMMcfd'),
      override_rate: optNum(fc.overrideRate, cfg.override_rate, 'config.overrideRate'),
      speed_hours_per_sec: speed,
      homes_per_dot: optNum(fc.homesPerDot, cfg.homes_per_dot, 'config.homesPerDot'),
      updated_at: ctx.timestamp,
    });
  }
);

export const set_plan = spacetimedb.reducer(
  { plan_id: t.string(), strategy: t.string(), targets_json: t.string() },
  (_ctx, _args) => {}
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
  ctx.db.simConfig.id.update({ ...cfg, status: 'idle', sim_hour: 0, updated_at: ctx.timestamp });
  logEvent(ctx, 0, 'system', 'Run reset');
});

export const reset_households = spacetimedb.reducer(_ctx => {});

// ---------- household reducers (S3) ----------

export const join_household = spacetimedb.reducer(
  { nickname: t.string(), heating: t.string(), thermostat: t.string(), exempt: t.bool() },
  (_ctx, _args) => {}
);

export const override = spacetimedb.reducer(_ctx => {});

export const cancel_override = spacetimedb.reducer(_ctx => {});

// ---------- tick ----------

export const tick = spacetimedb.reducer(
  { onSchedule: tickSchedule },
  { timer: tickSchedule.rowType },
  (ctx, _args) => {
    // Scheduler only: scheduled calls run with the database's own identity.
    if (!ctx.sender.equals(ctx.databaseIdentity)) throw new SenderError('tick is scheduler-only');

    const cfg = getConfig(ctx);
    if (cfg.status !== 'running') return;

    const cohorts = [...ctx.db.cohort.iter()].map(row => ({ row, params: toParams(row) }));
    const states = new Map([...ctx.db.cohortState.iter()].map(s => [s.cohort_id, { ...s }]));
    const households = ctx.db.household.count();
    const dt = SUBSTEP_HOURS;
    const hhv = cfg.hhv_btu_per_cf;

    // Integer sub-step counter avoids drift in the f64 sim_hour.
    let k = Math.round(cfg.sim_hour * SUBSTEPS_PER_HOUR);
    const kEnd = cfg.hours * SUBSTEPS_PER_HOUR;
    const nSub = Math.max(1, Math.round(cfg.speed_hours_per_sec * SUBSTEPS_PER_HOUR));

    for (let i = 0; i < nSub && k < kEnd; i++, k++) {
      const hourIdx = Math.floor(k / SUBSTEPS_PER_HOUR);
      const weather = ctx.db.weatherHour.hour.find(hourIdx);
      if (!weather) throw new SenderError(`weather_hour ${hourIdx} missing`);
      const clock = clockHour(cfg.start_iso, k / SUBSTEPS_PER_HOUR);

      for (const { params } of cohorts) {
        const s = states.get(params.id);
        if (!s) continue;
        const normal = normalSetpointF(params, clock);
        // S1: no plan yet, so the target is the normal setpoint.
        const target = Math.min(normal, Math.max(cfg.floor_f, normal));

        const actual: ThermalState = { TaF: s.ta_f, TmF: s.tm_f };
        const q = heatToHold(params, actual, weather.outdoor_f, target, dt);
        const next = stepState(params, actual, weather.outdoor_f, q, dt);

        const base: ThermalState = { TaF: s.base_ta_f, TmF: s.base_tm_f };
        const qBase = heatToHold(params, base, weather.outdoor_f, normal, dt);
        const nextBase = stepState(params, base, weather.outdoor_f, qBase, dt);

        s.ta_f = next.TaF;
        s.tm_f = next.TmF;
        s.q_btuh = q;
        s.target_f = target;
        s.base_ta_f = nextBase.TaF;
        s.base_tm_f = nextBase.TmF;
        s.gas_cf_this_hour += gasCf(params, q, dt, hhv);
        s.base_gas_cf_this_hour += gasCf(params, qBase, dt, hhv);
        s.mode = target < normal - 0.05 ? 'holding' : next.TaF < nextBase.TaF - 0.25 ? 'recovering' : 'normal';
      }

      // Hour boundary: write the aggregate and reset the hourly accumulators.
      if ((k + 1) % SUBSTEPS_PER_HOUR === 0) {
        let fleetCf = 0;
        let baseCf = 0;
        let minTa = Infinity;
        let shareAtFloor = 0;
        for (const { params } of cohorts) {
          const s = states.get(params.id);
          if (!s) continue;
          const homes = cfg.enrolled_homes * params.share * (1 - cfg.exempt_share);
          // Overridden homes are counted at baseline-twin gas.
          fleetCf += homes * ((1 - s.overridden_share) * s.gas_cf_this_hour + s.overridden_share * s.base_gas_cf_this_hour);
          baseCf += homes * s.base_gas_cf_this_hour;
          minTa = Math.min(minTa, s.ta_f);
          if (s.ta_f <= cfg.floor_f + 0.05) shareAtFloor += params.share;
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
          overrides: 0,
          households: Number(households),
          strategy: cfg.strategy,
        };
        if (ctx.db.aggregateHour.hour.find(hourIdx)) ctx.db.aggregateHour.hour.update(agg);
        else ctx.db.aggregateHour.insert(agg);
      }
    }

    for (const s of states.values()) ctx.db.cohortState.cohort_id.update(s);

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
