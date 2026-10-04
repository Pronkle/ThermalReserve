// S-A1 (pressure overhaul, AGENTS.md Section 8): live checks on a database, no module change.
//
//   STDB_PASSCODE=... node --import tsx stdb/scripts/verify-pressure.ts <database> [speedHoursPerSec]
//
// 1. load_scenario accepts feb2024 with and without a forecastRuns array (sizes and timings printed).
// 2. A set_plan sent while the run is going replaces future targets without resetting house
//    states, households, aggregates or the event log: the whole run must match
//    runPlan(stitched plan) within 2% per hour.
// 3. A set_params sent while the run is going changes capacity for later hours only.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCohorts } from '../../packages/model/src/fleet';
import { loadConstants } from '../../packages/model/src/constants';
import { normalSetpointF } from '../../packages/model/src/physics';
import { planNaive4h, runPlan } from '../../packages/model/src/strategies';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const db = process.argv[2];
const speed = Number(process.argv[3] ?? 1);
const server = process.env.STDB_SERVER ?? 'maincloud';
const passcode = process.env.STDB_PASSCODE;
if (!db || !passcode) {
  console.error('usage: STDB_PASSCODE=... verify-pressure.ts <database> [speedHoursPerSec]');
  process.exit(2);
}

const json = (p: string) => JSON.parse(readFileSync(join(root, 'data', p), 'utf8'));
const constantsJson = json('constants.json');
const consts = loadConstants(constantsJson);
const scenario = json('scenarios/feb2024.json');
const cohorts = buildCohorts(json('cohort_spec.json'), consts.uaMeanBtuHPerF);
const cfg = {
  enrolledHomes: 25000,
  exemptShare: constantsJson.exempt_share.value,
  floorF: constantsJson.floor_default_f.value,
  maxDepthF: constantsJson.max_depth_default_f.value,
  overrideRate: 0,
  capacityMMcfd: scenario.capacityMMcfd,
  seed: 42,
};
const NEW_CAPACITY_MMCFD = 266.5; // an R value from AGENTS.md Section 3
const BOUNDARY_HOUR = 48; // plan B differs from plan A only from this hour on
const DISPATCH_FROM_HOUR = 38; // plan B is sent once the run has passed this hour (a quiet stretch: no setback, no setpoint change)

