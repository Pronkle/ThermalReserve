// GENERATED COPY of packages/model/src/types.ts. Do not edit.
// Run `npm run sync-physics` to refresh.

// Shared types for Thermal Reserve (AGENTS.md Section 7, Contract B).
// This file imports nothing: STDB copies it into the Spacetime module.

export type Strategy = 'BASELINE' | 'NAIVE_4H' | 'OPTIMIZED' | 'MAX_RELIEF' | 'SUSTAIN_STAGGER';
export type HeatingType = 'furnace' | 'boiler';
export type Label = 'sourced' | 'derived' | 'assumed';

export interface CohortParams {
  id: number;                 // 0..23
  key: string;                // e.g. 'furnace-night-tight-light'
  heating: HeatingType;
  share: number;              // fraction of enrolled homes; all cohorts sum to 1
  UA: number;                 // BtuHPerF, total steady-state loss
  Uao: number; Umo: number; Ham: number;  // BtuHPerF
  Ca: number; Cm: number;     // BtuPerF
  QmaxBtuH: number;           // delivered heat limit
  eta: number;                // appliance efficiency
  setpointDayF: number; setpointNightF: number;
  nightStartHour: number; nightEndHour: number;  // local clock hours
}

export interface ThermalState { TaF: number; TmF: number; }

export interface Scenario {
  id: string; name: string; kind: 'replay' | 'synthetic';
  startIso: string; hours: number;
  outdoorF: number[]; systemMMcfh: number[];
  eventStartHour: number; eventEndHour: number;
  capacityMMcfd: number; capacityNote: string; source: string;
}

export interface FleetConfig {
  enrolledHomes: number;      // 1,000..50,000
  exemptShare: number;        // 0.08
  floorF: number;             // >= 60
  maxDepthF: number;          // max setback below normal setpoint
  overrideRate: number;       // 0.06 per event
  capacityMMcfd: number;
  seed: number;
}

export interface Plan {
  id: string; strategy: Strategy;
  targetsF: number[][];       // [cohortId][hour]; NaN = follow normal setpoint
  solveMs?: number;
  shortfallMMcfh?: number[];  // LP slack per hour (0 when covered)
  note?: string;              // e.g. 'Rule-based fallback'
}

export interface HourResult {
  hour: number; outdoorF: number;
  fleetGasMMcfh: number; baselineFleetGasMMcfh: number;
  systemMMcfh: number; capacityMMcfh: number;
  minTaF: number; shareAtFloor: number; overrides: number;
  cohorts: { TaF: number; TmF: number; qBtuH: number; gasCfPerHome: number; mode: 'normal' | 'holding' | 'recovering' }[];
}

export interface RunResult {
  strategy: Strategy; hours: HourResult[];
  totals: {
    fleetGasMMcf: number; baselineFleetGasMMcf: number;
    netSavedMMcf: number; netSavedMMcfdDuringEvent: number;
    eventHourSavedMMcf: number; peakHourReliefMMcfh: number;
    degreeHoursBelowNormal: number; uncoveredShortfallMMcf: number;
  };
}

export interface SampleHome { id: number; cohortId: number; lat: number; lon: number; exempt: boolean; overrideHour: number | null; }

// ---- Supporting types referenced by Contract B signatures ----

/** Shape of data/cohort_spec.json (Section 6). */
export interface CohortSpec {
  heating: { key: HeatingType; share: number; eta: number; caBtuPerF: number; qmaxMult: number }[];
  schedule: { key: string; share: number; setpointNightF: number }[];
  envelope: { key: string; share: number; uaMult: number }[];
  mass: { key: string; share: number; tauMassH: number }[];
  setpointDayF: number; nightStartHour: number; nightEndHour: number;
  uaSplitAo: number; hamMult: number;
  qmaxFloorBtuH: number; qmaxDesignMult: number; designDeltaF: number;
}

/** One entry of data/anchors.json (Section 6). */
export interface Anchor { name: string; lat: number; lon: number; weight: number; }

/** One entry of data/constants.json. */
export interface ConstantEntry {
  value: number | number[] | string;
  unit: string;
  label: Label;
  source: string;
}

export type ConstantsJson = Record<string, ConstantEntry>;

/** Typed view of the constants.json values the model needs. Built by loadConstants(). */
export interface ModelConstants {
  hhvBtuPerCf: number;
  etaFurnace: number;
  etaBoiler: number;
  uaMeanBtuHPerF: number;
  spaceHeatShare: number;
  hddAnnual: number;
  setpointDayF: number;
  floorDefaultF: number;
  floorMinF: number;
  maxDepthDefaultF: number;
  exemptShare: number;
  overrideRate: number;
  tier2Effectiveness: number;
  conedRetentionTarget: number;
  conedBand: [number, number];
  socalDailyBand: [number, number];   // percent
  socalEventPct: number;              // percent
  socalDailyPct: number;              // percent
  needlePeakMMcfd: number;
  deliverabilityLossMMcfd: number;
  shortfallBcf: number;
  marginalPriceUsdPerMcf: number;
  customers: number;
  /** Raw entries keyed by constants.json key, for labels/sources in formula text. */
  raw: ConstantsJson;
}
