import { expect, it } from 'vitest';
import { livePressure, pressureInputKey, pressurePlanId, type PressureInputs } from './pressure-ui';
import { defaultConfig, scenarios } from './ops';
const cfg = defaultConfig(scenarios[0]);
const input: PressureInputs = { lostMMcfd: 11.5, reserveIdx: 10, bufferSigma: 1, planningMode: 'OBSERVED', strategy: 'OPTIMIZED' };
it('invalidates pressure plans when any solve input changes', () => {
  const key = pressureInputKey('feb2024', cfg, input);
  for (const field of ['enrolledHomes', 'exemptShare', 'floorF', 'maxDepthF', 'overrideRate', 'seed'] as const) {
    expect(pressureInputKey('feb2024', { ...cfg, [field]: cfg[field] + 1 }, input)).not.toBe(key);
  }
  expect(pressureInputKey('design', cfg, input)).not.toBe(key);
  for (const [field, value] of Object.entries({ lostMMcfd: 12, reserveIdx: 11, bufferSigma: 2, planningMode: 'REPLAN', strategy: 'MAX_RELIEF' })) {
    expect(pressureInputKey('feb2024', cfg, { ...input, [field]: value })).not.toBe(key);
  }
  expect(pressurePlanId('feb2024', 'OPTIMIZED', 0, key)).toMatch(/^feb2024-OPT-rp0-[a-f0-9]{10}$/);
  expect(pressurePlanId('a'.repeat(100), 'MAX_RELIEF', 95, key).length).toBeLessThanOrEqual(64);
});
it('does not draw live pressure beyond a missing aggregate hour', () => {
  const p = { rMMcfd: 24, wMMcf: 10, reserveIdx: 5 };
  expect(livePressure(new Map([[0, 2], [2, 2]]), 4, p)).toEqual([90, undefined, undefined, undefined]);
});
