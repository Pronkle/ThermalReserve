// Live acceptance for the Spacetime module: runs the `design` scenario on a database and
// compares aggregate_hour with ENGINE's runPlan.
//
//   node --import tsx stdb/scripts/accept.ts <database> <mode> [speedHoursPerSec]
//
// Modes:
//   baseline   S1: no plan; every hour within 1% of runPlan(BASELINE)
//   naive      S2: NAIVE_4H dispatched, override rate 0; every hour within 2% of runPlan(NAIVE_4H)
//   overrides  S2: NAIVE_4H with simulated overrides; reassignment logged, nothing below the floor
//   household  S3: the caller joins as a household, overrides mid-event, then rejoins
//
// STDB_PASSCODE is the operator passcode (the first claim on a fresh database sets it).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCohorts, sampleHomes } from '../../packages/model/src/fleet';
import { loadConstants } from '../../packages/model/src/constants';
import { planBaseline, planNaive4h, runPlan } from '../../packages/model/src/strategies';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const db = process.argv[2];
const mode = process.argv[3];
const speed = Number(process.argv[4] ?? 4);
if (!db || !['baseline', 'naive', 'overrides', 'household'].includes(mode)) {
  console.error('usage: accept.ts <database> <baseline|naive|overrides|household> [speedHoursPerSec]');
  process.exit(2);
}
const passcode = process.env.STDB_PASSCODE;
if (!passcode) {
  console.error('set STDB_PASSCODE');
  process.exit(2);
}

const json = (p: string) => JSON.parse(readFileSync(join(root, 'data', p), 'utf8'));
const constantsJson = json('constants.json');
const consts = loadConstants(constantsJson);
const scenario = json('scenarios/design.json');
const cohorts = buildCohorts(json('cohort_spec.json'), consts.uaMeanBtuHPerF);
const cfg = {
  enrolledHomes: 25000,
  exemptShare: constantsJson.exempt_share.value,
  floorF: constantsJson.floor_default_f.value,
  maxDepthF: constantsJson.max_depth_default_f.value,
  overrideRate: mode === 'overrides' ? constantsJson.override_rate.value : 0,
  capacityMMcfd: scenario.capacityMMcfd,
  seed: 42,
};

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
  spacetime('call', '--server', 'maincloud', db, reducer, ...args.map(a => JSON.stringify(a)));
// The CLI prints a header, a dashed separator, then one line per row.
const sqlRows = (query: string) => {
  const lines = spacetime('sql', '--server', 'maincloud', db, query).split('\n');
  const sep = lines.findIndex(l => /^-+(\+-+)*$/.test(l.trim()));
  return lines
    .slice(sep + 1)
    .filter(l => l.trim() !== '')
    .map(l => l.split('|').map(c => c.trim()));
};
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

call('claim_operator', passcode);
call('pause');
call(
  'load_scenario',
  JSON.stringify(scenario),
  JSON.stringify(cohorts),
  JSON.stringify({ ...cfg, hhvBtuPerCf: consts.hhvBtuPerCf, speedHoursPerSec: speed })
);

if (mode === 'overrides') {
  const homes = sampleHomes(cohorts, json('anchors.json'), 1000, cfg, scenario);
  for (let i = 0; i < homes.length; i += 250) call('load_homes', JSON.stringify(homes.slice(i, i + 250)));
}

const plan = mode === 'baseline' ? planBaseline(scenario, cohorts) : planNaive4h(scenario, cohorts, cfg);
// JSON.stringify turns NaN (follow normal setpoint) into null, which set_plan expects.
if (mode !== 'baseline') call('set_plan', plan.id, plan.strategy, JSON.stringify(plan.targetsF));

if (mode === 'household') {
  call('reset_households');
  call('join_household', 'Test <b>Home</b>', 'furnace', 'Nest', false);
}

