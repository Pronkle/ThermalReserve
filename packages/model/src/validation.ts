import type { CohortParams, ModelConstants } from './types';

// E0 STUB: shaped placeholder results, always pass: false. E4 implements the real
// ConEd-like and SoCal-like event-day simulations. Signatures are final.

type HourlyCf = { hour: number; baselineCf: number; eventCf: number }[];

function placeholderHourly(): HourlyCf {
  return Array.from({ length: 24 }, (_, hour) => {
    const baselineCf = 2;
    const inEvent = hour >= 6 && hour < 10;
    const recovery = hour >= 10 && hour < 12;
    return { hour, baselineCf, eventCf: inEvent ? 1.6 : recovery ? 2.6 : baselineCf };
  });
}

export function validateConEdLike(cohorts: CohortParams[], consts: ModelConstants): { retention: number; band: [number, number]; pass: boolean; hourly: HourlyCf } {
  void cohorts;
  return { retention: 0, band: consts.conedBand, pass: false, hourly: placeholderHourly() };
}

export function validateSoCalLike(cohorts: CohortParams[], consts: ModelConstants): { responseRate: number; eventPct: number; dailyPct: number; band: [number, number]; pass: boolean; hourly: HourlyCf } {
  void cohorts;
  return { responseRate: 0, eventPct: 0, dailyPct: 0, band: consts.socalDailyBand, pass: false, hourly: placeholderHourly() };
}

export function anchorageSanity(cohorts: CohortParams[], consts: ModelConstants): { mcfPerHomeDay: number } {
  void cohorts; void consts;
  return { mcfPerHomeDay: 0 };
}
