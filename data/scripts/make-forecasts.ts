// Adds `forecastRuns` to the scenario files and writes data/forecast_error.json (AGENTS.md
// Section 6). OFFLINE: reads data/raw/iem_mos_*.json (saved by scripts/fetch-forecast.ts) and
// the ACIS files. Runs after make-design.ts and make-replays.ts, which rewrite the scenarios.
//
// Replays (label "sourced"): archived National Blend text forecasts for PANC. The observed
// series in a replay is ACIS daily max/min through an assumed cosine curve (min 07:00, max
// 15:00), so each run's forecast daily max/min (TXN) go through the same curve. Forecast and
// observed then differ only by the forecast's error, not by the curve. NBS supplies max/min to
// about 72 h; NBE (same run time) supplies the days beyond. Spread is the run's own XND.
// Hours a run does not reach (before its first max/min) are null.
//
// Design (label "assumed"): one constructed run per 6 hours, too warm by 3°F at 72 h of lead,
// shrinking linearly to 0 at 0 h.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir, readJson, writeJson, round, T_MIN_CLOCK, T_MAX_CLOCK, type AcisDailyRow, type AcisRaw } from './lib.ts';

const HOUR_MS = 3_600_000;
const STATION = 'PANC';
const LEADS_H = [6, 12, 24, 48, 72];
const LEAD_BIN_EDGES_H = [9, 18, 36, 60, 84]; // a max/min valid 9 h or less after the run counts as lead 6, and so on
const DESIGN_ERROR_F = 3;
const DESIGN_ERROR_LEAD_H = 72;
const DESIGN_RUN_EVERY_H = 6;

interface Scenario { id: string; startIso: string; hours: number; outdoorF: number[]; forecastRuns?: ForecastRun[]; [k: string]: unknown }
interface ForecastRun {
  runIso: string; availableHour: number; model: string; station: string;
  outdoorF: (number | null)[]; sigmaF: (number | null)[]; label: 'sourced' | 'assumed'; source: string;
}
interface MosRow { ftime_utc: string; txn: number | null; xnd: number | null }
interface RawMos { request: { runtimes: string[] }; runs: { runIso: string; rows: MosRow[] }[] }
interface Knot { hour: number; tempF: number; sigmaF: number | null; kind: 'min' | 'max'; leadH: number; localDate: string }

const constantsPath = join(dataDir, 'constants.json');
const lagH = readJson<Record<string, { value: number }>>('constants.json').forecast_lag_h.value;

// One max/min forecast = one knot of the cosine curve. In the NBS and NBE text products for
// Alaska the 12 UTC row carries the overnight minimum and the 00 UTC row the daytime maximum.
// 00 UTC is 15:00 Alaska Standard Time, the curve's maximum; the minimum sits at 07:00, four
// hours after the 12 UTC row.
function knots(rows: MosRow[], runMs: number, startMs: number, seen: Set<number>): Knot[] {
  const out: Knot[] = [];
  for (const r of rows) {
    if (typeof r.txn !== 'number') continue;
    const ft = Date.parse(`${r.ftime_utc}Z`);
    const utcHour = new Date(ft).getUTCHours();
    if (utcHour !== 0 && utcHour !== 12) throw new Error(`max/min at an unexpected hour: ${r.ftime_utc}`);
    const kind = utcHour === 12 ? 'min' : 'max';
    const validMs = kind === 'min' ? ft + (T_MIN_CLOCK - 3) * HOUR_MS : ft;
    if (seen.has(validMs)) continue; // NBS wins over NBE for the same max/min
    seen.add(validMs);
    out.push({
      hour: (validMs - startMs) / HOUR_MS,
      tempF: r.txn,
      sigmaF: typeof r.xnd === 'number' ? r.xnd : null,
      kind,
      leadH: (validMs - runMs) / HOUR_MS,
      localDate: new Date(validMs - 9 * HOUR_MS).toISOString().slice(0, 10),
    });
  }
  return out;
}

