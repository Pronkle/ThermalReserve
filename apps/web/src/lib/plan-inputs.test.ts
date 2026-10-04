import { expect, it } from 'vitest';
import type { FleetConfig, Plan } from '@thermal-reserve/model';
import { cachePlan, identifyPlan, planInputKey, planMatchesInputs, planNeedsNoSetbacks } from './plan-inputs';
const config: FleetConfig = { enrolledHomes: 50000, exemptShare: 0.08, floorF: 60, maxDepthF: 10, capacityMMcfd: 265, overrideRate: 0.06, seed: 42 };
const plan: Plan = { id: 'feb2024-OPTIMIZED', strategy: 'OPTIMIZED', targetsF: [[NaN, 62, NaN]] };
it('retains multiple input/mode solves and bounds the cache without mutating prior state', () => {
  const original = new Map([['OPTIMIZED:60', plan]]);
  let cache = cachePlan(original, 'OPTIMIZED:62', { ...plan, id: 'floor62' });
  expect(cache.get('OPTIMIZED:60')).toBe(plan);
  expect(original.size).toBe(1);
  cache = cachePlan(cache, 'MAX_RELIEF:60', { ...plan, strategy: 'MAX_RELIEF' });
  expect(cache.get('OPTIMIZED:60')?.strategy).toBe('OPTIMIZED');
  for (let i = 0; i < 10; i++) cache = cachePlan(cache, `input${i}`, plan);
  expect(cache.size).toBe(10);
  expect(cache.has('OPTIMIZED:60')).toBe(false);
});
it('rejects a dispatched plan when live parameters change, even after sliders return to those live values', () => {
  const original = planInputKey('feb2024', config);
  const dispatched = identifyPlan(plan, original, 'session');
  expect(planMatchesInputs(dispatched.id, original)).toBe(true);
  for (const key of Object.keys(config) as (keyof FleetConfig)[]) {
    expect(planMatchesInputs(dispatched.id, planInputKey('feb2024', { ...config, [key]: config[key] + 1 }))).toBe(false);
  }
  expect(planMatchesInputs(dispatched.id, planInputKey('feb2024', { ...config, capacityMMcfd: 295 }))).toBe(false);
  expect(planMatchesInputs(dispatched.id, planInputKey('design', config))).toBe(false);
  expect(planMatchesInputs(plan.id, original)).toBe(false); // Legacy plan has no provenance.
});
it('is independent of configuration property order and fits the server ID limit', () => {
  expect(planInputKey('feb2024', Object.fromEntries(Object.entries(config).reverse()) as unknown as FleetConfig)).toBe(planInputKey('feb2024', config));
  expect(identifyPlan({ ...plan, id: 'x'.repeat(100) }, planInputKey('feb2024', config), 'x'.repeat(100)).id.length).toBeLessThanOrEqual(64);
});
it('explains an empty optimized plan without mislabeling fallback or max relief', () => {
  expect(planNeedsNoSetbacks({ ...plan, targetsF: [[NaN, NaN]] })).toBe(true);
  expect(planNeedsNoSetbacks(plan)).toBe(false);
  expect(planNeedsNoSetbacks({ ...plan, targetsF: [[NaN]], note: 'Rule-based fallback' })).toBe(false);
  expect(planNeedsNoSetbacks({ ...plan, targetsF: [[NaN]], strategy: 'MAX_RELIEF' })).toBe(false);
});
