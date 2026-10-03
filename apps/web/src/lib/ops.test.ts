import { describe, expect, it } from 'vitest';
import { buildOpsData, constants, dailyShortfall, defaultConfig, homeMode, scenarios } from './ops';

describe('W1 model presentation', () => {
  const sc = scenarios.find(sc => sc.id === 'design')!;
  const cfg = defaultConfig(sc);
  const data = buildOpsData(sc, cfg);
  it('plots all three model strategies and exactly 1000 sampled homes', () => {
    expect(data.homes).toHaveLength(1000);
    expect(data.chart).toHaveLength(sc.hours);
    expect(data.homesPerDot).toBe(cfg.enrolledHomes / 1000);
    expect(data.chart.every((row, h) => row.baseline === data.runs.BASELINE.hours[h].fleetGasMMcfh && row.naive === data.runs.NAIVE_4H.hours[h].fleetGasMMcfh && row.sustain === data.runs.SUSTAIN_STAGGER.hours[h].fleetGasMMcfh)).toBe(true);
  });
  it('shows naive recovery above baseline after a morning event', () => {
    const recovery = data.runs.NAIVE_4H.hours.filter(row => row.hour >= sc.eventStartHour && row.hour < sc.eventEndHour && row.cohorts.some(c => c.mode === 'recovering'));
    expect(recovery.some(row => row.fleetGasMMcfh > row.baselineFleetGasMMcfh)).toBe(true);
  });
  it('changes enrolled fleet demand without changing baseline system demand', () => {
    const smaller = buildOpsData(sc, { ...cfg, enrolledHomes: 10000 });
    expect(smaller.runs.BASELINE.hours[0].fleetGasMMcfh / data.runs.BASELINE.hours[0].fleetGasMMcfh).toBeCloseTo(10000 / cfg.enrolledHomes);
    smaller.runs.BASELINE.hours.forEach((row, h) => expect(row.systemMMcfh).toBeCloseTo(data.runs.BASELINE.hours[h].systemMMcfh, 10));
  });
  it('uses sourced constants for the local defaults', () => {
    expect(cfg.floorF).toBe(constants.floorDefaultF);
    expect(cfg.maxDepthF).toBe(constants.maxDepthDefaultF);
    expect(cfg.overrideRate).toBe(constants.overrideRate);
  });
  it('keeps baseline dots normal when a simulated override is scheduled', () => {
    const home = { ...data.homes[0], exempt: false, overrideHour: 0 };
    expect(homeMode(home, data.runs.BASELINE, 12)).not.toBe('overridden');
    expect(homeMode(home, data.runs.SUSTAIN_STAGGER, 12)).toBe('overridden');
  });
  it('does not treat hourly swings as a daily capacity breach', () => {
    const baseline = data.runs.BASELINE;
    const dailyPeak = Math.max(...Array.from({ length: Math.ceil(sc.hours / 24) }, (_, day) => baseline.hours.slice(day * 24, day * 24 + 24).reduce((sum, h) => sum + h.systemMMcfh, 0)));
    expect(dailyShortfall(baseline, dailyPeak + 1)).toBe(0);
    expect(dailyShortfall(baseline, dailyPeak - 3)).toBeCloseTo(3);
  });
});
