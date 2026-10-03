import { expect, it, vi } from 'vitest';
import { inWater } from '@thermal-reserve/model';
import { dispatchPlan, loadPreset } from './operator';
import { buildOpsData, constants, defaultConfig, scenarios, waterMask } from './ops';

it('loads the exact water-masked preview homes into four server chunks', async () => {
  const reducers = { loadScenario: vi.fn(async () => {}), loadHomes: vi.fn(async (_args: { chunkJson: string }) => {}), setParams: vi.fn(async (_args: { configJson: string }) => {}) };
  const sc = scenarios.find(item => item.id === 'feb2024')!;
  const cfg = defaultConfig(sc);
  await loadPreset(reducers, sc, cfg);
  const homes = reducers.loadHomes.mock.calls.flatMap(([args]) => JSON.parse(args.chunkJson) as { lat: number; lon: number }[]);
  expect(reducers.loadHomes).toHaveBeenCalledTimes(4);
  expect(homes).toEqual(buildOpsData(sc, cfg).homes);
  expect(homes.every(home => !inWater(home.lat, home.lon, waterMask))).toBe(true);
  expect(JSON.parse(reducers.setParams.mock.calls[0][0].configJson).hhvBtuPerCf).toBe(constants.hhvBtuPerCf);
});
it('sends normal-temperature sentinels as JSON null for set_plan', async () => {
  const reducers = { setPlan: vi.fn(async (_args: { planId: string; strategy: string; targetsJson: string }) => {}) };
  await dispatchPlan(reducers, { id: 'test-optimized', strategy: 'OPTIMIZED', targetsF: [[NaN, 62, NaN]] });
  expect(reducers.setPlan).toHaveBeenCalledWith({ planId: 'test-optimized', strategy: 'OPTIMIZED', targetsJson: '[[null,62,null]]' });
});
