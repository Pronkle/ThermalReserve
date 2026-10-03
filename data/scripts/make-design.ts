// Builds data/scenarios/design.json: the synthetic "Design cold snap: −20°F for 3 days".
// Run: npx tsx data/scripts/make-design.ts   (Node ≥ 22.18 can also run it directly)
//
// Construction (master plan §12): 12 h at 10°F, 72 h averaging −20°F with a ±5°F daily
// swing, 12 h easing linearly to 5°F. Hourly shape is the assumed cosine curve with the
// minimum at 07:00 and the maximum at 15:00 local time.
//
// systemMMcfh is a PLACEHOLDER until the system fit exists (task D2): every day is the
// 268 MMcf record day spread over the 24-hour demand shape.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (p: string): unknown => JSON.parse(readFileSync(join(dataDir, p), 'utf8'));

const HOURS = 96;
const LEAD_IN_H = 12;
const COLD_H = 72;
const LEAD_IN_F = 10;
const COLD_MEAN_F = -20;
const COLD_SWING_F = 5;
const EASE_TO_F = 5;
const T_MIN_CLOCK = 7;
const T_MAX_CLOCK = 15;
const START_ISO = '2026-01-14T00:00:00-09:00'; // midnight local, so hour index mod 24 = clock hour

/** Daily cosine shape in [−1, 1]: −1 at 07:00, +1 at 15:00. Rises over 8 h, falls over 16 h. */
export function diurnalShape(clockHour: number): number {
  const h = ((clockHour % 24) + 24) % 24;
  const rise = T_MAX_CLOCK - T_MIN_CLOCK;
  if (h >= T_MIN_CLOCK && h <= T_MAX_CLOCK) return -Math.cos((Math.PI * (h - T_MIN_CLOCK)) / rise);
  const sinceMax = (h - T_MAX_CLOCK + 24) % 24;
  return Math.cos((Math.PI * sinceMax) / (24 - rise));
}

const round2 = (x: number): number => Math.round(x * 100) / 100;

const outdoorF: number[] = [];
for (let h = 0; h < HOURS; h++) {
  if (h < LEAD_IN_H) outdoorF.push(LEAD_IN_F);
  else if (h < LEAD_IN_H + COLD_H) outdoorF.push(round2(COLD_MEAN_F + COLD_SWING_F * diurnalShape(h % 24)));
  else {
    const from = outdoorF[LEAD_IN_H + COLD_H - 1];
    const k = (h - (LEAD_IN_H + COLD_H) + 1) / (HOURS - LEAD_IN_H - COLD_H);
    outdoorF.push(round2(from + (EASE_TO_F - from) * k));
  }
}

const shape = readJson('demand_shape.json') as number[];
const constants = readJson('constants.json') as Record<string, { value: number }>;
const recordDayMMcf = constants.record_day_mmcf.value;
const systemMMcfh = Array.from({ length: HOURS }, (_, h) => round2(recordDayMMcf * shape[h % 24] * 1000) / 1000);

let peakDayMMcf = 0;
for (let d = 0; d < HOURS / 24; d++) {
  const day = systemMMcfh.slice(d * 24, d * 24 + 24).reduce((a, b) => a + b, 0);
  peakDayMMcf = Math.max(peakDayMMcf, day);
}
const capacityMMcfd = Math.round(peakDayMMcf - 3);

const scenario = {
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
  capacityNote: "Hypothetical: capacity set 3 MMcf/day below this scenario's peak-day demand",
  source:
    'Synthetic; see data/scripts/make-design.ts. Hourly temperatures use an assumed cosine shape (min 07:00, max 15:00). ' +
    'systemMMcfh is a placeholder: record_day_mmcf (268) × demand_shape every day, until the system fit (task D2).',
  placeholder: true,
};

const out = join(dataDir, 'scenarios', 'design.json');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(scenario, null, 2) + '\n');
console.log(`wrote ${out}: capacity ${capacityMMcfd} MMcf/day, min ${Math.min(...outdoorF)}°F`);
