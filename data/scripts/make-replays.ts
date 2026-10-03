// Builds the replay scenarios data/scenarios/feb2024.json and lastwinter.json from ACIS
// daily data for Anchorage International (data/raw/). OFFLINE.
//
// Construction (master plan §12): the coldest 72-hour stretch in a date range, plus 12 hours
// before and after (96 hours). Scenarios start at 00:00 local so gas days are calendar days;
// the 72-hour event runs from 12:00 on the first day to 12:00 on the fourth, and the start day
// is chosen to minimize the mean hourly temperature over those 72 hours.
// Hourly temperatures: cosine interpolation of daily max/min, min 07:00, max 15:00 (assumed).
// systemMMcfh: ACIS daily HDD of each calendar day through system_fit.json and the 24-hour
// demand shape, via ENGINE's hourlySystemMMcfh.

import { hourlySystemMMcfh } from '@thermal-reserve/model';
import { readJson, writeJson, round, sum, hourlyFromDailyMaxMin, capacityFor, CAPACITY_NOTE, type AcisDailyRow, type AcisRaw } from './lib.ts';

const HOURS = 96;
const EVENT_START = 12;
const EVENT_END = 84;

interface ReplaySpec { id: string; name: string; raw: string; from: string; to: string; }

const specs: ReplaySpec[] = [
  { id: 'feb2024', name: 'Feb 2024 cold snap (replay)', raw: 'raw/acis_panc_2024-01_2024-02.json', from: '2024-01-25', to: '2024-02-10' },
  { id: 'lastwinter', name: "Last winter's coldest stretch (replay)", raw: 'raw/acis_panc_2025-11_2026-03.json', from: '2025-11-01', to: '2026-03-31' },
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

  writeJson(`scenarios/${spec.id}.json`, {
    id: spec.id,
    name: spec.name,
    kind: 'replay',
    startIso: `${scDays[0].date}T00:00:00-09:00`,
    hours: HOURS,
    outdoorF: best.hourly.map((t) => round(t, 2)),
    eventStartHour: EVENT_START,
    eventEndHour: EVENT_END,
    systemMMcfh,
    capacityMMcfd,
    capacityNote: CAPACITY_NOTE,
    source:
      `ACIS StnData daily max/min and HDD, ${raw.meta.name} (PANC), ${scDays[0].date} to ${scDays[3].date} (data/${spec.raw}); ` +
      `coldest 72 h (12:00 day 1 to 12:00 day 4) between ${spec.from} and ${spec.to}. Hourly temperatures by assumed cosine interpolation (min 07:00, max 15:00). ` +
      `systemMMcfh = (a + b × daily HDD) × demand_shape, from data/system_fit.json; daily HDD ${dailyHdd.join(', ')}.`,
  });
  console.log(`${spec.id}: ${scDays[0].date}..${scDays[3].date}, event mean ${round(best.meanF, 1)}°F, capacity ${capacityMMcfd} MMcf/day`);
}
