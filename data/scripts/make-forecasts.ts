// Adds `forecastRuns` to the scenario files and writes data/forecast_error.json (AGENTS.md
// Section 6). OFFLINE: reads data/raw/iem_mos_*.json (saved by scripts/fetch-forecast.ts) and
// the ACIS files. Runs after make-design.ts and make-replays.ts, which rewrite the scenarios.
//
// Replays (label "sourced"): archived National Blend text forecasts for PANC. Each run's
// 3-hourly temperatures (NBS `tmp`, to about 72 h) and their spread (`tsd`) are interpolated
// linearly to hourly values; beyond NBS's range the same run time's NBE 12-hourly values are
// used. Hours before a run's first forecast time are null. The observed series they are
// compared with is the airport's routine hourly observations (make-replays.ts).
//
// Design (label "assumed"): one constructed run per 6 hours, too warm by 3°F at 72 h of lead,
// shrinking linearly to 0 at 0 h.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir, readJson, writeJson, round, readHourlyObs } from './lib.ts';

const HOUR_MS = 3_600_000;
const STATION = 'PANC';
const LEADS_H = [6, 12, 24, 48, 72];
const LEAD_BIN_EDGES_H = [9, 18, 36, 60, 84]; // a forecast valid 9 h or less after the run counts as lead 6, and so on
const DESIGN_ERROR_F = 3;
const DESIGN_ERROR_LEAD_H = 72;
const DESIGN_RUN_EVERY_H = 6;

interface Scenario { id: string; startIso: string; hours: number; outdoorF: number[]; forecastRuns?: ForecastRun[]; [k: string]: unknown }
interface ForecastRun {
  runIso: string; availableHour: number; model: string; station: string;
  outdoorF: (number | null)[]; sigmaF: (number | null)[]; label: 'sourced' | 'assumed'; source: string;
}
interface MosRow { ftime_utc: string; tmp: number | null; tsd: number | null }
interface RawMos { request: { runtimes: string[] }; runs: { runIso: string; rows: MosRow[] }[] }
interface Point { hour: number; tempF: number; sigmaF: number | null; leadH: number }

const constantsPath = join(dataDir, 'constants.json');
const lagH = readJson<Record<string, { value: number }>>('constants.json').forecast_lag_h.value;

function points(rows: MosRow[], runMs: number, startMs: number, afterHour = -Infinity): Point[] {
  const out: Point[] = [];
  for (const r of rows) {
    if (typeof r.tmp !== 'number') continue;
    const ft = Date.parse(`${r.ftime_utc}Z`);
    const hour = (ft - startMs) / HOUR_MS;
    if (hour <= afterHour) continue;
    out.push({ hour, tempF: r.tmp, sigmaF: typeof r.tsd === 'number' ? r.tsd : null, leadH: (ft - runMs) / HOUR_MS });
  }
  return out.sort((x, y) => x.hour - y.hour);
}

function hourlyFromPoints(ps: Point[], hours: number): { outdoorF: (number | null)[]; sigmaF: (number | null)[] } {
  const outdoorF: (number | null)[] = new Array(hours).fill(null);
  const sigmaF: (number | null)[] = new Array(hours).fill(null);
  for (let i = 0; i + 1 < ps.length; i++) {
    const a = ps[i];
    const b = ps[i + 1];
    for (let h = Math.max(0, Math.ceil(a.hour)); h < hours && (h < b.hour || (i + 2 === ps.length && h <= b.hour)); h++) {
      const x = (h - a.hour) / (b.hour - a.hour);
      outdoorF[h] = round(a.tempF + (b.tempF - a.tempF) * x, 1);
      sigmaF[h] = a.sigmaF === null || b.sigmaF === null ? null : round(a.sigmaF + (b.sigmaF - a.sigmaF) * x, 1);
    }
  }
  return { outdoorF, sigmaF };
}

// ---------- replays ----------

const replays = [
  { id: 'feb2024', obs: 'raw/asos_panc_feb2024.csv' },
  { id: 'lastwinter', obs: 'raw/asos_panc_lastwinter.csv' },
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
  const obs = readHourlyObs(spec.obs, sc.startIso);
  const errors: number[][] = LEADS_H.map(() => []);

  const forecastRuns: ForecastRun[] = [];
  for (const run of nbs.runs) {
    const runMs = Date.parse(run.runIso);
    const nbsPoints = points(run.rows, runMs, startMs);
    if (nbsPoints.length < 2) throw new Error(`${spec.id} ${run.runIso}: fewer than two forecast temperatures`);
    const nbePoints = points(nbe.get(run.runIso) ?? [], runMs, startMs, nbsPoints[nbsPoints.length - 1].hour);

    // Error table: the run's own 3-hourly temperatures against the observation for the same hour.
    for (const p of nbsPoints) {
      const o = obs.get(p.hour);
      const bin = LEAD_BIN_EDGES_H.findIndex((edge) => p.leadH <= edge);
      if (o === undefined || bin < 0) continue;
      errors[bin].push(p.tempF - o);
      pooled[bin].push(p.tempF - o);
    }

    const hourly = hourlyFromPoints([...nbsPoints, ...nbePoints], sc.hours);
    forecastRuns.push({
      runIso: run.runIso,
      availableHour: (runMs - startMs) / HOUR_MS + lagH,
      model: nbePoints.length > 0 ? 'NBS+NBE' : 'NBS',
      station: STATION,
      ...hourly,
      label: 'sourced',
      source:
        `IEM MOS archive, PANC, NBS run ${run.runIso.slice(0, 13)}Z (data/${nbsFile})` +
        (nbePoints.length > 0 ? `, with NBE beyond its range (data/${nbeFile})` : '') +
        '. Hourly values: the run\'s hourly temperatures (3-hourly tmp, 12-hourly beyond NBS), interpolated linearly; spread from tsd.',
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
    'Each archived NBS run\'s 3-hourly temperature forecasts minus the routine hourly observation at PANC for the same hour. ' +
    `Lead = hours from run time to the forecast time; binned to ${LEADS_H.join(', ')} h with upper edges ${LEAD_BIN_EDGES_H.join(', ')} h.`,
  scope: 'Only the runs saved for each replay scenario (the days around the scenario, not the whole winter). Small samples.',
  source: 'IEM MOS archive (data/raw/iem_mos_nbs_*.json) and IEM ASOS archive (data/raw/asos_panc_*.csv)',
  scenarios: errorByScenario,
  pooled: pooledByLead,
});

// forecast_rmse_f in constants.json: the pooled RMSE by lead, used where a run carries no spread.
// A lead with no samples takes the next longer lead's value.
const rmse = pooledByLead.map((p, i) => p.rmseF ?? pooledByLead.slice(i).find((q) => q.rmseF !== null)?.rmseF ?? null);
if (rmse.some((v) => v === null)) throw new Error('forecast_error: no samples at the longest lead');
const borrowed = pooledByLead.filter((p) => p.rmseF === null).map((p) => p.leadH);
const entry = {
  value: rmse, unit: `°F at leads ${LEADS_H.join(', ')} h`, label: 'derived',
  source: 'data/forecast_error.json pooled RMSE of NBS 3-hourly temperature forecasts against hourly observations, both replay scenarios; small samples' +
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
