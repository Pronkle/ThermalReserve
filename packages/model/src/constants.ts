import type { ConstantsJson, ModelConstants } from './types';

function num(json: ConstantsJson, key: string): number {
  const e = json[key];
  if (!e) throw new Error(`constants.json missing key: ${key}`);
  if (typeof e.value !== 'number' || !Number.isFinite(e.value)) {
    throw new Error(`constants.json key ${key} is not a finite number`);
  }
  return e.value;
}

function pair(json: ConstantsJson, key: string): [number, number] {
  const e = json[key];
  if (!e) throw new Error(`constants.json missing key: ${key}`);
  const v = e.value;
  if (!Array.isArray(v) || v.length !== 2 || !v.every(Number.isFinite)) {
    throw new Error(`constants.json key ${key} is not a [number, number] pair`);
  }
  return [v[0], v[1]];
}

/** Builds the typed ModelConstants view from data/constants.json. Throws on a missing or malformed key. */
export function loadConstants(json: ConstantsJson): ModelConstants {
  return {
    hhvBtuPerCf: num(json, 'hhv_btu_per_cf'),
    etaFurnace: num(json, 'eta_furnace'),
    etaBoiler: num(json, 'eta_boiler'),
    uaMeanBtuHPerF: num(json, 'ua_mean_btuh_per_f'),
    spaceHeatShare: num(json, 'space_heat_share'),
    hddAnnual: num(json, 'hdd_annual'),
    setpointDayF: num(json, 'setpoint_day_f'),
    floorDefaultF: num(json, 'floor_default_f'),
    floorMinF: num(json, 'floor_min_f'),
    maxDepthDefaultF: num(json, 'max_depth_default_f'),
    exemptShare: num(json, 'exempt_share'),
    overrideRate: num(json, 'override_rate'),
    tier2Effectiveness: num(json, 'tier2_effectiveness'),
    conedRetentionTarget: num(json, 'validation_coned_retention_target'),
    conedBand: pair(json, 'validation_coned_band'),
    socalDailyBand: pair(json, 'validation_socal_daily_band'),
    socalEventPct: num(json, 'socal_event_pct'),
    socalDailyPct: num(json, 'socal_daily_pct'),
    needlePeakMMcfd: num(json, 'needle_peak_mmcfd'),
    deliverabilityLossMMcfd: num(json, 'deliverability_loss_mmcfd'),
    shortfallBcf: num(json, 'shortfall_bcf'),
    marginalPriceUsdPerMcf: num(json, 'marginal_price_usd_mcf'),
    customers: num(json, 'customers'),
    raw: json,
  };
}
