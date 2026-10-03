// Builds data/scenarios/design.json: the synthetic "Design cold snap: −20°F for 3 days". OFFLINE.
//
// Construction (master plan §12): 12 h at 10°F, 72 h averaging −20°F with a ±5°F daily
// swing, 12 h easing linearly to 5°F. Hourly shape is the assumed cosine curve with the
// minimum at 07:00 and the maximum at 15:00 local time.
// systemMMcfh: each day's HDD (from the hourly temperatures) through system_fit.json and
// the 24-hour demand shape, via ENGINE's hourlySystemMMcfh.

import { hourlySystemMMcfh } from '@thermal-reserve/model';
import { readJson, writeJson, round, hddFromHourly, capacityFor, CAPACITY_NOTE, T_MIN_CLOCK, T_MAX_CLOCK } from './lib.ts';

const HOURS = 96;
const LEAD_IN_H = 12;
const COLD_H = 72;
const LEAD_IN_F = 10;
const COLD_MEAN_F = -20;
const COLD_SWING_F = 5;
const EASE_TO_F = 5;
const START_ISO = '2026-01-14T00:00:00-09:00'; // midnight local, so hour index mod 24 = clock hour

/** Daily cosine shape in [−1, 1]: −1 at 07:00, +1 at 15:00. Rises over 8 h, falls over 16 h. */
export function diurnalShape(clockHour: number): number {
  const h = ((clockHour % 24) + 24) % 24;
  const rise = T_MAX_CLOCK - T_MIN_CLOCK;
  if (h >= T_MIN_CLOCK && h <= T_MAX_CLOCK) return -Math.cos((Math.PI * (h - T_MIN_CLOCK)) / rise);
  const sinceMax = (h - T_MAX_CLOCK + 24) % 24;
  return Math.cos((Math.PI * sinceMax) / (24 - rise));
}

const outdoorF: number[] = [];
for (let h = 0; h < HOURS; h++) {
  if (h < LEAD_IN_H) outdoorF.push(LEAD_IN_F);
  else if (h < LEAD_IN_H + COLD_H) outdoorF.push(round(COLD_MEAN_F + COLD_SWING_F * diurnalShape(h % 24), 2));
  else {
    const from = outdoorF[LEAD_IN_H + COLD_H - 1];
    const k = (h - (LEAD_IN_H + COLD_H) + 1) / (HOURS - LEAD_IN_H - COLD_H);
    outdoorF.push(round(from + (EASE_TO_F - from) * k, 2));
  }
}

const fit = readJson<{ a: number; b: number }>('system_fit.json');
const shape = readJson<number[]>('demand_shape.json');
const dailyHdd = Array.from({ length: HOURS / 24 }, (_, d) => round(hddFromHourly(outdoorF.slice(24 * d, 24 * d + 24)), 2));
const systemMMcfh = hourlySystemMMcfh(dailyHdd, fit, shape).map((x) => round(x, 4));
const { capacityMMcfd } = capacityFor(systemMMcfh);

writeJson('scenarios/design.json', {
  id: 'design',
  name: 'Design cold snap: −20°F for 3 days',
  kind: 'synthetic',
  startIso: START_ISO,
  hours: HOURS,
  outdoorF,
  eventStartHour: LEAD_IN_H,
  eventEndHour: LEAD_IN_H + COLD_H,
  systemMMcfh,
  capacityMMcfd,
  capacityNote: CAPACITY_NOTE,
  source:
    'Synthetic; see data/scripts/make-design.ts. Hourly temperatures use an assumed cosine shape (min 07:00, max 15:00). ' +
    `systemMMcfh = (a + b × daily HDD) × demand_shape, from data/system_fit.json; daily HDD ${dailyHdd.join(', ')}.`,
});
console.log(`design: capacity ${capacityMMcfd} MMcf/day, daily HDD ${dailyHdd.join(', ')}`);
