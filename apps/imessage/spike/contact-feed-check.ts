// Checks that the companion's identity can subscribe to the contact_feed view (STDB msg 282).
// Dev only. A second identity joins as a household and opts in with a fake +1555 number.
// Run: STDB_PASSCODE=dev-passcode npx tsx apps/imessage/spike/contact-feed-check.ts
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DbConnection } from '@thermal-reserve/stdb-bindings';

const database = 'thermal-reserve-dev';
const passcode = process.env.STDB_PASSCODE;
if (!passcode) throw new Error('set STDB_PASSCODE');
const here = dirname(fileURLToPath(import.meta.url));
const token = (name: string) => { try { return readFileSync(join(here, '..', 'data', name), 'utf8').trim() || undefined; } catch { return undefined; } };
const t0 = Date.now();
const log = (m: string) => console.log(`+${((Date.now() - t0) / 1000).toFixed(1)}s ${m}`);
const mask = (p: string) => p.replace(/\d(?=\d{4})/g, '•');
const connect = (tok: string | undefined) => new Promise<InstanceType<typeof DbConnection>>((resolve, reject) => {
  DbConnection.builder().withUri('wss://maincloud.spacetimedb.com').withDatabaseName(database).withToken(tok)
    .onConnect(c => resolve(c)).onConnectError((_c, e) => reject(e)).build();
});

const reader = await connect(token(`${database}.token`));
await reader.reducers.claimContactReader({ passcode });
log('reader: claimed contact reader');
reader.db.contactFeed.onInsert((_c, r) => log(`reader: feed insert ${r.firstName} ${r.lastName} ${mask(r.phone)} optedInAt=${String(r.optedInAt?.toDate?.() ?? r.optedInAt)}`));
reader.db.contactFeed.onDelete((_c, r) => log(`reader: feed delete ${mask(r.phone)}`));
await new Promise<void>(res => reader.subscriptionBuilder()
  .onApplied(() => { log(`reader: subscribed, ${[...reader.db.contactFeed.iter()].length} row(s)`); res(); })
  .onError(ctx => { log(`reader: subscription error ${String((ctx as { event?: unknown }).event)}`); res(); })
  .subscribe(['SELECT * FROM contact_feed']));

const joiner = await connect(token(`${database}.driver.token`));
await joiner.reducers.joinHousehold({ nickname: 'Feed test', heating: 'furnace', thermostat: 'other', exempt: false });
await joiner.reducers.setContact({ firstName: 'Test', lastName: 'User', phone: '+1 (555) 555-0123' });
log('joiner: joined and set contact');
// An identity that is not the reader must see nothing.
let leaked = -1;
await new Promise<void>(res => joiner.subscriptionBuilder()
  .onApplied(() => { leaked = [...joiner.db.contactFeed.iter()].length; res(); })
  .onError(() => res())
  .subscribe(['SELECT * FROM contact_feed']));
log(`joiner (not reader): sees ${leaked} feed row(s)`);
await new Promise(r => setTimeout(r, 3000));
log(`reader: now ${[...reader.db.contactFeed.iter()].length} row(s)`);
await joiner.reducers.clearContact({});
await new Promise(r => setTimeout(r, 3000));
log(`reader: after clear ${[...reader.db.contactFeed.iter()].length} row(s)`);
// STOP path: the household opts in again, then the reader deletes the row (remove_contact).
await joiner.reducers.setContact({ firstName: 'Test', lastName: 'User', phone: '+15555550123' });
await new Promise(r => setTimeout(r, 2000));
const row = [...reader.db.contactFeed.iter()][0];
// Contact line: the reader sets it; the household sees only its own row.
if (row) await reader.reducers.setContactLine({ identity: row.identity, line: '+1 628 555 0100' });
await new Promise<void>(res => joiner.subscriptionBuilder().onApplied(() => res()).onError(() => res()).subscribe(['SELECT * FROM my_contact_line']));
await new Promise(r => setTimeout(r, 1500));
log(`joiner: my_contact_line = ${[...joiner.db.myContactLine.iter()].map(r => mask(r.line)).join(', ') || '(none)'}`);
log(`reader: before STOP ${row ? 1 : 0} row(s)`);
if (row) await reader.reducers.removeContact({ identity: row.identity });
await new Promise(r => setTimeout(r, 2000));
log(`reader: after removeContact ${[...reader.db.contactFeed.iter()].length} row(s); joiner line rows ${[...joiner.db.myContactLine.iter()].length}`);
try { await joiner.reducers.removeContact({ identity: joiner.identity! }); log('joiner: removeContact allowed (unexpected)'); }
catch (e) { log(`joiner (not reader): removeContact rejected: ${String(e).slice(0, 80)}`); }
reader.disconnect(); joiner.disconnect();
process.exit(0);
