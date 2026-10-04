// Read-only check (spike): claim the contact reader on one database and list contact_feed rows (masked).
import { readFileSync } from 'node:fs';
import { DbConnection } from '@thermal-reserve/stdb-bindings';
const [db, passcode] = [process.argv[2], process.argv[3]];
const dir = new URL('../data', import.meta.url).pathname;
let token: string | undefined; try { token = readFileSync(`${dir}/${db}.token`, 'utf8').trim() || undefined; } catch {}
const mask = (p: string) => p.replace(/\d(?=\d{4})/g, '•');
DbConnection.builder().withUri('wss://maincloud.spacetimedb.com').withDatabaseName(db).withToken(token)
  .onConnect(async (c, _id, issued) => {
    if (!token) { const { writeFileSync, mkdirSync } = await import('node:fs'); mkdirSync(dir, { recursive: true }); writeFileSync(`${dir}/${db}.token`, issued, { mode: 0o600 }); }
    try { await c.reducers.claimContactReader({ passcode }); } catch (e) { console.log(`${db}: claim failed: ${String(e).slice(0, 100)}`); process.exit(0); }
    c.subscriptionBuilder().onApplied(() => {
      const homes = new Map([...c.db.household.iter()].map(h => [h.identity.toHexString(), h.nickname]));
      const rows = [...c.db.contactFeed.iter()];
      console.log(`${db}: ${homes.size} household(s), ${rows.length} opted-in contact(s)`);
      for (const r of rows) console.log(`  - ${r.firstName} ${r.lastName} | ${mask(r.phone)} | home "${homes.get(r.identity.toHexString()) ?? '?'}" | opted in ${r.optedInAt?.toDate?.().toLocaleTimeString('en-US', { timeZone: 'America/New_York' })}`);
      c.disconnect(); process.exit(0);
    }).subscribe(['SELECT * FROM contact_feed', 'SELECT * FROM household']);
  }).onConnectError((_c, e) => { console.log(`${db}: connect error ${String(e)}`); process.exit(0); }).build();
