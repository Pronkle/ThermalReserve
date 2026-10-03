import {
  buildCohorts,
  loadConstants,
  planBaseline,
  runPlan,
  type CohortSpec,
  type ConstantsJson,
  type FleetConfig,
  type Scenario,
} from '@thermal-reserve/model';
import constantsJson from '../../../../data/constants.json';
import cohortSpecJson from '../../../../data/cohort_spec.json';
import scenarioJson from '../../../../data/scenarios/design.json';

// W0 deliberately renders ENGINE's stub output, never a claimed impact result.
export function buildPreview() {
  const constants = loadConstants(constantsJson as ConstantsJson);
  const scenario = scenarioJson as Scenario;
  const cohorts = buildCohorts(cohortSpecJson as CohortSpec, constantsJson.ua_mean_btuh_per_f.value);
  const config: FleetConfig = {
    enrolledHomes: 1000,
    exemptShare: constantsJson.exempt_share.value,
    floorF: constantsJson.floor_default_f.value,
    maxDepthF: constantsJson.max_depth_default_f.value,
    overrideRate: constantsJson.override_rate.value,
    capacityMMcfd: scenario.capacityMMcfd,
    seed: 42,
  };
  return runPlan(scenario, cohorts, config, planBaseline(scenario, cohorts), constants);
}
