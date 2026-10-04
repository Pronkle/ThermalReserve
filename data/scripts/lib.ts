// Shared helpers for data/ build scripts. Offline only.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..');

export const readJson = <T>(rel: string): T => JSON.parse(readFileSync(join(dataDir, rel), 'utf8')) as T;

export function writeJson(rel: string, value: unknown): void {
  const out = join(dataDir, rel);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(value, null, 2) + '\n');
}

export const round = (x: number, d: number): number => Math.round(x * 10 ** d) / 10 ** d;
export const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

/** ACIS StnData daily row as saved in data/raw/: [date, maxt, mint, avgt, hdd]. */
export type AcisDailyRow = [string, string, string, string, string];
export interface AcisRaw<R> { meta: { name: string }; data: R[] }

/** Assumed daily temperature shape: minimum at 07:00, maximum at 15:00 local (master plan §12). */
export const T_MIN_CLOCK = 7;
export const T_MAX_CLOCK = 15;

/**
 * Hourly temperatures from daily max/min by cosine interpolation between knots
 * (07:00 = that day's min, 15:00 = that day's max). `days` must include one day before
 * and one day after the hours wanted; returns 24 × (days.length − 2) values starting at
 * 00:00 of days[1].
 */
export function hourlyFromDailyMaxMin(days: { maxF: number; minF: number }[]): number[] {
  const knots: { h: number; t: number }[] = [];
  days.forEach((d, k) => {
    knots.push({ h: 24 * k + T_MIN_CLOCK, t: d.minF });
    knots.push({ h: 24 * k + T_MAX_CLOCK, t: d.maxF });
  });
  const out: number[] = [];
  for (let h = 24; h < 24 * (days.length - 1); h++) {
    const i = knots.findIndex((k, j) => j + 1 < knots.length && k.h <= h && knots[j + 1].h > h);
    const a = knots[i];
    const b = knots[i + 1];
    const f = (1 - Math.cos((Math.PI * (h - a.h)) / (b.h - a.h))) / 2;
    out.push(a.t + (b.t - a.t) * f);
  }
  return out;
}

/** Heating degree-days (base 65°F) of one day from its hourly temperatures. */
export const hddFromHourly = (hours: number[]): number => Math.max(0, 65 - sum(hours) / hours.length);

/** Capacity line: a labeled hypothetical, 3 MMcf/day below the scenario's peak gas day. */
export function capacityFor(systemMMcfh: number[]): { capacityMMcfd: number; peakDayMMcf: number } {
  let peakDayMMcf = 0;
  for (let d = 0; d < systemMMcfh.length / 24; d++) peakDayMMcf = Math.max(peakDayMMcf, sum(systemMMcfh.slice(24 * d, 24 * d + 24)));
  return { capacityMMcfd: round(peakDayMMcf - 3, 1), peakDayMMcf };
}

export const CAPACITY_NOTE =
  "Hypothetical: capacity set 3 MMcf/day below this scenario's peak-day demand. " +
  'Daily limit per gas day; within-day swings are covered by linepack and storage (assumed).';

/**
 * Routine hourly observations saved by scripts/fetch-asos.ts (CSV: station,valid,tmpf; valid in
 * UTC at :53). Hour index h of a scenario takes the report issued 7 minutes before it starts.
 * Returns hour index → °F for every report in the file (indexes may be negative or beyond the scenario).
 */
export function readHourlyObs(rel: string, startIso: string): Map<number, number> {
  const startMs = Date.parse(startIso);
  const out = new Map<number, number>();
  const lines = readFileSync(join(dataDir, rel), 'utf8').trim().split('\n');
  if (lines[0] !== 'station,valid,tmpf') throw new Error(`${rel}: unexpected header`);
  for (const line of lines.slice(1)) {
    const [station, valid, tmpf] = line.split(',');
    if (station !== 'PANC') throw new Error(`${rel}: unexpected station ${station}`);
    if (tmpf === 'M') continue;
    out.set(Math.round((Date.parse(`${valid.replace(' ', 'T')}Z`) - startMs) / 3_600_000), Number(tmpf));
  }
  return out;
}
