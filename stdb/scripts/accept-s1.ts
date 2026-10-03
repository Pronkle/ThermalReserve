// S1 acceptance: load `design`, run it live on a database, and compare each hour of
// aggregate_hour with ENGINE's runPlan(BASELINE). Pass = every hour within 1%.
//
//   node --import tsx stdb/scripts/accept-s1.ts [database] [speedHoursPerSec]
//
// MODEL_SRC overrides where the model source is read from (default packages/model/src).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const modelSrc = resolve(process.env.MODEL_SRC ?? join(root, 'packages/model/src'));
const db = process.argv[2] ?? 'thermal-reserve-dev';
const speed = Number(process.argv[3] ?? 4);
const TOLERANCE = 0.01;

const load = (name: string) => import(pathToFileURL(join(modelSrc, name)).href);
const { buildCohorts } = await load('fleet.ts');
const { loadConstants } = await load('constants.ts');
const { planBaseline, runPlan } = await load('strategies.ts');

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
  overrideRate: 0, // S1 has no overrides yet
  capacityMMcfd: scenario.capacityMMcfd,
  seed: 42,
};

const spacetime = (...args: string[]) =>
  execFileSync('spacetime', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const call = (reducer: string, ...args: unknown[]) =>
  spacetime('call', '--server', 'maincloud', db, reducer, ...args.map(a => JSON.stringify(a)));
const sql = (query: string) => spacetime('sql', '--server', 'maincloud', db, query);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

call('pause');
call(
  'load_scenario',
  JSON.stringify(scenario),
  JSON.stringify(cohorts),
  JSON.stringify({ ...cfg, hhvBtuPerCf: consts.hhvBtuPerCf, speedHoursPerSec: speed })
);
call('start');
const t0 = Date.now();

let status = '';
while (Date.now() - t0 < 180_000) {
  await sleep(3000);
  status = /"(\w+)"/.exec(sql('SELECT status FROM sim_config').split('\n').slice(2).join(''))?.[1] ?? '';
  if (status === 'finished') break;
}
const elapsedS = (Date.now() - t0) / 1000;
if (status !== 'finished') throw new Error(`run did not finish (status: ${status})`);

const live = new Map<number, { fleet: number; baseline: number }>();
for (const line of sql('SELECT hour, fleet_gas_mmcf, baseline_gas_mmcf FROM aggregate_hour').split('\n')) {
  const cells = line.split('|').map(c => Number(c.trim()));
  if (cells.length === 3 && cells.every(Number.isFinite)) live.set(cells[0], { fleet: cells[1], baseline: cells[2] });
}

const expected = runPlan(scenario, cohorts, cfg, planBaseline(scenario, cohorts), consts);
let worst = 0;
let worstHour = -1;
for (const h of expected.hours) {
  const row = live.get(h.hour);
  if (!row) throw new Error(`aggregate_hour missing hour ${h.hour}`);
  const err = Math.abs(row.fleet - h.fleetGasMMcfh) / h.fleetGasMMcfh;
  if (err > worst) [worst, worstHour] = [err, h.hour];
}

console.log(`database ${db}: ${live.size} aggregate rows in ${elapsedS.toFixed(0)} s at ${speed} h/s`);
console.log(`worst hourly fleet-gas error vs runPlan(BASELINE): ${(worst * 100).toFixed(4)}% at hour ${worstHour}`);
if (live.size !== scenario.hours || worst > TOLERANCE) {
  console.error('FAIL');
  process.exit(1);
}
console.log('PASS');
