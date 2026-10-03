// Thermal Reserve Spacetime module. S0: all Contract C reducers exist as stubs so
// bindings can be generated; behavior lands in S1-S3.
// Reducer exports are snake_case so the reducer names match the contract verbatim.
import { t } from 'spacetimedb/server';
import spacetimedb, { tickSchedule } from './schema';

export { default } from './schema';

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
    hours: 96,
    event_start_hour: 12,
    event_end_hour: 84,
    homes_per_dot: 25,
    operator: undefined,
    updated_at: ctx.timestamp,
  });
});

export const onConnect = spacetimedb.clientConnected(_ctx => {});

export const onDisconnect = spacetimedb.clientDisconnected(_ctx => {});

export const claim_operator = spacetimedb.reducer(
  { passcode: t.string() },
  (_ctx, _args) => {}
);

export const load_scenario = spacetimedb.reducer(
  { scenario_json: t.string(), cohorts_json: t.string(), config_json: t.string() },
  (_ctx, _args) => {}
);

export const load_homes = spacetimedb.reducer(
  { chunk_json: t.string() },
  (_ctx, _args) => {}
);

export const set_params = spacetimedb.reducer(
  { config_json: t.string() },
  (_ctx, _args) => {}
);

export const set_plan = spacetimedb.reducer(
  { plan_id: t.string(), strategy: t.string(), targets_json: t.string() },
  (_ctx, _args) => {}
);

export const start = spacetimedb.reducer(_ctx => {});

export const pause = spacetimedb.reducer(_ctx => {});

export const reset = spacetimedb.reducer(_ctx => {});

export const join_household = spacetimedb.reducer(
  { nickname: t.string(), heating: t.string(), thermostat: t.string(), exempt: t.bool() },
  (_ctx, _args) => {}
);

export const override = spacetimedb.reducer(_ctx => {});

export const cancel_override = spacetimedb.reducer(_ctx => {});

export const reset_households = spacetimedb.reducer(_ctx => {});

export const tick = spacetimedb.reducer(
  { onSchedule: tickSchedule },
  { timer: tickSchedule.rowType },
  (_ctx, _args) => {}
);
