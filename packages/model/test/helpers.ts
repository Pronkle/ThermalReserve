import { buildCohorts, loadConstants } from '../src/index';
import type { CohortSpec, ConstantsJson, FleetConfig, Scenario } from '../src/index';
import constantsJson from './fixtures/constants.json';
import cohortSpecJson from './fixtures/cohort_spec.json';

export const consts = loadConstants(constantsJson as unknown as ConstantsJson);
export const spec = cohortSpecJson as unknown as CohortSpec;
export const cohorts = buildCohorts(spec, consts.uaMeanBtuHPerF);

const SHAPE = [0.038, 0.037, 0.037, 0.035, 0.036, 0.040, 0.052, 0.054, 0.050, 0.044, 0.041, 0.039,
  0.038, 0.037, 0.037, 0.038, 0.041, 0.047, 0.049, 0.048, 0.044, 0.042, 0.039, 0.037];

/** Synthetic design-like scenario (fixture only): 12 h at 10°F, 72 h at −20°F, 12 h at 0°F. */
export function designScenario(): Scenario {
  const outdoorF = Array.from({ length: 96 }, (_, h) => (h < 12 ? 10 : h < 84 ? -20 : 0));
  const systemMMcfh = outdoorF.map((_, h) => 265 * SHAPE[h % 24]);
  return {
    id: 'design-fixture', name: 'Design fixture', kind: 'synthetic',
    startIso: '2026-01-14T00:00:00-09:00', hours: 96, outdoorF, systemMMcfh,
    eventStartHour: 12, eventEndHour: 84, capacityMMcfd: 262,
    capacityNote: 'fixture', source: 'test fixture',
  };
}

export const cfg: FleetConfig = {
  enrolledHomes: 25000, exemptShare: 0.08, floorF: 62, maxDepthF: 5,
  overrideRate: 0.06, capacityMMcfd: 262, seed: 42,
};
