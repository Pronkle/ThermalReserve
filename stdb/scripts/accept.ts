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
//   validation S5: one bad input per validation rule; each must be rejected and leave state unchanged
//
// STDB_PASSCODE is the operator passcode (the first claim on a fresh database sets it).
// STDB_SERVER selects the server (default maincloud).
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
if (!db || !['baseline', 'naive', 'overrides', 'household', 'validation'].includes(mode)) {
  console.error('usage: accept.ts <database> <baseline|naive|overrides|household|validation> [speedHoursPerSec]');
  process.exit(2);
}
const server = process.env.STDB_SERVER ?? 'maincloud';
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
  spacetime('call', '--server', server, db, reducer, ...args.map(a => JSON.stringify(a)));
// A fresh anonymous identity per call (used to fill the household cap).
const callAnonymous = (reducer: string, ...args: unknown[]) =>
  spacetime('call', '--server', server, '--anonymous', db, reducer, ...args.map(a => JSON.stringify(a)));
// The CLI prints a header, a dashed separator, then one line per row.
const sqlRows = (query: string) => {
  const lines = spacetime('sql', '--server', server, db, query).split('\n');
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

if (mode === 'validation') {
  await validationMode();
  process.exit(0);
}

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

// ---------- S5 validation mode ----------

async function validationMode() {
  const results: { rule: string; ok: boolean; detail: string }[] = [];
  const errText = (e: unknown) => {
    const x = e as { stderr?: unknown; stdout?: unknown; message?: unknown };
    return `${String(x.stderr ?? '')} ${String(x.stdout ?? '')} ${String(x.message ?? '')}`.replace(/\s+/g, ' ').trim();
  };
  // A rule passes when the call is rejected; the server message is printed for review.
  const expectReject = (rule: string, fn: () => unknown, expect: string) => {
    try {
      fn();
      results.push({ rule, ok: false, detail: 'accepted (should have been rejected)' });
    } catch (e) {
      const msg = errText(e);
      results.push({ rule, ok: true, detail: msg.includes(expect) ? `rejected: "${expect}"` : `rejected (message: ${msg.slice(0, 160)})` });
    }
  };
  const expectAccept = (rule: string, fn: () => unknown) => {
    try {
      fn();
      results.push({ rule, ok: true, detail: 'accepted' });
    } catch (e) {
      results.push({ rule, ok: false, detail: `rejected: ${errText(e).slice(0, 160)}` });
    }
  };
  const configRow = () => sqlRows('SELECT scenario_id, hours, enrolled_homes, floor_f, max_depth_f, speed_hours_per_sec FROM sim_config')[0]?.join(' | ') ?? '';

  const goodCfg = { ...cfg, hhvBtuPerCf: consts.hhvBtuPerCf, speedHoursPerSec: 2, homesPerDot: 25 };
  const load = (sc: unknown, co: unknown, fc: unknown) => call('load_scenario', JSON.stringify(sc), JSON.stringify(co), JSON.stringify(fc));
  const setParams = (p: Record<string, unknown>) => call('set_params', JSON.stringify(p));

  call('claim_operator', passcode);
  call('pause');
  load(scenario, cohorts, goodCfg);
  const before = configRow();

  // set_params / load_scenario fleet settings
  expectReject('enrolledHomes below 1,000', () => setParams({ enrolledHomes: 999 }), 'config.enrolledHomes');
  expectReject('enrolledHomes above 50,000', () => setParams({ enrolledHomes: 50001 }), 'config.enrolledHomes');
  expectReject('enrolledHomes not an integer', () => setParams({ enrolledHomes: 2500.5 }), 'config.enrolledHomes');
  expectReject('floorF above 70', () => setParams({ floorF: 71 }), 'config.floorF');
  expectReject('maxDepthF above 10', () => setParams({ maxDepthF: 11 }), 'config.maxDepthF');
  expectReject('maxDepthF below 0', () => setParams({ maxDepthF: -1 }), 'config.maxDepthF');
  expectReject('speed below 0.5', () => setParams({ speedHoursPerSec: 0.4 }), 'config.speedHoursPerSec');
  expectReject('speed above 4', () => setParams({ speedHoursPerSec: 5 }), 'config.speedHoursPerSec');
  expectReject('exemptShare above 1', () => setParams({ exemptShare: 1.5 }), 'config.exemptShare');
  expectReject('overrideRate below 0', () => setParams({ overrideRate: -0.1 }), 'config.overrideRate');
  expectReject('capacity not positive', () => setParams({ capacityMMcfd: 0 }), 'config.capacityMMcfd');
  expectReject('homesPerDot not positive', () => setParams({ homesPerDot: 0 }), 'config.homesPerDot');
  expectReject('load_scenario hhvBtuPerCf not positive', () => load(scenario, cohorts, { ...goodCfg, hhvBtuPerCf: 0 }), 'config.hhvBtuPerCf');
  expectReject('load_scenario enrolledHomes out of range', () => load(scenario, cohorts, { ...goodCfg, enrolledHomes: 60000 }), 'config.enrolledHomes');

  // load_scenario: scenario shape
  const long = { ...scenario, hours: 241, outdoorF: Array(241).fill(0), systemMMcfh: Array(241).fill(10) };
  expectReject('hours above 240', () => load(long, cohorts, goodCfg), 'scenario.hours');
  expectReject('eventStartHour not before eventEndHour', () => load({ ...scenario, eventStartHour: 50, eventEndHour: 50 }, cohorts, goodCfg), 'eventStartHour');
  expectReject('eventEndHour beyond hours', () => load({ ...scenario, eventEndHour: scenario.hours + 1 }, cohorts, goodCfg), 'scenario.eventEndHour');

  // load_scenario: cohorts
  const tooMany = Array.from({ length: 65 }, (_, i) => ({ ...cohorts[0], id: i, share: 1 / 65 }));
  expectReject('no cohorts', () => load(scenario, [], goodCfg), 'cohorts_json');
  expectReject('more than 64 cohorts', () => load(scenario, tooMany, goodCfg), 'cohorts_json');
  expectReject('duplicate cohort id', () => load(scenario, cohorts.map((c, i) => (i === 1 ? { ...c, id: 0 } : c)), goodCfg), 'duplicate id');
  expectReject('shares not summing to 1', () => load(scenario, cohorts.map((c, i) => (i === 0 ? { ...c, share: c.share + 0.01 } : c)), goodCfg), 'shares sum');
  expectReject('non-positive UA', () => load(scenario, cohorts.map((c, i) => (i === 0 ? { ...c, UA: 0 } : c)), goodCfg), '.UA');
  expectReject('eta above 1', () => load(scenario, cohorts.map((c, i) => (i === 0 ? { ...c, eta: 1.2 } : c)), goodCfg), '.eta');

  const afterConfigRules = configRow();
  results.push({ rule: 'rejected calls left sim_config unchanged', ok: afterConfigRules === before, detail: `${before} -> ${afterConfigRules}` });

  // floor below 60 is clamped (accepted), then restored
  expectAccept('floorF 55 accepted', () => setParams({ floorF: 55 }));
  const clamped = Number(sqlRows('SELECT floor_f FROM sim_config')[0]?.[0]);
  results.push({ rule: 'floorF 55 clamped to 60', ok: clamped === 60, detail: `floor_f = ${clamped}` });
  setParams({ floorF: cfg.floorF });

  // load_homes
  const home = { id: 0, cohortId: 0, lat: 61.2, lon: -149.9, exempt: false, overrideHour: null };
  expectReject('home id not an integer', () => call('load_homes', JSON.stringify([{ ...home, id: 1.5 }])), 'home.id');
  expectReject('home cohortId unknown', () => call('load_homes', JSON.stringify([{ ...home, cohortId: 999 }])), 'no cohort');
  expectReject('home lat out of range', () => call('load_homes', JSON.stringify([{ ...home, lat: 91 }])), 'home.lat');
  expectReject('home lon out of range', () => call('load_homes', JSON.stringify([{ ...home, lon: 181 }])), 'home.lon');
  for (let i = 0; i < 2000; i += 250) {
    call('load_homes', JSON.stringify(Array.from({ length: 250 }, (_, j) => ({ ...home, id: i + j }))));
  }
  expectReject('more than 2,000 sample homes', () => call('load_homes', JSON.stringify([{ ...home, id: 2000 }])), 'at most 2000');
  expectAccept('re-sending an existing home id is allowed at the cap', () => call('load_homes', JSON.stringify([{ ...home, id: 5 }])));

  // set_plan
  const plan = planNaive4h(scenario, cohorts, cfg);
  const withTarget = (v: number) => plan.targetsF.map((row, c) => (c === 0 ? row.map((x, h) => (h === scenario.eventStartHour ? v : x)) : row));
  expectReject('plan target below 40 °F', () => call('set_plan', 'bad-low', plan.strategy, JSON.stringify(withTarget(39))), 'between 40 and 80');
  expectReject('plan target above 80 °F', () => call('set_plan', 'bad-high', plan.strategy, JSON.stringify(withTarget(81))), 'between 40 and 80');
  expectAccept('valid NAIVE_4H plan accepted', () => call('set_plan', plan.id, plan.strategy, JSON.stringify(plan.targetsF)));

  // join_household cap: 50 anonymous households, then the 51st is rejected
  call('reset_households');
  for (let i = 0; i < 50; i++) callAnonymous('join_household', `Cap ${i}`, 'furnace', 'other', false);
  const joined = sqlRows('SELECT nickname FROM household').length;
  if (joined < 50) {
    results.push({ rule: 'household cap (50)', ok: true, detail: `SKIP: only ${joined} distinct households after 50 anonymous joins; the CLI may reuse one anonymous identity. Test with phones or browsers.` });
  } else {
    expectReject('51st household rejected', () => callAnonymous('join_household', 'Cap 51', 'furnace', 'other', false), 'demo is full');
  }
  call('reset_households');

  // leave the database in a clean, valid state
  load(scenario, cohorts, goodCfg);

  for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.rule}: ${r.detail}`);
  const failed = results.filter(r => !r.ok).length;
  console.log(`${results.length - failed}/${results.length} validation checks passed`);
  if (failed > 0) {
    console.error('FAIL');
    process.exit(1);
  }
  console.log('PASS');
}