// Retries connection failures only; a request that reached the server is never repeated.
const spacetime = (...args: string[]) => {
  for (let attempt = 1; ; attempt++) {
    try {
      return execFileSync('spacetime', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      const stderr = String((e as { stderr?: unknown }).stderr ?? '');
      if (attempt >= 5 || !stderr.includes('client error (Connect)')) throw e;
      execFileSync('sleep', ['2']);
    }
  }
};
const call = (reducer: string, ...args: unknown[]) =>
  spacetime('call', '--server', server, db, reducer, ...args.map(a => JSON.stringify(a)));
const sqlRows = (query: string) => {
  const lines = spacetime('sql', '--server', server, db, query).split('\n');
  const sep = lines.findIndex(l => /^-+(\+-+)*$/.test(l.trim()));
  return lines
    .slice(sep + 1)
    .filter(l => l.trim() !== '')
    .map(l => l.split('|').map(c => c.trim()));
};
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const results: { check: string; ok: boolean; detail: string }[] = [];
const record = (check: string, ok: boolean, detail: string) => {
  results.push({ check, ok, detail });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${check}: ${detail}`);
};

const fleetCfg = { ...cfg, hhvBtuPerCf: consts.hhvBtuPerCf, speedHoursPerSec: speed };
const load = (sc: unknown) => {
  const body = JSON.stringify(sc);
  const t0 = Date.now();
  call('load_scenario', body, JSON.stringify(cohorts), JSON.stringify(fleetCfg));
  return { bytes: body.length, ms: Date.now() - t0 };
};

call('claim_operator', passcode);
call('pause');

// ---------- 1. load_scenario payload, with and without forecastRuns ----------

// Placeholder runs in the Section 6 shape, used only to size the payload; they are never planned on.
const fakeRuns = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    runIso: new Date(Date.parse('2024-01-30T19:00:00Z') + i * 3_600_000).toISOString(),
    availableHour: i - 13,
    model: 'NBS',
    station: 'PANC',
    outdoorF: scenario.outdoorF.map((v: number, h: number) => (h < i - 13 ? null : Math.round((v + 1.234) * 10) / 10)),
    sigmaF: scenario.outdoorF.map((_: number, h: number) => (h < i - 13 ? null : 2.5)),
    label: 'sourced',
    source: 'payload-size placeholder, not a forecast',
  }));
const weatherRows = () => sqlRows('SELECT hour FROM weather_hour').length;
for (const [name, runs] of [['no forecastRuns', 0], ['17 runs (one per 6 h)', 17], ['109 runs (one per hour)', 109]] as const) {
  try {
    const r = load(runs === 0 ? scenario : { ...scenario, forecastRuns: fakeRuns(runs) });
    const rows = weatherRows();
    record(`load_scenario, ${name}`, rows === scenario.hours, `${r.bytes} bytes, ${r.ms} ms, ${rows} weather rows`);
  } catch (e) {
    const x = e as { stderr?: unknown; message?: unknown };
    record(`load_scenario, ${name}`, false, `${String(x.stderr ?? x.message).replace(/\s+/g, ' ').slice(0, 200)}`);
  }
}

// ---------- 2 and 3. set_plan and set_params while the run is going ----------

load(scenario);
const planA = planNaive4h(scenario, cohorts, cfg);
const startClock = Number(/T(\d{2})/.exec(scenario.startIso)?.[1] ?? 0);
// Plan B: plan A's targets before the boundary (as Section 8 says), then a 3°F setback for
// every cohort over six hours, and plan A again afterwards.
const targetsB = planA.targetsF.map((row, c) =>
  row.map((v, h) =>
    h >= BOUNDARY_HOUR + 2 && h < BOUNDARY_HOUR + 8
      ? Math.max(cfg.floorF, normalSetpointF(cohorts[c], (startClock + h) % 24) - 3)
      : v
  )
);
const planB = { ...planA, id: `${scenario.id}-OPT-rp${BOUNDARY_HOUR}-verifytest`, strategy: 'OPTIMIZED' as const, targetsF: targetsB };

call('reset_households');
call('join_household', 'Verify Home', 'furnace', 'Nest', false);
call('set_plan', planA.id, planA.strategy, JSON.stringify(planA.targetsF));
call('start');

const snapshot = () => ({
  cfg: sqlRows('SELECT status, sim_hour, plan_id, capacity_mmcfd FROM sim_config')[0] ?? [],
  aggregates: sqlRows('SELECT hour, fleet_gas_mmcf, capacity_mmcf FROM aggregate_hour'),
  states: sqlRows('SELECT cohort_id, ta_f, tm_f FROM cohort_state'),
  households: sqlRows('SELECT nickname, ta_f, saved_cf, joined_at FROM household'),
  events: sqlRows('SELECT kind FROM event_log').length,
});

let dispatchHour = -1;
let before: ReturnType<typeof snapshot> | null = null;
let after: ReturnType<typeof snapshot> | null = null;
let setPlanMs = 0;
let setParamsMs = 0;
let status = '';
const t0 = Date.now();
while (Date.now() - t0 < 300_000) {
  await sleep(1000);
  const row = sqlRows('SELECT status, sim_hour FROM sim_config')[0] ?? [];
  status = (row[0] ?? '').replaceAll('"', '');
  const simHour = Number(row[1]);
  if (!before && simHour >= DISPATCH_FROM_HOUR) {
    if (simHour >= BOUNDARY_HOUR) throw new Error(`missed the dispatch window (sim hour ${simHour}); use a lower speed`);
    before = snapshot();
    let t = Date.now();
    call('set_plan', planB.id, planB.strategy, JSON.stringify(planB.targetsF));
    setPlanMs = Date.now() - t;
    t = Date.now();
    call('set_params', JSON.stringify({ capacityMMcfd: NEW_CAPACITY_MMCFD }));
    setParamsMs = Date.now() - t;
    after = snapshot();
    dispatchHour = Number(after.cfg[1]);
  }
  if (status === 'finished') break;
}
if (status !== 'finished' || !before || !after) throw new Error(`run did not finish (status: ${status})`);

const stripQuotes = (s: string | undefined) => (s ?? '').replaceAll('"', '');
record('run kept going through set_plan and set_params', stripQuotes(after.cfg[0]) === 'running' && Number(after.cfg[1]) >= Number(before.cfg[1]),
  `status ${after.cfg[0]}, sim hour ${before.cfg[1]} -> ${after.cfg[1]}; set_plan ${setPlanMs} ms, set_params ${setParamsMs} ms`);
record('sim_config.plan_id is the new plan', stripQuotes(after.cfg[2]) === planB.id, after.cfg[2] ?? '');
record('sim_config.capacity_mmcfd updated', Number(after.cfg[3]) === NEW_CAPACITY_MMCFD, `${before.cfg[3]} -> ${after.cfg[3]}`);

// Aggregates written before the dispatch are still there, unchanged.
const afterAgg = new Map(after.aggregates.map(r => [r[0], r.join('|')]));
const lost = before.aggregates.filter(r => afterAgg.get(r[0]) !== r.join('|')).length;
record('aggregate_hour rows kept across set_plan', before.aggregates.length > 0 && lost === 0 && after.aggregates.length >= before.aggregates.length,
  `${before.aggregates.length} rows before, ${after.aggregates.length} after, ${lost} changed or missing`);

// House states carried on (a reset would put air back at the 70 or 64°F setpoint with gas restarted;
// continuity is proven by the per-hour runPlan match below, this is the direct look).
const taBefore = new Map(before.states.map(r => [r[0], Number(r[1])]));
const maxJump = Math.max(...after.states.map(r => Math.abs(Number(r[1]) - (taBefore.get(r[0]) ?? NaN))));
record('cohort_state carried across set_plan', after.states.length === cohorts.length && maxJump < 1,
  `${after.states.length} cohorts, largest indoor change during the two calls ${maxJump.toFixed(3)} °F`);

// A reset would zero saved_cf. It may fall a little on its own: the snapshots are a few simulated
// hours apart and the recovery after a setback gives gas back.
record('household kept across set_plan', before.households.length === 1 && after.households.length === 1 && before.households[0][3] === after.households[0][3]
  && Number(before.households[0][2]) > 0 && Number(after.households[0][2]) > 0.5 * Number(before.households[0][2]),
  `${after.households[0]?.[0]}, saved_cf ${before.households[0]?.[2]} -> ${after.households[0]?.[2]}, joined_at unchanged: ${before.households[0]?.[3] === after.households[0]?.[3]}`);
record('event_log kept across set_plan', after.events > before.events, `${before.events} rows before, ${after.events} after`);

// The whole run against runPlan with the stitched plan (hours before the boundary are plan A's).
const final = sqlRows('SELECT hour, fleet_gas_mmcf, capacity_mmcf, system_mmcf FROM aggregate_hour').map(r => r.map(Number));
const live = new Map(final.map(r => [r[0], r]));
const expected = runPlan(scenario, cohorts, cfg, planB, consts);
const expectedA = runPlan(scenario, cohorts, cfg, planA, consts);
let worst = 0;
let worstHour = -1;
let differsFromA = 0;
for (const h of expected.hours) {
  const row = live.get(h.hour);
  if (!row) throw new Error(`aggregate_hour missing hour ${h.hour}`);
  const err = Math.abs(row[1] - h.fleetGasMMcfh) / h.fleetGasMMcfh;
  if (err > worst) [worst, worstHour] = [err, h.hour];
  if (Math.abs(row[1] - expectedA.hours[h.hour].fleetGasMMcfh) / h.fleetGasMMcfh > 0.02) differsFromA++;
}
record('live run matches runPlan(stitched plan) every hour', live.size === scenario.hours && worst <= 0.02,
  `${live.size} hours, worst fleet-gas error ${(worst * 100).toFixed(4)}% at hour ${worstHour} (tolerance 2%); plan B dispatched at sim hour ${dispatchHour.toFixed(2)}`);
record('new targets took effect after the boundary', differsFromA > 0, `${differsFromA} hours differ from plan A by more than 2%`);

// Capacity: hours closed before the change keep the old value, later hours carry the new one.
const capOld = scenario.capacityMMcfd / 24;
const capNew = NEW_CAPACITY_MMCFD / 24;
const wrongCap = final.filter(r => {
  if (r[0] < Math.floor(Number(before.cfg[1])) ) return Math.abs(r[2] - capOld) > 1e-9;
  if (r[0] > Math.floor(dispatchHour)) return Math.abs(r[2] - capNew) > 1e-9;
  return Math.abs(r[2] - capOld) > 1e-9 && Math.abs(r[2] - capNew) > 1e-9;
}).length;
record('aggregate_hour.capacity_mmcf follows set_params from the change on', wrongCap === 0,
  `${capOld.toFixed(4)} MMcf/h before, ${capNew.toFixed(4)} MMcf/h after, ${wrongCap} rows off`);

// Leave the database idle and clean.
call('reset_households');
load(scenario);

const failed = results.filter(r => !r.ok).length;
console.log(`${results.length - failed}/${results.length} checks passed`);
if (failed > 0) {
  console.error('FAIL');
  process.exit(1);
}
console.log('PASS');
