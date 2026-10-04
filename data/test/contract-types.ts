// Mirror of the data-facing types in AGENTS.md Sections 6–7 (Contract A/B).
// TEMPORARY: once ENGINE's E0 stubs land on main, import Scenario, Label, etc. from
// '@thermal-reserve/model' instead and delete the duplicates here.

export type Label = 'sourced' | 'derived' | 'assumed';

export interface Scenario {
  id: string; name: string; kind: 'replay' | 'synthetic';
  startIso: string; hours: number;
  outdoorF: number[]; systemMMcfh: number[];
  eventStartHour: number; eventEndHour: number;
  capacityMMcfd: number; capacityNote: string; source: string;
}

export interface ConstantEntry {
  value: number | number[];
  unit: string;
  label: Label;
  source: string;
}

export type Constants = Record<string, ConstantEntry>;

export interface CohortSpec {
  heating: { key: 'furnace' | 'boiler'; share: number; eta: number; caBtuPerF: number; qmaxMult: number }[];
  schedule: { key: string; share: number; setpointNightF: number }[];
  envelope: { key: string; share: number; uaMult: number }[];
  mass: { key: string; share: number; tauMassH: number }[];
  setpointDayF: number; nightStartHour: number; nightEndHour: number;
  uaSplitAo: number; hamMult: number;
  qmaxFloorBtuH: number; qmaxDesignMult: number; designDeltaF: number;
}

export interface Anchor { name: string; lat: number; lon: number; weight: number; }

/** JSON imports type string literals as `string` and tuples as arrays; compare against this. */
export type Widen<T> = T extends string
  ? string
  : T extends readonly (infer U)[]
    ? Widen<U>[]
    : T extends object
      ? { [K in keyof T]: Widen<T[K]> }
      : T;

/** Every key AGENTS.md Sections 2 and 6 require in data/constants.json. */
export const REQUIRED_CONSTANT_KEYS = [
  'shortfall_bcf', 'storage_aug_bcf', 'record_day_mmcf', 'jan_avg_mmcfd', 'jan2024_total_bcf',
  'annual_bcf', 'deliverability_loss_mmcfd', 'needle_peak_mmcfd', 'marginal_price_usd_mcf',
  'avg_home_mcf_year', 'customers', 'lng_earliest',
  'socal_event_pct', 'socal_daily_pct', 'coned_snapback_pct', 'winter_optout_pct',
  'socal_cost_usd_therm', 'rebate_upfront_usd', 'rebate_annual_usd', 'energy_watch_2012_pct',
  'hhv_btu_per_cf', 'space_heat_share', 'eta_furnace', 'eta_boiler', 'hdd_annual',
  'ua_mean_btuh_per_f', 'setpoint_day_f', 'floor_default_f', 'floor_min_f', 'max_depth_default_f',
  'exempt_share', 'tier2_effectiveness', 'override_rate',
  'validation_coned_retention_target', 'validation_coned_band', 'validation_socal_daily_band',
  // Pressure overhaul (AGENTS.md Section 6, Oct 4)
  'headroom_2024_mmcfd', 'deliverability_2024_mmcfd', 'linepack_usable_mmcf',
  'reserve_default_idx', 'reserve_min_idx', 'forecast_buffer_sigma_default', 'forecast_lag_h',
  'replan_interval_h', 'drift_temp_f', 'drift_hours', 'drift_pressure_idx', 'drift_fade_h',
  'demand_sensitivity_mmcfd_per_f',
] as const;
export type RequiredConstantKey = (typeof REQUIRED_CONSTANT_KEYS)[number];

/** data/deliverability_ticks.json (AGENTS.md Section 6). */
export interface DeliverabilityTick { lostMMcfd: number; label: string; label_kind: 'sourced' | 'derived' | 'assumed'; source: string; }

/** data/presets.json (AGENTS.md Section 6). */
export interface Preset {
  id: 'nearmiss' | 'stress'; name: string; scenarioId: string;
  lostMMcfd: number; enrolledHomes: number; reserveIdx: number; provisional: boolean;
}