function hourlyFromKnots(ks: Knot[], hours: number): { outdoorF: (number | null)[]; sigmaF: (number | null)[] } {
  const outdoorF: (number | null)[] = new Array(hours).fill(null);
  const sigmaF: (number | null)[] = new Array(hours).fill(null);
  for (let i = 0; i + 1 < ks.length; i++) {
    const a = ks[i];
    const b = ks[i + 1];
    for (let h = Math.max(0, Math.ceil(a.hour)); h < hours && (h < b.hour || (i + 2 === ks.length && h <= b.hour)); h++) {
      const x = (h - a.hour) / (b.hour - a.hour);
      outdoorF[h] = round(a.tempF + (b.tempF - a.tempF) * ((1 - Math.cos(Math.PI * x)) / 2), 1);
      sigmaF[h] = a.sigmaF === null || b.sigmaF === null ? null : round(a.sigmaF + (b.sigmaF - a.sigmaF) * x, 1);
    }
  }
  return { outdoorF, sigmaF };
}

// ---------- replays ----------

const replays = [
  { id: 'feb2024', acis: 'raw/acis_panc_2024-01_2024-02.json' },
  { id: 'lastwinter', acis: 'raw/acis_panc_2025-11_2026-03.json' },
];
const errorByScenario: Record<string, unknown> = {};
const pooled: number[][] = LEADS_H.map(() => []);

for (const spec of replays) {
  const sc = readJson<Scenario>(`scenarios/${spec.id}.json`);
  const startMs = Date.parse(sc.startIso);
  const nbsFile = `raw/iem_mos_nbs_panc_${spec.id}.json`;
  const nbeFile = `raw/iem_mos_nbe_panc_${spec.id}.json`;
  const nbs = readJson<RawMos>(nbsFile);
  const nbe = new Map(readJson<RawMos>(nbeFile).runs.map((r) => [r.runIso, r.rows]));
  const acis = new Map(readJson<AcisRaw<AcisDailyRow>>(spec.acis).data.map((r) => [r[0], { max: Number(r[1]), min: Number(r[2]) }]));
  const errors: number[][] = LEADS_H.map(() => []);

  const forecastRuns: ForecastRun[] = [];
  for (const run of nbs.runs) {
    const runMs = Date.parse(run.runIso);
    const seen = new Set<number>();
    const nbsKnots = knots(run.rows, runMs, startMs, seen);
    const nbeKnots = knots(nbe.get(run.runIso) ?? [], runMs, startMs, seen);
    const ks = [...nbsKnots, ...nbeKnots].sort((a, b) => a.hour - b.hour);
    if (ks.length < 2) throw new Error(`${spec.id} ${run.runIso}: fewer than two max/min forecasts`);

    for (const k of ks) {
      const obs = acis.get(k.localDate);
      const bin = LEAD_BIN_EDGES_H.findIndex((edge) => k.leadH <= edge);
      if (!obs || bin < 0) continue;
      const err = k.tempF - (k.kind === 'min' ? obs.min : obs.max);
      errors[bin].push(err);
      pooled[bin].push(err);
    }

    const hourly = hourlyFromKnots(ks, sc.hours);
    forecastRuns.push({
      runIso: run.runIso,
      availableHour: (runMs - startMs) / HOUR_MS + lagH,
      model: nbeKnots.length > 0 ? 'NBS+NBE' : 'NBS',
      station: STATION,
      ...hourly,
      label: 'sourced',
      source:
        `IEM MOS archive, PANC, NBS run ${run.runIso.slice(0, 13)}Z (data/${nbsFile})` +
        (nbeKnots.length > 0 ? `, with NBE for the days beyond its range (data/${nbeFile})` : '') +
        '. Hourly values: the run\'s daily max/min (TXN) through the same cosine interpolation as the observed series (min 07:00, max 15:00); spread from XND.',
    });
  }
  sc.forecastRuns = forecastRuns;
  writeJson(`scenarios/${spec.id}.json`, sc);

  errorByScenario[spec.id] = {
    runs: nbs.runs.length,
    firstRunIso: nbs.runs[0].runIso,
    lastRunIso: nbs.runs[nbs.runs.length - 1].runIso,
    byLead: LEADS_H.map((leadH, i) => ({ leadH, ...stats(errors[i]) })),
  };
  const covered0 = sc.outdoorF.filter((_, h) => forecastRuns.some((r) => r.availableHour <= 0 && r.outdoorF[h] !== null)).length;
  console.log(`${spec.id}: ${forecastRuns.length} forecast runs; ${covered0} of ${sc.hours} hours covered at hour 0`);
}

