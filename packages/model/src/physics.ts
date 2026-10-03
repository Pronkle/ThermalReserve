// Two-node (air + mass) thermal model. Shared with the Spacetime module via `npm run sync-physics`.
// Imports types only (erased at compile time); no runtime imports, no DOM/Node APIs.
//
// E0 STUB: stepState/heatToHold/discretizeHourly use forward Euler. E1 replaces them with the
// exact 2x2 matrix-exponential solution. Signatures are final.
//
// Model:
//   Ca dTa/dt = Q + Uao (To - Ta) + Ham (Tm - Ta)
//   Cm dTm/dt = Ham (Ta - Tm) + Umo (To - Tm)

import type { CohortParams, ThermalState } from './types';

export const SUBSTEP_HOURS = 5 / 60;

/** Advances the state by dtHours with constant outdoorF and qBtuH. */
export function stepState(c: CohortParams, s: ThermalState, outdoorF: number, qBtuH: number, dtHours: number): ThermalState {
  const n = Math.max(1, Math.ceil(dtHours / (1 / 60)));
  const h = dtHours / n;
  let Ta = s.TaF;
  let Tm = s.TmF;
  for (let i = 0; i < n; i++) {
    const dTa = (qBtuH + c.Uao * (outdoorF - Ta) + c.Ham * (Tm - Ta)) / c.Ca;
    const dTm = (c.Ham * (Ta - Tm) + c.Umo * (outdoorF - Tm)) / c.Cm;
    Ta += h * dTa;
    Tm += h * dTm;
  }
  return { TaF: Ta, TmF: Tm };
}

/** Heat that brings TaF to setpointF by the end of dt (or holds it), clipped to [0, QmaxBtuH]. */
export function heatToHold(c: CohortParams, s: ThermalState, outdoorF: number, setpointF: number, dtHours: number): number {
  // Ta(end) is affine in Q: Ta(Q) = Ta(0) + Q * (Ta(1) - Ta(0)).
  const t0 = stepState(c, s, outdoorF, 0, dtHours).TaF;
  const t1 = stepState(c, s, outdoorF, 1, dtHours).TaF;
  const slope = t1 - t0;
  const q = slope > 0 ? (setpointF - t0) / slope : 0;
  return Math.min(c.QmaxBtuH, Math.max(0, q));
}

/** Gas volume (cf) burned to deliver qBtuH for dtHours. */
export function gasCf(c: CohortParams, qBtuH: number, dtHours: number, hhvBtuPerCf: number): number {
  return (qBtuH * dtHours) / (c.eta * hhvBtuPerCf);
}

/** Normal (no-program) setpoint at a local clock hour; night window may wrap midnight. */
export function normalSetpointF(c: CohortParams, clockHour: number): number {
  const h = ((clockHour % 24) + 24) % 24;
  const { nightStartHour: a, nightEndHour: b } = c;
  const inNight = a === b ? false : a < b ? h >= a && h < b : h >= a || h < b;
  return inNight ? c.setpointNightF : c.setpointDayF;
}

/**
 * Discretization for a 1-hour constant input: x(t+1) = A x(t) + Bq Q + Bo To, x = [Ta, Tm].
 * Used by the LP.
 */
export function discretizeHourly(c: CohortParams): { A: [[number, number], [number, number]]; Bq: [number, number]; Bo: [number, number] } {
  const col = (s: ThermalState, q: number, to: number) => stepState(c, s, to, q, 1);
  const z = col({ TaF: 0, TmF: 0 }, 0, 0);
  const ea = col({ TaF: 1, TmF: 0 }, 0, 0);
  const em = col({ TaF: 0, TmF: 1 }, 0, 0);
  const bq = col({ TaF: 0, TmF: 0 }, 1, 0);
  const bo = col({ TaF: 0, TmF: 0 }, 0, 1);
  return {
    A: [[ea.TaF - z.TaF, em.TaF - z.TaF], [ea.TmF - z.TmF, em.TmF - z.TmF]],
    Bq: [bq.TaF, bq.TmF],
    Bo: [bo.TaF, bo.TmF],
  };
}
