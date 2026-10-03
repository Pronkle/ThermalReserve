import { describe, expect, it } from 'vitest';
import { SUBSTEP_HOURS, discretizeHourly, heatToHold, normalSetpointF, stepState } from '../src/index';
import type { ThermalState } from '../src/index';
import { cohorts } from './helpers';

describe('physics (E1)', () => {
  it('steady state: heat to hold Ta converges to UA × (Ta − To) within 0.5%', () => {
    for (const c of cohorts) {
      let s: ThermalState = { TaF: 70, TmF: 40 };
      let q = 0;
      for (let k = 0; k < 200 / SUBSTEP_HOURS; k++) {
        q = heatToHold(c, s, -20, 70, SUBSTEP_HOURS);
        s = stepState(c, s, -20, q, SUBSTEP_HOURS);
      }
      const target = c.UA * 90;
      expect(Math.abs(q - target) / target, c.key).toBeLessThan(0.005);
    }
  });

  it('12 five-minute sub-steps equal one exact 1-hour step within 0.01°F', () => {
    for (const c of cohorts) {
      const s0: ThermalState = { TaF: 68, TmF: 60 };
      let s = s0;
      for (let k = 0; k < 12; k++) s = stepState(c, s, -20, 30000, SUBSTEP_HOURS);
      const one = stepState(c, s0, -20, 30000, 1);
      expect(Math.abs(s.TaF - one.TaF)).toBeLessThan(0.01);
      expect(Math.abs(s.TmF - one.TmF)).toBeLessThan(0.01);
      const d = discretizeHourly(c);
      const ta = d.A[0][0] * s0.TaF + d.A[0][1] * s0.TmF + d.Bq[0] * 30000 + d.Bo[0] * -20;
      const tm = d.A[1][0] * s0.TaF + d.A[1][1] * s0.TmF + d.Bq[1] * 30000 + d.Bo[1] * -20;
      expect(ta).toBeCloseTo(one.TaF, 9);
      expect(tm).toBeCloseTo(one.TmF, 9);
    }
  });

  it('matches a fine forward-Euler integration', () => {
    const c = cohorts[0];
    let ta = 70, tm = 55;
    const n = 36000;
    const h = 1 / n;
    for (let i = 0; i < n; i++) {
      const dTa = (20000 + c.Uao * (-20 - ta) + c.Ham * (tm - ta)) / c.Ca;
      const dTm = (c.Ham * (ta - tm) + c.Umo * (-20 - tm)) / c.Cm;
      ta += h * dTa; tm += h * dTm;
    }
    const s = stepState(c, { TaF: 70, TmF: 55 }, -20, 20000, 1);
    expect(Math.abs(s.TaF - ta)).toBeLessThan(1e-3);
    expect(Math.abs(s.TmF - tm)).toBeLessThan(1e-3);
  });

  it('furnace off: temperatures decay monotonically toward To', () => {
    for (const c of cohorts) {
      let s: ThermalState = { TaF: 70, TmF: 68 };
      for (let k = 0; k < 400; k++) {
        const n = stepState(c, s, -20, 0, SUBSTEP_HOURS);
        expect(n.TaF).toBeLessThanOrEqual(s.TaF + 1e-12);
        expect(n.TmF).toBeLessThanOrEqual(s.TmF + 1e-12);
        expect(n.TaF).toBeGreaterThan(-20);
        expect(n.TmF).toBeGreaterThan(-20);
        s = n;
      }
    }
  });

  it('heatToHold never returns negative or above Qmax', () => {
    for (const c of cohorts) {
      for (const [ta, tm, to, sp] of [[70, 70, 50, 60], [55, 50, -40, 72], [70, 65, -20, 70], [80, 80, 60, 62], [40, 30, -40, 70]]) {
        const q = heatToHold(c, { TaF: ta, TmF: tm }, to, sp, SUBSTEP_HOURS);
        expect(q).toBeGreaterThanOrEqual(0);
        expect(q).toBeLessThanOrEqual(c.QmaxBtuH);
      }
    }
  });

  it('normalSetpointF wraps the night window across midnight', () => {
    const c = cohorts[0]; // night schedule, 64°F 22:00–06:00
    expect(normalSetpointF(c, 21.9)).toBe(70);
    expect(normalSetpointF(c, 22)).toBe(64);
    expect(normalSetpointF(c, 2)).toBe(64);
    expect(normalSetpointF(c, 5.99)).toBe(64);
    expect(normalSetpointF(c, 6)).toBe(70);
    expect(normalSetpointF(c, 26)).toBe(64);
  });
});