call('start');
const t0 = Date.now();
let status = '';
let overrode = false;
let rejoined = false;
while (Date.now() - t0 < 240_000) {
  await sleep(3000);
  if (mode === 'household') {
    // Override during the first morning setback, rejoin a simulated day later.
    const simHour = Number(sqlRows('SELECT sim_hour FROM sim_config')[0]?.[0]);
    const cs = sqlRows('SELECT mode FROM cohort_state')[0]?.[0] ?? '';
    if (!overrode && cs.includes('holding')) {
      call('override');
      overrode = true;
    } else if (overrode && !rejoined && simHour >= 48) {
      call('cancel_override');
      rejoined = true;
    }
  }
  status = sqlRows('SELECT status FROM sim_config')[0]?.[0]?.replaceAll('"', '') ?? '';
  if (status === 'finished') break;
}
const elapsedS = (Date.now() - t0) / 1000;
if (status !== 'finished') throw new Error(`run did not finish (status: ${status})`);

const live = new Map<number, { fleet: number; minTa: number; overrides: number }>();
for (const cells of sqlRows('SELECT hour, fleet_gas_mmcf, min_ta_f, overrides FROM aggregate_hour')) {
  const [hour, fleet, minTa, overrides] = cells.map(Number);
  if ([hour, fleet, minTa, overrides].every(Number.isFinite)) live.set(hour, { fleet, minTa, overrides });
}
console.log(`database ${db}, mode ${mode}: ${live.size} aggregate rows in ${elapsedS.toFixed(0)} s at ${speed} h/s`);

let ok = live.size === scenario.hours;
const expected = runPlan(scenario, cohorts, cfg, plan, consts);

if (mode === 'household') {
  const hh = sqlRows('SELECT nickname, saved_cf, overridden, ta_f, cohort_id FROM household');
  const kinds = sqlRows('SELECT kind FROM event_log').map(r => r[0].replaceAll('"', ''));
  const count = (k: string) => kinds.filter(x => x === k).length;
  const savedCf = Number(hh[0]?.[1]);
  console.log(`household: ${hh[0]?.join(' | ')}`);
  console.log(`override sent: ${overrode}, rejoin sent: ${rejoined}; events: ${count('join')} join, ${count('override')} override, ${count('reassign')} reassign`);
  ok = ok && hh.length === 1 && hh[0][0] === '"Test bHome/b"' && savedCf > 0 && overrode && rejoined && count('join') === 1 && count('override') === 2 && count('reassign') >= 1;
} else if (mode === 'overrides') {
  const minTa = Math.min(...[...live.values()].map(r => r.minTa));
  const lastOverrides = live.get(scenario.hours - 1)?.overrides ?? 0;
  const kinds = sqlRows('SELECT kind FROM event_log').map(r => r[0].replaceAll('"', ''));
  const count = (k: string) => kinds.filter(x => x === k).length;
  const liveTotal = [...live.values()].reduce((a, r) => a + r.fleet, 0);
  console.log(`minimum indoor temperature: ${minTa.toFixed(2)} °F (floor ${cfg.floorF} °F)`);
  console.log(`homes overridden at end: ${lastOverrides}; events: ${count('override')} override, ${count('reassign')} reassign`);
  console.log(`fleet gas ${liveTotal.toFixed(3)} MMcf live vs ${expected.totals.fleetGasMMcf.toFixed(3)} MMcf runPlan (no reassignment in runPlan)`);
  ok = ok && minTa >= cfg.floorF - 1e-6 && count('reassign') > 0 && lastOverrides > 0;
} else {
  const tolerance = mode === 'baseline' ? 0.01 : 0.02;
  let worst = 0;
  let worstHour = -1;
  for (const h of expected.hours) {
    const row = live.get(h.hour);
    if (!row) throw new Error(`aggregate_hour missing hour ${h.hour}`);
    const err = Math.abs(row.fleet - h.fleetGasMMcfh) / h.fleetGasMMcfh;
    if (err > worst) [worst, worstHour] = [err, h.hour];
  }
  console.log(`worst hourly fleet-gas error vs runPlan(${plan.strategy}): ${(worst * 100).toFixed(4)}% at hour ${worstHour} (tolerance ${tolerance * 100}%)`);
  console.log(`net saved: ${expected.totals.netSavedMMcf.toFixed(4)} MMcf in runPlan`);
  ok = ok && worst <= tolerance;
}

if (!ok) {
  console.error('FAIL');
  process.exit(1);
}
console.log('PASS');