function stats(xs: number[]): { n: number; meanErrorF: number | null; rmseF: number | null } {
  if (xs.length === 0) return { n: 0, meanErrorF: null, rmseF: null };
  return {
    n: xs.length,
    meanErrorF: round(xs.reduce((a, b) => a + b, 0) / xs.length, 2),
    rmseF: round(Math.sqrt(xs.reduce((a, b) => a + b * b, 0) / xs.length), 2),
  };
}

const pooledByLead = LEADS_H.map((leadH, i) => ({ leadH, ...stats(pooled[i]) }));
writeJson('forecast_error.json', {
  label: 'derived',
  unit: '°F, forecast minus observed',
  method:
    'Each archived run\'s daily max and min forecasts (NBS TXN, NBE beyond its range) minus the ACIS daily max and min for the same local date at PANC. ' +
    `Lead = hours from run time to the max (15:00) or min (07:00); binned to ${LEADS_H.join(', ')} h with upper edges ${LEAD_BIN_EDGES_H.join(', ')} h.`,
  scope: 'Only the runs saved for each replay scenario (the days of the scenario, not the whole winter). Small samples.',
  source: 'IEM MOS archive (data/raw/iem_mos_*.json) and ACIS StnData (data/raw/acis_panc_*.json)',
  scenarios: errorByScenario,
  pooled: pooledByLead,
});

// forecast_rmse_f in constants.json: the pooled RMSE by lead, used where a run carries no spread.
// A lead with no samples takes the next longer lead's value (the text products carry no max/min
// under about 11 h of lead, so the 6 h entry is the 12 h one).
const rmse = pooledByLead.map((p, i) => p.rmseF ?? pooledByLead.slice(i).find((q) => q.rmseF !== null)?.rmseF ?? null);
if (rmse.some((v) => v === null)) throw new Error('forecast_error: no samples at the longest lead');
const borrowed = pooledByLead.filter((p) => p.rmseF === null).map((p) => p.leadH);
const entry = {
  value: rmse, unit: `°F at leads ${LEADS_H.join(', ')} h`, label: 'derived',
  source: 'data/forecast_error.json pooled RMSE of forecast daily max/min against ACIS, both replay scenarios; small samples' +
    (borrowed.length > 0 ? `; no samples at ${borrowed.join(', ')} h, which takes the next longer lead's value` : ''),
};
const line = `  "forecast_rmse_f": ${JSON.stringify(entry).replace(/,"/g, ', "').replace(/":/g, '": ')}`;
let text = readFileSync(constantsPath, 'utf8');
const existing = /^\s*"forecast_rmse_f": \{.*\}(,?)$/m;
text = existing.test(text) ? text.replace(existing, (_m, comma: string) => line + comma) : text.replace(/\n\}\s*$/, `,\n${line}\n}\n`);
JSON.parse(text); // must still be valid JSON
writeFileSync(constantsPath, text);
console.log(`forecast_error: pooled RMSE by lead ${LEADS_H.map((l, i) => `${l} h ${rmse[i]}°F (n=${pooledByLead[i].n})`).join(', ')}`);

// ---------- design ----------

const design = readJson<Scenario>('scenarios/design.json');
const designStartMs = Date.parse(design.startIso);
const designRuns: ForecastRun[] = [];
for (let availableHour = 0; availableHour < design.hours; availableHour += DESIGN_RUN_EVERY_H) {
  const runHour = availableHour - lagH;
  designRuns.push({
    runIso: new Date(designStartMs + runHour * HOUR_MS).toISOString().replace('.000Z', 'Z'),
    availableHour,
    model: 'constructed',
    station: 'none',
    outdoorF: design.outdoorF.map((t, h) =>
      h < runHour ? null : round(t + DESIGN_ERROR_F * Math.min(1, (h - runHour) / DESIGN_ERROR_LEAD_H), 1)),
    sigmaF: design.outdoorF.map(() => null),
    label: 'assumed',
    source: `Constructed, not a real forecast: the scenario's temperatures plus ${DESIGN_ERROR_F}°F at ${DESIGN_ERROR_LEAD_H} h of lead, shrinking linearly to 0 at 0 h (data/scripts/make-forecasts.ts)`,
  });
}
design.forecastRuns = designRuns;
writeJson('scenarios/design.json', design);
console.log(`design: ${designRuns.length} constructed forecast runs`);
