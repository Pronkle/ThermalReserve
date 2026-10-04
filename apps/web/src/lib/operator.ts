import type { DbConnection } from '@thermal-reserve/stdb-bindings';
import { planBaseline, planNaive4h, planSustainStagger, sampleHomes, type Plan, type FleetConfig, type Scenario } from '@thermal-reserve/model';
import { cohorts, constants, DOT_COUNT, anchors, waterMask, type PreviewStrategy } from './ops';

export async function loadPreset(reducers: Pick<DbConnection['reducers'], 'loadScenario' | 'loadHomes' | 'setParams'>, scenario: Scenario, config: FleetConfig) {
  const homes = sampleHomes(cohorts, anchors, DOT_COUNT, config, scenario, waterMask);
  const parameters = { ...config, hhvBtuPerCf: constants.hhvBtuPerCf, speedHoursPerSec: 2, homesPerDot: config.enrolledHomes / DOT_COUNT };
  await reducers.loadScenario({ scenarioJson: JSON.stringify(scenario), cohortsJson: JSON.stringify(cohorts), configJson: JSON.stringify(parameters) });
  for (let offset = 0; offset < homes.length; offset += 250) await reducers.loadHomes({ chunkJson: JSON.stringify(homes.slice(offset, offset + 250)) });
  await reducers.setParams({ configJson: JSON.stringify(parameters) });
}
export async function dispatchPreview(reducers: DbConnection['reducers'], scenario: Scenario, config: FleetConfig, strategy: PreviewStrategy) {
  const plan = strategy === 'BASELINE' ? planBaseline(scenario, cohorts) : strategy === 'NAIVE_4H' ? planNaive4h(scenario, cohorts, config) : planSustainStagger(scenario, cohorts, config);
  await reducers.setPlan({ planId: plan.id, strategy: plan.strategy, targetsJson: JSON.stringify(strategy === 'BASELINE' ? [] : plan.targetsF) });
}

export async function dispatchPlan(reducers: Pick<DbConnection['reducers'], 'setPlan'>, plan: Plan) {
  await reducers.setPlan({ planId: plan.id, strategy: plan.strategy, targetsJson: JSON.stringify(plan.strategy === 'BASELINE' ? [] : plan.targetsF) });
}

export async function loadPressurePreset(reducers: Pick<DbConnection['reducers'], 'loadScenario' | 'loadHomes' | 'setParams'>, scenario: Scenario & { forecastRuns?: unknown }, config: FleetConfig) {
  const { forecastRuns: _forecasts, ...actual } = scenario;
  await loadPreset(reducers, actual, config);
}
