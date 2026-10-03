import type { ModelConstants } from './types';

export interface WhatIfInput { participationPct: number; setbackF: number; outdoorF: number; days: number; tier2Pct: number }
export interface WhatIfResult { mmcfPerDay: number; needlePeakShare: number; deliverabilityLossShare: number; shortfallShare: number; usdPerDay: number; formulaLines: string[] }

const fmt = (x: number, d = 2) => x.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: 0 });
// Percentages and dollars use fixed precision so lines read consistently (dollars to the nearest $100, per the copy rules).
const pct = (share: number, d = 1) => `${(share * 100).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}%`;
const usd100 = (x: number) => `$${(Math.round(x / 100) * 100).toLocaleString('en-US')}`;

/**
 * Steady-state what-if: savedCfPerHomeDay = UA × setbackF × 24 ÷ (eta × HHV).
 * Tier 2 pledged homes count at tier2_effectiveness. Outdoor temperature does not change a steady-state
 * setback saving (the furnace still runs); it is echoed for context only.
 */
export function whatIf(input: WhatIfInput, consts: ModelConstants): WhatIfResult {
  const lbl = (key: string) => consts.raw[key]?.label ?? 'assumed';
  const ua = consts.uaMeanBtuHPerF;
  const eta = consts.etaFurnace;
  const hhv = consts.hhvBtuPerCf;
  const cfPerHomeDay = (ua * input.setbackF * 24) / (eta * hhv);
  const tier1Homes = (consts.customers * input.participationPct) / 100;
  const tier2Homes = (consts.customers * input.tier2Pct) / 100;
  const effectiveHomes = tier1Homes + tier2Homes * consts.tier2Effectiveness;
  const mmcfPerDay = (cfPerHomeDay * effectiveHomes) / 1e6;
  const needlePeakShare = mmcfPerDay / consts.needlePeakMMcfd;
  const deliverabilityLossShare = mmcfPerDay / consts.deliverabilityLossMMcfd;
  const shortfallShare = (mmcfPerDay * input.days) / (consts.shortfallBcf * 1000);
  const usdPerDay = mmcfPerDay * 1000 * consts.marginalPriceUsdPerMcf;

  const formulaLines = [
    `Saved per home per day = UA ${fmt(ua, 0)} BTU/(h·°F) [${lbl('ua_mean_btuh_per_f')}] × setback ${fmt(input.setbackF, 1)}°F × 24 h ÷ (efficiency ${fmt(eta)} [${lbl('eta_furnace')}] × HHV ${fmt(hhv, 0)} BTU/cf [${lbl('hhv_btu_per_cf')}]) = ${fmt(cfPerHomeDay, 1)} cf/day (derived)`,
    `Participating homes = ${fmt(input.participationPct, 1)}% × ${fmt(consts.customers, 0)} customers [${lbl('customers')}] = ${fmt(tier1Homes, 0)}`,
    `Tier 2 homes counted = ${fmt(input.tier2Pct, 1)}% × ${fmt(consts.customers, 0)} × effectiveness ${fmt(consts.tier2Effectiveness)} [${lbl('tier2_effectiveness')}] = ${fmt(tier2Homes * consts.tier2Effectiveness, 0)}`,
    `Relief = ${fmt(cfPerHomeDay, 1)} cf × ${fmt(effectiveHomes, 0)} homes ÷ 1,000,000 = ${fmt(mmcfPerDay)} MMcf/day (derived)`,
    `Share of needle peak = ${fmt(mmcfPerDay)} ÷ ${fmt(consts.needlePeakMMcfd)} MMcf/day [${lbl('needle_peak_mmcfd')}] = ${pct(needlePeakShare)}`,
    `Share of 2024 deliverability loss = ${fmt(mmcfPerDay)} ÷ ${fmt(consts.deliverabilityLossMMcfd)} MMcf/day [${lbl('deliverability_loss_mmcfd')}] = ${pct(deliverabilityLossShare)}`,
    `Share of shortfall = ${fmt(mmcfPerDay)} × ${fmt(input.days, 0)} days ÷ (${fmt(consts.shortfallBcf)} Bcf [${lbl('shortfall_bcf')}] × 1,000) = ${pct(shortfallShare, 2)}`,
    `Value = ${fmt(mmcfPerDay)} MMcf/day × 1,000 × $${consts.marginalPriceUsdPerMcf.toFixed(2)}/Mcf [${lbl('marginal_price_usd_mcf')}] = ${usd100(usdPerDay)}/day (rounded to $100)`,
    `Outdoor ${fmt(input.outdoorF, 0)}°F: a steady setback saves the same heat loss at any outdoor temperature while the furnace is running (assumed).`,
  ];

  return { mmcfPerDay, needlePeakShare, deliverabilityLossShare, shortfallShare, usdPerDay, formulaLines };
}
