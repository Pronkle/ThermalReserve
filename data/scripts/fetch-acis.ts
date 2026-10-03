// Downloads daily station data for Anchorage International from ACIS StnData into data/raw/.
// ONLINE step, run by hand: npx tsx data/scripts/fetch-acis.ts
// `npm run data` never calls this; it rebuilds everything offline from the saved raw files.
//
// Endpoint and datasets: master plan §12. ACIS is free and needs no key.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rawDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'raw');
const ENDPOINT = 'https://data.rcc-acis.org/StnData';
const EXPECTED_NAME = /ANCHORAGE.*INTERNATIONAL|ANCHORAGE INTL/i;

const requests = [
  { file: 'acis_panc_2024-01_2024-02.json', sdate: '2024-01-01', edate: '2024-02-29', elems: ['maxt', 'mint', 'avgt', 'hdd'] },
  { file: 'acis_panc_2025-11_2026-03.json', sdate: '2025-11-01', edate: '2026-03-31', elems: ['maxt', 'mint', 'avgt', 'hdd'] },
  { file: 'acis_panc_1996_2025.json', sdate: '1996-01-01', edate: '2025-12-31', elems: ['avgt', 'hdd'] },
];

mkdirSync(rawDir, { recursive: true });
for (const r of requests) {
  const body = { sid: 'PANC', sdate: r.sdate, edate: r.edate, elems: r.elems, meta: ['name', 'll', 'sids'] };
  const res = await fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${r.file}: HTTP ${res.status}`);
  const json = (await res.json()) as { meta?: { name?: string }; data?: unknown[]; error?: string };
  if (json.error) throw new Error(`${r.file}: ACIS error ${json.error}`);
  const name = json.meta?.name ?? '';
  if (!EXPECTED_NAME.test(name)) throw new Error(`${r.file}: unexpected station "${name}"`);
  const saved = { request: { endpoint: ENDPOINT, ...body }, retrievedIso: new Date().toISOString(), ...json };
  writeFileSync(join(rawDir, r.file), JSON.stringify(saved) + '\n');
  console.log(`saved ${r.file}: ${name}, ${json.data?.length ?? 0} days`);
}
