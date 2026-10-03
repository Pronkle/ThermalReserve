import type { RunResult, Scenario } from './types';

/**
 * Fits daily system demand D = a + b × HDD (MMcf/day) from two anchors:
 * the month's daily HDDs sum to monthTotalBcf, and recordDayHdd gives recordDayMMcf.
 */
export function fitSystemDemand(dailyHdd: number[], monthTotalBcf: number, recordDayHdd: number, recordDayMMcf: number): { a: number; b: number } {
  const n = dailyHdd.length;
  const sumHdd = dailyHdd.reduce((s, x) => s + x, 0);
  const monthMMcf = monthTotalBcf * 1000;
  // n·a + b·ΣHDD = monthMMcf ;  a + b·recordHdd = recordMMcf
  const det = sumHdd - n * recordDayHdd;
  if (n === 0 || Math.abs(det) < 1e-12) throw new Error('fitSystemDemand: anchors are degenerate');
  const b = (monthMMcf - n * recordDayMMcf) / det;
  const a = recordDayMMcf - b * recordDayHdd;
  return { a, b };
}

/** Hourly system demand (MMcf/hour): each day's a + b × HDD spread over the 24-hour shape. */
export function hourlySystemMMcfh(dailyHdd: number[], fit: { a: number; b: number }, shape: number[]): number[] {
  if (shape.length !== 24) throw new Error('hourlySystemMMcfh: shape must have 24 entries');
  const shapeSum = shape.reduce((s, x) => s + x, 0);
  const out: number[] = [];
  for (const hdd of dailyHdd) {
    const daily = fit.a + fit.b * hdd;
    for (const f of shape) out.push((daily * f) / shapeSum);
  }
  return out;
}

/** Demand from homes not in the enrolled (non-exempt) fleet: system minus BASELINE fleet gas, per hour. */
export function nonEnrolledMMcfh(sc: Scenario, baselineFleet: RunResult): number[] {
  return sc.systemMMcfh.map((sys, h) => sys - (baselineFleet.hours[h]?.baselineFleetGasMMcfh ?? 0));
}
