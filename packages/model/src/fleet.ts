import type { Anchor, CohortParams, CohortSpec, FleetConfig, SampleHome, Scenario } from './types';

/** Seeded PRNG returning floats in [0, 1). Use this instead of Math.random everywhere in the model. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Builds the 24 cohorts (heating × schedule × envelope × mass, nested in that order) per AGENTS.md Section 6.
 * UA multipliers are renormalized so the share-weighted mean UA equals uaMeanBtuHPerF.
 */
export function buildCohorts(spec: CohortSpec, uaMeanBtuHPerF: number): CohortParams[] {
  const uaNorm = spec.envelope.reduce((s, e) => s + e.share * e.uaMult, 0);
  const cohorts: CohortParams[] = [];
  for (const h of spec.heating) {
    for (const sch of spec.schedule) {
      for (const env of spec.envelope) {
        for (const m of spec.mass) {
          const UA = (uaMeanBtuHPerF * env.uaMult) / uaNorm;
          const Uao = spec.uaSplitAo * UA;
          const Ham = spec.hamMult * UA;
          const R = UA - Uao;
          const Umo = (Ham * R) / (Ham - R);
          cohorts.push({
            id: cohorts.length,
            key: `${h.key}-${sch.key}-${env.key}-${m.key}`,
            heating: h.key,
            share: h.share * sch.share * env.share * m.share,
            UA, Uao, Umo, Ham,
            Ca: h.caBtuPerF,
            Cm: m.tauMassH * UA,
            QmaxBtuH: h.qmaxMult * Math.max(spec.qmaxFloorBtuH, spec.qmaxDesignMult * UA * spec.designDeltaF),
            eta: h.eta,
            setpointDayF: spec.setpointDayF,
            setpointNightF: sch.setpointNightF,
            nightStartHour: spec.nightStartHour,
            nightEndHour: spec.nightEndHour,
          });
        }
      }
    }
  }
  return cohorts;
}

const KM_PER_DEG_LAT = 111.32;
const JITTER_MAX_KM = 2;

function pickWeighted<T>(items: T[], weight: (t: T) => number, u: number): number {
  const total = items.reduce((s, it) => s + weight(it), 0);
  let acc = 0;
  const target = u * total;
  for (let i = 0; i < items.length; i++) {
    acc += weight(items[i]);
    if (target < acc) return i;
  }
  return items.length - 1;
}

/** Polygon rings as [lat, lon] vertices (data/water_mask.json). */
export type WaterMask = [number, number][][];

/** Ray-casting point-in-polygon on [lat, lon] rings (fine at city scale). */
export function inWater(lat: number, lon: number, mask: WaterMask): boolean {
  for (const ring of mask) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [yi, xi] = ring[i], [yj, xj] = ring[j];
      if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
    if (inside) return true;
  }
  return false;
}

const WATER_RETRIES = 20;

/**
 * Deterministic sample homes for the map. Placed near weighted anchors (uniform within 2 km),
 * cohort drawn by share, exempt with probability exemptShare, and overrideRate of non-exempt homes
 * get an overrideHour uniform within the event window. With `waterMask`, points that land in water are re-drawn.
 */
export function sampleHomes(cohorts: CohortParams[], anchors: Anchor[], n: number, cfg: FleetConfig, sc: Scenario, waterMask?: WaterMask): SampleHome[] {
  const rng = mulberry32(cfg.seed);
  const homes: SampleHome[] = [];
  const eventLen = sc.eventEndHour - sc.eventStartHour;
  for (let id = 0; id < n; id++) {
    // Fixed draw order per home keeps results stable.
    const uAnchor = rng(), uR = rng(), uTheta = rng(), uCohort = rng(), uExempt = rng(), uOverride = rng(), uHour = rng();
    const a = anchors[pickWeighted(anchors, (x) => x.weight, uAnchor)];
    const place = (ur: number, ut: number): [number, number] => {
      const rKm = JITTER_MAX_KM * Math.sqrt(ur);
      const theta = 2 * Math.PI * ut;
      return [a.lat + (rKm * Math.cos(theta)) / KM_PER_DEG_LAT, a.lon + (rKm * Math.sin(theta)) / (KM_PER_DEG_LAT * Math.cos((a.lat * Math.PI) / 180))];
    };
    let [lat, lon] = place(uR, uTheta);
    if (waterMask && inWater(lat, lon, waterMask)) {
      // Re-draw from a per-home stream so homes on land keep their positions; fall back to the anchor (on land).
      const retry = mulberry32((cfg.seed ^ Math.imul(id + 1, 0x9e3779b1)) >>> 0);
      let k = 0;
      do { [lat, lon] = place(retry(), retry()); } while (inWater(lat, lon, waterMask) && ++k < WATER_RETRIES);
      if (inWater(lat, lon, waterMask)) [lat, lon] = [a.lat, a.lon];
    }
    const cohortId = cohorts[pickWeighted(cohorts, (c) => c.share, uCohort)].id;
    const exempt = uExempt < cfg.exemptShare;
    const overrideHour = !exempt && uOverride < cfg.overrideRate ? sc.eventStartHour + uHour * eventLen : null;
    homes.push({ id, cohortId, lat, lon, exempt, overrideHour });
  }
  return homes;
}

/** How many real enrolled homes each map dot represents. */
export function homesPerDot(cfg: FleetConfig, nDots: number): number {
  return nDots > 0 ? cfg.enrolledHomes / nDots : 0;
}
