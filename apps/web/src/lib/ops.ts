import { buildCohorts, compareStrategies, homesPerDot, loadConstants, sampleHomes, type WaterMask, type CohortSpec, type ConstantsJson, type FleetConfig, type RunResult, type Scenario, type SampleHome } from '@thermal-reserve/model';
import raw from '../../../../data/constants.json';
import spec from '../../../../data/cohort_spec.json';
import mask from '../../../../data/water_mask.json';
import anchors from '../../../../data/anchors.json';

export const constants = loadConstants(raw as ConstantsJson);
export const cohorts = buildCohorts(spec as CohortSpec, constants.uaMeanBtuHPerF);
export const scenarios = Object.values(import.meta.glob<Scenario>('../../../../data/scenarios/*.json', { eager: true, import: 'default' }));
export type PreviewStrategy = 'BASELINE' | 'NAIVE_4H' | 'SUSTAIN_STAGGER';
export const DOT_COUNT = 1000;
export const waterMask = mask as WaterMask;
export { anchors };
export function defaultConfig(sc: Scenario): FleetConfig {
  return { enrolledHomes: 25000, exemptShare: constants.exemptShare, floorF: constants.floorDefaultF, maxDepthF: constants.maxDepthDefaultF, overrideRate: constants.overrideRate, capacityMMcfd: sc.capacityMMcfd, seed: 42 };
}
export function buildOpsData(sc: Scenario, cfg: FleetConfig) {
  const runs = compareStrategies(sc, cohorts, cfg, constants);
  const homes = sampleHomes(cohorts, anchors, DOT_COUNT, cfg, sc, waterMask);
  const chart = runs.BASELINE.hours.map((row, h) => ({
    hour: h, baseline: row.fleetGasMMcfh,
    naive: runs.NAIVE_4H.hours[h].fleetGasMMcfh,
    sustain: runs.SUSTAIN_STAGGER.hours[h].fleetGasMMcfh,
  }));
  return { runs, homes, chart, homesPerDot: homesPerDot(cfg, DOT_COUNT) };
}
export function dailyShortfall(run: RunResult, capacityMMcfd: number) {
  const days: number[] = [];
  for (const row of run.hours) { const day = Math.floor(row.hour / 24); days[day] = (days[day] ?? 0) + row.systemMMcfh; }
  return Math.max(0, ...days.map(total => total - capacityMMcfd));
}
export function homeMode(home: SampleHome, run: RunResult, hour: number) {
  if (home.exempt) return 'exempt';
  if (run.strategy !== 'BASELINE' && home.overrideHour !== null && home.overrideHour <= hour) return 'overridden';
  return run.hours[hour]?.cohorts[home.cohortId]?.mode ?? 'normal';
}
export function clockLabel(sc: Scenario, hour: number) {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'America/Anchorage', weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(Date.parse(sc.startIso) + hour * 3600000));
}
export const decimal = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const temperature = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const integer = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
