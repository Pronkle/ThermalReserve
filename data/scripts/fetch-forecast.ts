// Downloads archived NWS National Blend text forecasts (NBS short range, NBE extended) for
// Anchorage International (PANC) from the Iowa Environmental Mesonet MOS archive into data/raw/.
// ONLINE step, run by hand: npx tsx data/scripts/fetch-forecast.ts
// `npm run data` never calls this; it rebuilds everything offline from the saved raw files.
//
// Endpoint checked on a live call on 2026-10-04 (https://mesonet.agron.iastate.edu/api/1/docs):
//   GET /api/1/mos.json?station=PANC&model=NBS|NBE&runtime=<UTC ISO>
//   rows carry runtime, ftime (UTC), tmp (°F), tsd (temperature spread, °F), txn (max/min), xnd (its spread).
//   NBS: 3-hourly to about 72 h. NBE: 12-hourly to about 10 days.
//   Runs older than 7 days are kept only for 01, 07, 13 and 19 UTC. IEM is free and needs no key.
//
// For each replay scenario this saves the last five archived runs before hour 0 and every archived
// run issued during the scenario. AGENTS.md Section 6 asks for the last one before hour 0; a run's
// first max/min forecast is 17 to 23 h after its run time, so the four earlier runs are what cover
// the scenario's first hours.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const rawDir = join(dataDir, 'raw');
const ENDPOINT = 'https://mesonet.agron.iastate.edu/api/1/mos.json';
const STATION = 'PANC';
const MODELS = ['NBS', 'NBE'] as const;
const ARCHIVED_RUN_HOURS_UTC = [1, 7, 13, 19];
const SCENARIOS = ['feb2024', 'lastwinter'];
const HOUR_MS = 3_600_000;
const RUNS_BEFORE_START = 5;

interface MosRow { station?: string; model?: string; runtime?: string; ftime?: string; tmp?: number | null; tsd?: number | null }
interface MosResponse { data?: MosRow[] }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Run times to request: the last archived cycle at or before scenario start, then every archived
// cycle before the scenario ends.
function runTimes(startMs: number, hours: number): string[] {
  const endMs = startMs + hours * HOUR_MS;
  const all: number[] = [];
  const day0 = Date.UTC(new Date(startMs).getUTCFullYear(), new Date(startMs).getUTCMonth(), new Date(startMs).getUTCDate()) - 48 * HOUR_MS;
  for (let d = day0; d < endMs; d += 24 * HOUR_MS) {
    for (const h of ARCHIVED_RUN_HOURS_UTC) all.push(d + h * HOUR_MS);
  }
  const before = all.filter((t) => t <= startMs);
  const during = all.filter((t) => t > startMs && t < endMs);
  return [...before.slice(-RUNS_BEFORE_START), ...during].map((t) => new Date(t).toISOString().replace('.000Z', 'Z'));
}

async function fetchRun(model: string, runtime: string): Promise<MosResponse> {
  const url = `${ENDPOINT}?station=${STATION}&model=${model}&runtime=${encodeURIComponent(runtime)}`;
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url);
    if (res.ok) return (await res.json()) as MosResponse;
    if (attempt >= 4) throw new Error(`${model} ${runtime}: HTTP ${res.status}`);
    await sleep(2000 * attempt);
  }
}

mkdirSync(rawDir, { recursive: true });
for (const id of SCENARIOS) {
  const sc = JSON.parse(readFileSync(join(dataDir, 'scenarios', `${id}.json`), 'utf8')) as { startIso: string; hours: number };
  const times = runTimes(Date.parse(sc.startIso), sc.hours);
  for (const model of MODELS) {
    const runs: { runIso: string; rows: MosRow[] }[] = [];
    let withTemperature = 0;
    for (const runIso of times) {
      const json = await fetchRun(model, runIso);
      const rows = json.data ?? [];
      for (const r of rows) {
        if (r.station !== STATION || r.model !== model) throw new Error(`${model} ${runIso}: unexpected row ${r.station} ${r.model}`);
      }
      if (rows.some((r) => typeof r.tmp === 'number')) withTemperature++;
      runs.push({ runIso, rows });
      await sleep(300);
    }
    const file = `iem_mos_${model.toLowerCase()}_panc_${id}.json`;
    const saved = {
      request: { endpoint: ENDPOINT, station: STATION, model, runtimes: times },
      scenario: { id, startIso: sc.startIso, hours: sc.hours },
      retrievedIso: new Date().toISOString(),
      runs,
    };
    writeFileSync(join(rawDir, file), JSON.stringify(saved) + '\n');
    console.log(`saved ${file}: ${runs.length} runs requested, ${withTemperature} with temperatures, ${runs.reduce((n, r) => n + r.rows.length, 0)} rows`);
  }
}
