// Phase 0 spike: subscribe to a Thermal Reserve database from Node with the
// generated bindings and print household and sim_config changes.
// Run: node --import tsx apps/imessage/spike/stdb-watch.ts [database] [seconds]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DbConnection } from '@thermal-reserve/stdb-bindings';

const uri = process.env.STDB_URI ?? 'wss://maincloud.spacetimedb.com';
const database = process.argv[2] ?? 'thermal-reserve-dev';
const seconds = Number(process.argv[3] ?? 30);

// Our own client identity, kept in a gitignored file (never the operator passcode).
const tokenFile = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', `${database}.token`);
let token: string | undefined;
try { token = readFileSync(tokenFile, 'utf8').trim() || undefined; } catch { /* first run */ }

const t0 = Date.now();
const log = (msg: string) => console.log(`+${((Date.now() - t0) / 1000).toFixed(1)}s ${msg}`);

const conn = DbConnection.builder().withUri(uri).withDatabaseName(database).withToken(token)
  .onConnect((c, identity, issuedToken) => {
    mkdirSync(dirname(tokenFile), { recursive: true });
    writeFileSync(tokenFile, issuedToken, { mode: 0o600 });
    log(`connected to ${database} as ${identity.toHexString().slice(0, 12)}…`);
    c.subscriptionBuilder()
      .onApplied(() => {
        const cfg = [...c.db.simConfig.iter()][0];
        log(`subscribed: ${[...c.db.household.iter()].length} households; status=${cfg?.status} simHour=${cfg?.simHour?.toFixed(2)} strategy=${cfg?.strategy}`);
      })
      .onError((_ctx, err) => log(`subscription error: ${String(err)}`))
      .subscribe(['SELECT * FROM sim_config', 'SELECT * FROM household']);
  })
  .onConnectError((_ctx, err) => { log(`connect error: ${String(err)}`); process.exit(1); })
  .onDisconnect(() => log('disconnected'))
  .build();

const fmt = (h: { nickname: string; taF: number; targetF: number; overridden: boolean; savedCf: number }) =>
  `${h.nickname}: ta=${h.taF.toFixed(2)}°F target=${h.targetF.toFixed(2)}°F overridden=${h.overridden} saved=${h.savedCf.toFixed(1)} cf`;
conn.db.household.onInsert((_ctx, h) => log(`household joined  ${fmt(h)}`));
conn.db.household.onUpdate((_ctx, _old, h) => log(`household update  ${fmt(h)}`));
conn.db.household.onDelete((_ctx, h) => log(`household removed ${h.nickname}`));
conn.db.simConfig.onUpdate((_ctx, o, n) => {
  if (o.status !== n.status || o.planId !== n.planId) log(`sim_config status=${n.status} plan=${n.planId} strategy=${n.strategy}`);
});

setTimeout(() => { log('done'); conn.disconnect(); process.exit(0); }, seconds * 1000);
