import { expect, it } from 'vitest';
import type { ReplanSegment } from '@thermal-reserve/model';
import { boundarySpeed, forecastChartRows, replanMessage, segmentSchedules } from './replan-ui';
import { scenarios } from './ops';
const sc = scenarios[0];
function segment(fromHour: number, value: number): ReplanSegment {
  return { fromHour, reason: fromHour ? 'drift-temp' : 'start', runIso: sc.startIso, driftF: -2, solveMs: 10, deepenedF: 0.8,
    plan: { id: 'raw', strategy: 'OPTIMIZED', targetsF: [Array(sc.hours).fill(value)] },
    forecastF: Array(sc.hours).fill(value), sigmaF: Array(sc.hours).fill(2), planningOutdoorF: Array(sc.hours).fill(value - 2), expectedIdx: Array(sc.hours).fill(90) };
}
it('uploads the previous past and the new future at every re-plan boundary', () => {
  const schedules = segmentSchedules(sc, 'inputs', [segment(0, 65), segment(6, 64), segment(12, 63)]);
  expect(schedules[2].plan.targetsF[0].slice(0, 13)).toEqual([...Array(6).fill(65), ...Array(6).fill(64), 63]);
  expect(new Set(schedules.map(item => item.plan.id)).size).toBe(3);
  expect(schedules[1].plan.id).toContain('-rp6-');
});
it('changes forecast, spread and expected pressure at the segment boundary', () => {
  const rows = forecastChartRows(sc, [segment(0, 10), segment(6, 5)]);
  expect(rows[5].forecast).toBe(10);
  expect(rows[6]).toMatchObject({ forecast: 5, band: [3, 7], planning: 3, expected: 90 });
  expect(forecastChartRows(sc, [])[0].forecast).toBeUndefined();
  expect(replanMessage(sc, segment(6, 5))).toContain('temperature drift: running 2.0°F cold');
});

it('shortens a simulation batch before odd-hour boundaries and restores desired speed afterward', () => {
  expect(boundarySpeed(2, 4, 5)).toBe(1);
  expect(boundarySpeed(4, 4, 5)).toBe(1);
  expect(boundarySpeed(2, 11, 16)).toBe(2);
  expect(boundarySpeed(2, 15, 16)).toBe(1);
  expect(boundarySpeed(0.5, 4.5, 5)).toBe(0.5);
});
