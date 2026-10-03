// Two-node (air + mass) thermal model. Shared with the Spacetime module via `npm run sync-physics`.
// Imports types only (erased at compile time); no runtime imports, no DOM/Node APIs.
//
// Exact solution: x' = M x + u with x = [Ta, Tm] and u constant over the step, so
//   x(dt) = E x(0) + G u,  E = exp(M dt),  G = ∫0^dt exp(M s) ds.
// M is similar to a symmetric negative-definite matrix, so its eigenvalues are real, distinct
// (when Ham > 0) and negative; E and G come from Sylvester's formula for a 2×2.
//
// Model:
//   Ca dTa/dt = Q + Uao (To - Ta) + Ham (Tm - Ta)
//   Cm dTm/dt = Ham (Ta - Tm) + Umo (To - Tm)

import type { CohortParams, ThermalState } from './types';

export const SUBSTEP_HOURS = 5 / 60;

type M2 = [[number, number], [number, number]];

/** exp(M dt) and ∫0^dt exp(M s) ds for the cohort's system matrix. */
function propagators(c: CohortParams, dtHours: number): { E: M2; G: M2 } {
  const m00 = -(c.Uao + c.Ham) / c.Ca, m01 = c.Ham / c.Ca;
  const m10 = c.Ham / c.Cm, m11 = -(c.Ham + c.Umo) / c.Cm;
  const tr = m00 + m11;
  const det = m00 * m11 - m01 * m10;
  const disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
  const l1 = tr / 2 + disc, l2 = tr / 2 - disc;
  const e1 = Math.exp(l1 * dtHours), e2 = Math.exp(l2 * dtHours);
  // f(M) = [f(l1)(M - l2 I) - f(l2)(M - l1 I)] / (l1 - l2); repeated-root limit when disc ≈ 0.
  const apply = (f1: number, f2: number, df: number): M2 => {
    let a: number, b: number;
    if (disc > 1e-12 * Math.abs(tr)) {
      a = (f1 - f2) / (l1 - l2);            // coefficient on M
      b = (l1 * f2 - l2 * f1) / (l1 - l2);  // coefficient on I
    } else {
      a = df;
      b = f1 - l1 * df;
    }
    return [[a * m00 + b, a * m01], [a * m10, a * m11 + b]];
  };
  const t = dtHours;
  const phi = (l: number, e: number) => (Math.abs(l * t) < 1e-8 ? t : (e - 1) / l);
  const E = apply(e1, e2, t * e1);
  const G = apply(phi(l1, e1), phi(l2, e2), Math.abs(l1 * t) < 1e-8 ? t * t / 2 : (t * e1 - phi(l1, e1)) / l1);
  return { E, G };
}

/** Advances the state by dtHours with constant outdoorF and qBtuH (exact for constant inputs). */
export function stepState(c: CohortParams, s: ThermalState, outdoorF: number, qBtuH: number, dtHours: number): ThermalState {
  if (dtHours <= 0) return { TaF: s.TaF, TmF: s.TmF };
  const { E, G } = propagators(c, dtHours);
  const ua = (qBtuH + c.Uao * outdoorF) / c.Ca;
  const um = (c.Umo * outdoorF) / c.Cm;
  return {
    TaF: E[0][0] * s.TaF + E[0][1] * s.TmF + G[0][0] * ua + G[0][1] * um,
    TmF: E[1][0] * s.TaF + E[1][1] * s.TmF + G[1][0] * ua + G[1][1] * um,
  };
}

/** Heat that brings TaF to setpointF by the end of dt (or holds it), clipped to [0, QmaxBtuH]. */
export function heatToHold(c: CohortParams, s: ThermalState, outdoorF: number, setpointF: number, dtHours: number): number {
  if (dtHours <= 0) return 0;
  // Ta(end) is affine in Q with slope G[0][0] / Ca > 0.
  const { E, G } = propagators(c, dtHours);
  const t0 = E[0][0] * s.TaF + E[0][1] * s.TmF + G[0][0] * (c.Uao * outdoorF) / c.Ca + G[0][1] * (c.Umo * outdoorF) / c.Cm;
  const slope = G[0][0] / c.Ca;
  const q = (setpointF - t0) / slope;
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
 * Exact discretization for a 1-hour constant input: x(t+1) = A x(t) + Bq Q + Bo To, x = [Ta, Tm].
 * Used by the LP.
 */
export function discretizeHourly(c: CohortParams): { A: [[number, number], [number, number]]; Bq: [number, number]; Bo: [number, number] } {
  const { E, G } = propagators(c, 1);
  return {
    A: E,
    Bq: [G[0][0] / c.Ca, G[1][0] / c.Ca],
    Bo: [G[0][0] * c.Uao / c.Ca + G[0][1] * c.Umo / c.Cm, G[1][0] * c.Uao / c.Ca + G[1][1] * c.Umo / c.Cm],
  };
}
