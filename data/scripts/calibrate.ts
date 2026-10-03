// Computes Anchorage's mean annual heating degree-days (base 65°F, 1996–2025) from the saved
// ACIS raw file, derives the mean UA, writes data/calibration.json, and updates `hdd_annual`
// and `ua_mean_btuh_per_f` in data/constants.json. OFFLINE: reads data/raw/ only.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const RAW_FILE = 'raw/acis_panc_1996_2025.json';
const FIRST_YEAR = 1996;
const LAST_YEAR = 2025;
const MAX_MISSING_DAYS_PER_YEAR = 10;

interface AcisRaw { meta: { name: string; ll: [number, number] }; data: [string, string, string][]; retrievedIso: string }
interface Entry { value: number | number[]; unit: string; label: string; source: string }

const raw = JSON.parse(readFileSync(join(dataDir, RAW_FILE), 'utf8')) as AcisRaw;
const constantsPath = join(dataDir, 'constants.json');
const constantsText = readFileSync(constantsPath, 'utf8');
const constants = JSON.parse(constantsText) as Record<string, Entry>;
const num = (k: string): number => constants[k].value as number;

// ACIS daily rows are [date, avgt, hdd]; hdd is ACIS's base-65°F value. "M" = missing.
const years: { year: number; hdd: number; days: number; missing: number; hddFilled: number }[] = [];
for (let y = FIRST_YEAR; y <= LAST_YEAR; y++) {
  const rows = raw.data.filter((r) => r[0].startsWith(`${y}-`));
  const valid = rows.map((r) => Number(r[2])).filter((v) => Number.isFinite(v));
  const daysInYear = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 366 : 365;
  const missing = daysInYear - valid.length;
  if (missing > MAX_MISSING_DAYS_PER_YEAR) throw new Error(`${y}: ${missing} missing days`);
  const hdd = valid.reduce((a, b) => a + b, 0);
  // Fill missing days with the year's mean daily HDD (only 1 day in 2003 as retrieved).
  years.push({ year: y, hdd, days: valid.length, missing, hddFilled: (hdd * daysInYear) / valid.length });
}
const hddAnnual = years.reduce((a, y) => a + y.hddFilled, 0) / years.length;

const inputs = {
  space_heat_share: num('space_heat_share'),
  avg_home_mcf_year: num('avg_home_mcf_year'),
  hhv_btu_per_cf: num('hhv_btu_per_cf'),
  eta_furnace: num('eta_furnace'),
};
const deliveredBtuYear = inputs.space_heat_share * inputs.avg_home_mcf_year * 1000 * inputs.hhv_btu_per_cf * inputs.eta_furnace;
const ua = deliveredBtuYear / (24 * hddAnnual);

const round = (x: number, d: number): number => Math.round(x * 10 ** d) / 10 ** d;
const calibration = {
  label: 'derived',
  station: { name: raw.meta.name, lonLat: raw.meta.ll, sid: 'PANC', rawFile: `data/${RAW_FILE}`, retrievedIso: raw.retrievedIso },
  hdd: {
    base: 65,
    years: `${FIRST_YEAR}–${LAST_YEAR}`,
    annualMean: round(hddAnnual, 1),
    method: 'Sum of ACIS daily HDD (base 65°F) per calendar year; missing days filled with that year\'s mean daily HDD; mean over years.',
    perYear: years.map((y) => ({ year: y.year, hdd: y.hdd, missingDays: y.missing, hddFilled: round(y.hddFilled, 1) })),
  },
  ua: {
    valueBtuHPerF: round(ua, 1),
    formula: 'UA = space_heat_share × avg_home_mcf_year × 1,000 × hhv_btu_per_cf × eta_furnace ÷ (24 × hdd_annual)',
    inputs: { ...inputs, hdd_annual: round(hddAnnual, 1) },
    deliveredBtuPerYear: Math.round(deliveredBtuYear),
    vsPlanAssumption: { assumedHdd: 10000, assumedUa: 407, changePct: round(((ua - 407) / 407) * 100, 2) },
  },
};
writeFileSync(join(dataDir, 'calibration.json'), JSON.stringify(calibration, null, 2) + '\n');

// Rewrite just the two entries' lines so the hand-formatted constants.json keeps its layout.
const hddEntry: Entry = {
  value: round(hddAnnual, 1), unit: '°F·day/year (base 65°F)', label: 'derived',
  source: `Mean annual HDD ${FIRST_YEAR}–${LAST_YEAR}, ${raw.meta.name} (PANC), ACIS StnData; see data/calibration.json`,
};
const uaEntry: Entry = {
  value: round(ua, 1), unit: 'BTU/(h·°F)', label: 'derived',
  source: `space_heat_share × avg_home_mcf_year × 1,000 × hhv_btu_per_cf × eta_furnace ÷ (24 × hdd_annual) = 0.75 × 149,000 × 1,030 × 0.85 ÷ (24 × ${round(hddAnnual, 1)}); see data/calibration.json`,
};
const replaceLine = (text: string, key: string, entry: Entry): string => {
  const re = new RegExp(`^(\\s*)"${key}": \\{.*\\}(,?)$`, 'm');
  if (!re.test(text)) throw new Error(`constants.json: no single-line entry for ${key}`);
  return text.replace(re, (_m, indent: string, comma: string) => `${indent}"${key}": ${JSON.stringify(entry).replace(/,"/g, ', "').replace(/":/g, '": ')}${comma}`);
};
let next = replaceLine(constantsText, 'hdd_annual', hddEntry);
next = replaceLine(next, 'ua_mean_btuh_per_f', uaEntry);
JSON.parse(next); // must still be valid JSON
writeFileSync(constantsPath, next);

console.log(`calibration: ${raw.meta.name}, HDD ${round(hddAnnual, 1)}, UA ${round(ua, 1)} BTU/(h·°F) (${calibration.ua.vsPlanAssumption.changePct}% vs 407)`);
