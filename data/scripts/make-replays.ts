// Builds the replay scenarios data/scenarios/feb2024.json and lastwinter.json from ACIS
// daily data for Anchorage International (data/raw/). OFFLINE.
//
// Construction (master plan §12): the coldest 72-hour stretch in a date range, plus 12 hours
// before and after (96 hours). Scenarios start at 00:00 local so gas days are calendar days;
// the 72-hour event runs from 12:00 on the first day to 12:00 on the fourth, and the start day
// is chosen to minimize the mean hourly temperature over those 72 hours.
// Hourly temperatures: routine hourly observations at PANC (IEM ASOS archive, data/raw/asos_*.csv).
// The window is still chosen with the assumed cosine curve through ACIS daily max/min, so the
// scenario dates do not move; only the hourly values inside the window are the observations.
// systemMMcfh: ACIS daily HDD of each calendar day through system_fit.json and the 24-hour
// demand shape, via ENGINE's hourlySystemMMcfh.

import { hourlySystemMMcfh } from '@thermal-reserve/model';
import { readJson, writeJson, round, sum, hourlyFromDailyMaxMin, readHourlyObs, capacityFor, CAPACITY_NOTE, type AcisDailyRow, type AcisRaw } from './lib.ts';

const HOURS = 96;
const EVENT_START = 12;
const EVENT_END = 84;

interface ReplaySpec { id: string; name: string; raw: string; obs: string; from: string; to: string; }

const specs: ReplaySpec[] = [
  { id: 'feb2024', name: 'Feb 2024 cold snap (replay)', raw: 'raw/acis_panc_2024-01_2024-02.json', obs: 'raw/asos_panc_feb2024.csv', from: '2024-01-25', to: '2024-02-10' },
  { id: 'lastwinter', name: "Last winter's coldest stretch (replay)", raw: 'raw/acis_panc_2025-11_2026-03.json', obs: 'raw/asos_panc_lastwinter.csv', from: '2025-11-01', to: '2026-03-31' },
];

const fit = readJson<{ a: number; b: number }>('system_fit.json');
const shape = readJson<number[]>('demand_shape.json');

for (const spec of specs) {
  const raw = readJson<AcisRaw<AcisDailyRow>>(spec.raw);
  const rows = raw.data;
  const days = rows.map((r) => ({ date: r[0], maxF: Number(r[1]), minF: Number(r[2]), hdd: Number(r[4]) }));
  for (const d of days) if (![d.maxF, d.minF, d.hdd].every(Number.isFinite)) throw new Error(`${spec.id}: missing value on ${d.date}`);

  // Candidate start day s: the 4 scenario days s..s+3 lie within [from, to], with one
  // neighbor day on each side available for interpolation.
  let best: { s: number; meanF: number; hourly: number[] } | null = null;
  for (let s = 1; s + 4 < days.length; s++) {
    if (days[s].date < spec.from || days[s + 3].date > spec.to) continue;
    const hourly = hourlyFromDailyMaxMin(days.slice(s - 1, s + 5));
    const meanF = sum(hourly.slice(EVENT_START, EVENT_END)) / (EVENT_END - EVENT_START);
    if (!best || meanF < best.meanF) best = { s, meanF, hourly };
  }
  if (!best) throw new Error(`${spec.id}: no candidate window`);

  const scDays = days.slice(best.s, best.s + 4);
  const dailyHdd = scDays.map((d) => d.hdd);
  const systemMMcfh = hourlySystemMMcfh(dailyHdd, fit, shape).map((x) => round(x, 4));
  const { capacityMMcfd } = capacityFor(systemMMcfh);

  const startIso = `${scDays[0].date}T00:00:00-09:00`;
  const obs = readHourlyObs(spec.obs, startIso);
  const outdoorF = Array.from({ length: HOURS }, (_, h) => {
    const v = obs.get(h);
    if (v === undefined) throw new Error(`${spec.id}: no observation for hour ${h} (${spec.obs})`);
    return round(v, 1);
  });

  writeJson(`scenarios/${spec.id}.json`, {
    id: spec.id,
    name: spec.name,
    kind: 'replay',
    startIso,
    hours: HOURS,
    outdoorF,
    eventStartHour: EVENT_START,
    eventEndHour: EVENT_END,
    systemMMcfh,
    capacityMMcfd,
    capacityNote: CAPACITY_NOTE,
    source:
      `Hourly temperatures: routine hourly observations at ${raw.meta.name} (PANC), IEM ASOS archive (data/${spec.obs}), ${scDays[0].date} to ${scDays[3].date}. ` +
      `Window: coldest 72 h (12:00 day 1 to 12:00 day 4) between ${spec.from} and ${spec.to}, chosen from ACIS StnData daily max/min (data/${spec.raw}). ` +
      `systemMMcfh = (a + b × ACIS daily HDD) × demand_shape, from data/system_fit.json; daily HDD ${dailyHdd.join(', ')}.`,
  });
  console.log(`${spec.id}: ${scDays[0].date}..${scDays[3].date}, observed event mean ${round(sum(outdoorF.slice(EVENT_START, EVENT_END)) / (EVENT_END - EVENT_START), 1)}°F (curve ${round(best.meanF, 1)}°F), capacity ${capacityMMcfd} MMcf/day`);
}
