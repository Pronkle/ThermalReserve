// Fits daily Southcentral (Enstar) system demand D = a + b × HDD with ENGINE's
// fitSystemDemand, from two sourced anchors, and writes data/system_fit.json. OFFLINE.
//
// Anchors (data/constants.json): January 2024 total = jan2024_total_bcf, with ACIS daily
// HDDs for that month; record day = record_day_mmcf.
// ASSUMPTION (AGENTS.md §13 D2): the record day is the highest-HDD day between
// Jan 30 and Feb 2, 2024. ADN reported the record "around midnight on Wednesday" (Jan 31);
// the cross-check against annual_bcf below is why the brief's rule is kept.

import { fitSystemDemand } from '@thermal-reserve/model';
import { readJson, writeJson, round, sum, type AcisDailyRow, type AcisRaw } from './lib.ts';

const RAW = 'raw/acis_panc_2024-01_2024-02.json';
const RECORD_WINDOW = ['2024-01-30', '2024-02-02'] as const;

const raw = readJson<AcisRaw<AcisDailyRow>>(RAW);
const constants = readJson<Record<string, { value: number }>>('constants.json');
const c = (k: string): number => constants[k].value;

const jan = raw.data.filter((r) => r[0].startsWith('2024-01'));
if (jan.length !== 31) throw new Error(`expected 31 January days, got ${jan.length}`);
const janHdd = jan.map((r) => Number(r[4]));
const windowDays = raw.data.filter((r) => r[0] >= RECORD_WINDOW[0] && r[0] <= RECORD_WINDOW[1]);
const recordRow = windowDays.reduce((best, r) => (Number(r[4]) > Number(best[4]) ? r : best));
const recordHdd = Number(recordRow[4]);

const { a, b } = fitSystemDemand(janHdd, c('jan2024_total_bcf'), recordHdd, c('record_day_mmcf'));

// Checks: both anchors reproduced; implied annual demand vs the sourced annual figure.
const janFitBcf = sum(janHdd.map((h) => a + b * h)) / 1000;
const recordFit = a + b * recordHdd;
const annualFitBcf = (365 * a + b * c('hdd_annual')) / 1000;

writeJson('system_fit.json', {
  a: round(a, 4),
  b: round(b, 5),
  unit: 'MMcf/day = a + b × HDD (base 65°F)',
  label: 'derived',
  method:
    'fitSystemDemand (packages/model/src/demand.ts): solves 31·a + b·ΣHDD_Jan = jan2024_total_bcf × 1,000 and a + b·HDD_record = record_day_mmcf.',
  inputs: {
    station: raw.meta.name,
    rawFile: `data/${RAW}`,
    janDailyHdd: janHdd,
    janHddSum: sum(janHdd),
    jan2024TotalBcf: c('jan2024_total_bcf'),
    recordDayMMcf: c('record_day_mmcf'),
    recordDay: recordRow[0],
    recordDayHdd: recordHdd,
  },
  assumptions: [
    `Record day = highest-HDD day ${RECORD_WINDOW[0]} to ${RECORD_WINDOW[1]} (AGENTS.md §13 D2): ${recordRow[0]}, HDD ${recordHdd}. ADN reported the 268 MMcf record around midnight on Wed Jan 31, 2024 (HDD ${raw.data.find((r) => r[0] === '2024-01-31')?.[4]}); using Jan 31 instead would imply about double the sourced annual demand.`,
    'Demand depends only on daily HDD; the 24-hour shape (demand_shape.json) is assumed and illustrative.',
  ],
  checks: {
    janFitBcf: round(janFitBcf, 4),
    recordDayFitMMcf: round(recordFit, 4),
    annualFitBcf: round(annualFitBcf, 2),
    annualSourcedBcf: c('annual_bcf'),
    annualNote: 'Implied annual = 365·a + b·hdd_annual; compare with annual_bcf (Enstar 2020 forecast).',
  },
});
console.log(`system fit: a ${round(a, 2)}, b ${round(b, 3)} (record ${recordRow[0]}, HDD ${recordHdd}); implied annual ${round(annualFitBcf, 1)} Bcf vs ${c('annual_bcf')}`);
