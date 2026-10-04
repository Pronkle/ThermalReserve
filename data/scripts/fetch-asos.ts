// Downloads routine hourly temperature observations for Anchorage International (PANC) from the
// IEM ASOS archive into data/raw/, for each replay scenario's window plus one day either side.
// ONLINE step, run by hand: npx tsx data/scripts/fetch-asos.ts
// `npm run data` never calls this; it rebuilds everything offline from the saved raw files.
//
// Endpoint checked on a live call on 2026-10-04:
//   https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py?help
//   report_type=3 is the routine hourly report (issued at :53); tmpf is °F. IEM is free and needs no key.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'raw');
const ENDPOINT = 'https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py';
const windows = [
  { id: 'feb2024', sts: '2024-01-30T09:00Z', ets: '2024-02-05T09:00Z' },
  { id: 'lastwinter', sts: '2026-01-01T09:00Z', ets: '2026-01-07T09:00Z' },
];

for (const w of windows) {
  const url = `${ENDPOINT}?station=PANC&data=tmpf&sts=${w.sts}&ets=${w.ets}&tz=Etc/UTC&format=onlycomma&latlon=no&elev=no&missing=M&trace=T&direct=no&report_type=3`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${w.id}: HTTP ${res.status}`);
  const text = await res.text();
  const lines = text.trim().split('\n');
  if (lines[0] !== 'station,valid,tmpf') throw new Error(`${w.id}: unexpected header "${lines[0]}"`);
  const file = join(outDir, `asos_panc_${w.id}.csv`);
  writeFileSync(file, text);
  console.log(`saved ${file}: ${lines.length - 1} observations, ${lines.filter((l) => l.endsWith(',M')).length} missing`);
}
