import type { Plan, ReplanSegment, Scenario } from '@thermal-reserve/model';
import { clockLabel, temperature } from './ops';
import { pressurePlanId } from './pressure-ui';
/** Each upload preserves all prior targets; a segment's future replaces only its own future. */
export function segmentSchedules(sc: Scenario, key: string, segments: ReplanSegment[]): { segment: ReplanSegment; plan: Plan }[] {
  let previous: Plan | undefined;
  return segments.map(segment => {
    const plan: Plan = { ...segment.plan, id: pressurePlanId(sc.id, segment.plan.strategy, segment.fromHour, key), targetsF: segment.plan.targetsF.map((row, c) => row.map((target, hour) => hour < segment.fromHour ? previous?.targetsF[c]?.[hour] ?? NaN : target)) };
    previous = plan;
    return { segment, plan };
  });
}
export function forecastChartRows(sc: Scenario, segments: ReplanSegment[]) {
  return sc.outdoorF.map((actual, hour) => {
    const segment = [...segments].reverse().find(item => item.fromHour <= hour);
    const forecast = segment?.runIso ? segment.forecastF[hour] : undefined;
    const sigma = segment?.sigmaF[hour] ?? 0;
    return { hour, actual, forecast, band: forecast === undefined ? undefined : [forecast - sigma, forecast + sigma], planning: segment?.runIso ? segment.planningOutdoorF[hour] : undefined, expected: segment?.expectedIdx[hour] };
  });
}
export function replanMessage(sc: Scenario, segment: ReplanSegment) {
  const reason = segment.reason === 'forecast' ? 'new forecast' : segment.reason === 'fixed' ? 'scheduled update' : segment.reason === 'drift-temp' ? 'temperature drift' : 'pressure drift';
  const drift = segment.driftF ? `: running ${temperature.format(Math.abs(segment.driftF))}°F ${segment.driftF < 0 ? 'cold' : 'warm'}` : '';
  // What changed, in homes and hours (H2): the upcoming hour where the share of enrolled homes turning down moved most.
  const td = segment.turnDown;
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const change = !td ? 'no change to the plan'
    : td.after > td.before ? `${pct(td.after)} of homes will turn down ${clockLabel(sc, td.hour)} (was ${pct(td.before)})`
    : `fewer homes need to turn down ${clockLabel(sc, td.hour)} (${pct(td.before)} → ${pct(td.after)})`;
  return `Re-plan ${clockLabel(sc, segment.fromHour)} · ${reason}${drift} → ${change}`;
}

/** Keep one server tick from crossing the next precomputed segment boundary. */
export function boundarySpeed(speed: number, hour: number, boundary: number) {
  return Math.min(speed, Math.max(0.5, boundary - hour));
}
