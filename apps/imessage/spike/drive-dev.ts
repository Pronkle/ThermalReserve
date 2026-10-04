// Phase 0 spike: drive a short run on thermal-reserve-dev from Node (no spacetime CLI needed)
// so stdb-watch.ts has household updates to print. Dev database only.
// Run: STDB_PASSCODE=dev-passcode npx tsx apps/imessage/spike/drive-dev.ts [speed] [naive|optimized] [scenario] [delayS]
// Joins as household "CHAT test", prints its link code, waits delayS seconds, then starts.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DbConnection } from '@thermal-reserve/stdb-bindings';
import { buildCohorts } from '../../../packages/model/src/fleet';
import { loadConstants } from '../../../packages/model/src/constants';
import { planNaive4h } from '../../../packages/model/src/strategies';
import { solvePlan } from '../../../packages/model/src/lp';
import { linkCode } from '../src/link';

const database = 'thermal-reserve-dev';
const speed = Number(process.argv[2] ?? 4);
const strategy = process.argv[3] ?? 'naive';
const scenarioId = process.argv[4] ?? 'design';
const delayS = Number(process.argv[5] ?? 0);
const passcode = process.env.STDB_PASSCODE;
if (!passcode) throw new Error('set STDB_PASSCODE');

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../../..');
const json = (p: string) => JSON.parse(readFileSync(join(root, 'data', p), 'utf8'));
const constantsJson = json('constants.json');
const consts = loadConstants(constantsJson);
const scenario = json(`scenarios/${scenarioId}.json`);
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
const plan = strategy === 'optimized'
  ? await solvePlan(scenario, cohorts, cfg, 'OPTIMIZED', consts)
  : planNaive4h(scenario, cohorts, cfg);
if (plan.note) console.log(`[driver] plan note: ${plan.note}`);

// A separate identity from the watcher, so the household belongs to the driver.
const tokenFile = join(here, '..', 'data', `${database}.driver.token`);
let token: string | undefined;
try { token = readFileSync(tokenFile, 'utf8').trim() || undefined; } catch { /* first run */ }

const t0 = Date.now();
const log = (msg: string) => console.log(`+${((Date.now() - t0) / 1000).toFixed(1)}s [driver] ${msg}`);

DbConnection.builder().withUri('wss://maincloud.spacetimedb.com').withDatabaseName(database).withToken(token)
  .onConnect(async (conn, _identity, issuedToken) => {
    mkdirSync(dirname(tokenFile), { recursive: true });
    writeFileSync(tokenFile, issuedToken, { mode: 0o600 });
    const r = conn.reducers;
    try {
      await r.claimOperator({ passcode });
      await r.pause({});
      await r.loadScenario({
        scenarioJson: JSON.stringify(scenario),
        cohortsJson: JSON.stringify(cohorts),
        configJson: JSON.stringify({ ...cfg, hhvBtuPerCf: consts.hhvBtuPerCf, speedHoursPerSec: speed }),
      });
      await r.resetHouseholds({});
      await r.joinHousehold({ nickname: 'CHAT test', heating: 'furnace', thermostat: 'other', exempt: false });
      await r.setPlan({ planId: plan.id, strategy: plan.strategy, targetsJson: JSON.stringify(plan.targetsF) });
      log(`joined as CHAT test; link code ${linkCode(_identity.toHexString())}; starting in ${delayS} s`);
      await new Promise(res => setTimeout(res, delayS * 1000));
      await r.start({});
      log(`started ${scenario.id} with ${plan.strategy} at ${speed} h/s`);
    } catch (e) {
      log(`reducer failed: ${String(e)}`);
      process.exit(1);
    }
    conn.subscriptionBuilder().subscribe(['SELECT * FROM sim_config']);
    conn.db.simConfig.onUpdate((_ctx, _old, n) => {
      if (n.status === 'finished') { log('run finished'); conn.disconnect(); process.exit(0); }
    });
  })
  .onConnectError((_ctx, err) => { log(`connect error: ${String(err)}`); process.exit(1); })
  .build();
