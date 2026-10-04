// Contract C (AGENTS.md Section 8). Table and column names are frozen after Checkpoint 0.
// Column keys are written in snake_case so the database names match the contract verbatim.
import { schema, table, t } from 'spacetimedb/server';

const simConfig = table(
  { name: 'sim_config', public: true },
  {
    id: t.u32().primaryKey(), // single row, id = 0
    scenario_id: t.string(),
    status: t.string(), // idle | running | paused | finished
    sim_hour: t.f64(),
    speed_hours_per_sec: t.f64(),
    strategy: t.string(),
    plan_id: t.string(),
    enrolled_homes: t.u32(),
    exempt_share: t.f64(),
    floor_f: t.f64(),
    max_depth_f: t.f64(),
    capacity_mmcfd: t.f64(),
    override_rate: t.f64(),
    hours: t.u32(),
    event_start_hour: t.u32(),
    event_end_hour: t.u32(),
    homes_per_dot: t.f64(),
    operator: t.option(t.identity()),
    updated_at: t.timestamp(),
    // Added after CP0 (H1-approved): tick needs the local clock and gas conversion.
    start_iso: t.string(),
    hhv_btu_per_cf: t.f64(),
  }
);

const weatherHour = table(
  { name: 'weather_hour', public: true },
  {
    hour: t.u32().primaryKey(),
    outdoor_f: t.f64(),
    system_mmcfh: t.f64(),
  }
);

const cohort = table(
  { name: 'cohort', public: true },
  {
    id: t.u32().primaryKey(),
    key: t.string(),
    heating: t.string(),
    share: t.f64(),
    ua: t.f64(),
    uao: t.f64(),
    umo: t.f64(),
    ham: t.f64(),
    ca: t.f64(),
    cm: t.f64(),
    qmax_btuh: t.f64(),
    eta: t.f64(),
    setpoint_day_f: t.f64(),
    setpoint_night_f: t.f64(),
    night_start_hour: t.u32(),
    night_end_hour: t.u32(),
  }
);

const cohortState = table(
  { name: 'cohort_state', public: true },
  {
    cohort_id: t.u32().primaryKey(),
    ta_f: t.f64(),
    tm_f: t.f64(),
    q_btuh: t.f64(),
    target_f: t.f64(),
    base_ta_f: t.f64(), // baseline twin
    base_tm_f: t.f64(),
    gas_cf_this_hour: t.f64(),
    base_gas_cf_this_hour: t.f64(),
    overridden_share: t.f64(),
    mode: t.string(), // normal | holding | recovering
  }
);

const sampleHome = table(
  { name: 'sample_home', public: true },
  {
    id: t.u32().primaryKey(),
    cohort_id: t.u32(),
    lat: t.f64(),
    lon: t.f64(),
    exempt: t.bool(),
    override_hour: t.f64(), // -1 = never
    overridden: t.bool(),
  }
);

const household = table(
  { name: 'household', public: true },
  {
    identity: t.identity().primaryKey(),
    nickname: t.string(),
    heating: t.string(),
    thermostat: t.string(),
    exempt: t.bool(),
    floor_f: t.f64(),
    cohort_id: t.u32(), // template cohort
    lat: t.f64(),
    lon: t.f64(),
    ta_f: t.f64(),
    tm_f: t.f64(),
    base_ta_f: t.f64(),
    base_tm_f: t.f64(),
    target_f: t.f64(),
    overridden: t.bool(),
    saved_cf: t.f64(),
    joined_at: t.timestamp(),
    online: t.bool(),
  }
);

const planHour = table(
  {
    name: 'plan_hour',
    public: true,
    indexes: [
      { accessor: 'by_cohort_hour', algorithm: 'btree', columns: ['cohort_id', 'hour'] },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    plan_id: t.string().index('btree'),
    cohort_id: t.u32(),
    hour: t.u32(),
    target_f: t.f64(),
  }
);

const aggregateHour = table(
  { name: 'aggregate_hour', public: true },
  {
    hour: t.u32().primaryKey(),
    fleet_gas_mmcf: t.f64(),
    baseline_gas_mmcf: t.f64(),
    system_mmcf: t.f64(),
    capacity_mmcf: t.f64(),
    relief_mmcf: t.f64(),
    min_ta_f: t.f64(),
    share_at_floor: t.f64(),
    overrides: t.u32(),
    households: t.u32(),
    strategy: t.string(),
  }
);

const eventLog = table(
  { name: 'event_log', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    sim_hour: t.f64(),
    kind: t.string(), // dispatch | override | reassign | join | system
    message: t.string(),
    at: t.timestamp(),
  }
);

// Private: only the scheduler reads it.
export const tickSchedule = table(
  { name: 'tick_schedule' },
  {
    scheduled_id: t.u64().primaryKey().autoInc(),
    scheduled_at: t.scheduleAt(),
  }
);

// Private: the operator passcode, set by the first successful claim_operator.
const operatorSecret = table(
  { name: 'operator_secret' },
  {
    id: t.u32().primaryKey(), // single row, id = 0
    passcode: t.string(),
  }
);

// Private: contact details a household opts in to share so the iMessage companion can text it
// (H1-approved change to Contract C, Oct 4). Never in a public table; no email, no address.
export const householdContact = table(
  { name: 'household_contact' },
  {
    identity: t.identity().primaryKey(),
    first_name: t.string(),
    last_name: t.string(),
    phone_e164: t.string(),
    opted_in_at: t.timestamp(),
  }
);

// Private: the one identity allowed to read household_contact through the contact_feed view
// (the iMessage companion). Set by claim_contact_reader.
const contactReader = table(
  { name: 'contact_reader' },
  {
    id: t.u32().primaryKey(), // single row, id = 0
    identity: t.identity(),
  }
);

const spacetimedb = schema({
  operatorSecret,
  householdContact,
  contactReader,
  simConfig,
  weatherHour,
  cohort,
  cohortState,
  sampleHome,
  household,
  planHour,
  aggregateHour,
  eventLog,
  tickSchedule,
});
export default spacetimedb;
