# Numbers guide: which model output feeds each number on screen

ENGINE owns this file. It maps every number on `/whatif`, `/validation`, and the `/ops` KPIs to the model function or
constant behind it, with its label and display format. Rule: the UI never computes physics or retypes a constant;
it calls the function and shows the label next to the value (AGENTS.md Sections 2, 3, 9).

Values in the "Today" column were computed on 2026-10-03 (refreshed 17:45 ET) from `data/constants.json` (UA 398.3, HHV 988, both updated by DATA after H1 approved HHV 988) and the
tuned `data/cohort_spec.json`. They will move if DATA changes a constant; that is expected, and tests compute their
expectations from the constants.

Formatting (Section 9): MMcf/day 2 decimals; °F 1 decimal; percent 1 decimal; dollars to the nearest $100.

## Setup shared by all pages

```ts
import { loadConstants, buildCohorts } from '@thermal-reserve/model';
const consts = loadConstants(constantsJson);                     // data/constants.json
const cohorts = buildCohorts(cohortSpecJson, consts.uaMeanBtuHPerF); // data/cohort_spec.json
const label = (key: string) => consts.raw[key].label;            // 'sourced' | 'derived' | 'assumed'
```

## `/whatif`

`whatIf({ participationPct, setbackF, outdoorF, days, tier2Pct }, consts)`. Defaults per Section 3: 16.7% participation,
5°F, −20°F, 3 days, Tier 2 0%.

| On screen | Field | Unit / format | Label | Today (defaults) |
| --- | --- | --- | --- | --- |
| Relief | `mmcfPerDay` | MMcf/day, 2 dp | derived | 1.43 |
| Share of needle peak | `needlePeakShare` × 100 | %, 1 dp | derived (from `needle_peak_mmcfd`, sourced) | 7.1% |
| Share of 2024 deliverability loss | `deliverabilityLossShare` × 100 | %, 1 dp | derived (`deliverability_loss_mmcfd`, sourced) | 5.0% |
| Share of 3 Bcf shortfall over N days | `shortfallShare` × 100 | %, 2 dp | derived (`shortfall_bcf`, sourced) | 0.14% |
| Value | `usdPerDay` | $/day, nearest $100 | derived (`marginal_price_usd_mcf`, sourced) | $24,900 |
| Show the math | `formulaLines` | print verbatim, one per line | each line carries its own labels | 9 lines |

Notes:
- Sample homes: pass `data/water_mask.json` as the 6th argument of `sampleHomes` everywhere (map and Demo preset's
  `load_homes`) so the browser and the database place the same homes; with seed 42, 32 of 1,000 homes move off water.
- `formulaLines` already includes every constant with its label in brackets; print them as-is rather than rebuilding them.
- `outdoorF` does not change the result. A steady setback saves the same heat loss at any outdoor temperature while
  the furnace runs; the last formula line says so (assumed). Keep the slider, since the spec asks for it, but don't
  imply colder means more savings.
- Uses the furnace efficiency (`eta_furnace`) for every home. That is a simplification; the fleet simulation uses
  0.82 for boilers.
- Tier 2 homes count at `tier2_effectiveness` (0.30, assumed); the third formula line shows the count.
- The 1.5% Energy Watch figure (`energy_watch_2012_pct`) is a cut in total energy load during a 2-hour drill, not
  gas use (DATA, msg 56). If Tier 2 copy cites it, say "energy load".

## `/validation`

Three cards. Each function returns `hourly: { hour, baselineCf, eventCf }[]` (24 clock hours, cf per home) for the
small event-day chart: baseline gray, event blue, event window 06:00–10:00 shaded.

| Card | Call | Show | Pass rule | Today |
| --- | --- | --- | --- | --- |
| ConEd-like | `validateConEdLike(cohorts, consts)` | `retention` (2 dp) vs target `consts.conedRetentionTarget` (0.48) and `band` | `pass` | 0.465 · **pass** (band 0.38–0.58) |
| SoCalGas-like | `validateSoCalLike(cohorts, consts)` | fitted `responseRate` r, `eventPct` (equals 15.1 by construction), `dailyPct` vs 2.2% published and `band` | `pass` | r 0.30 · 15.1% event · 1.14% daily · **gap** (band 1.5–3.0%) |
| Anchorage sanity | `anchorageSanity(cohorts, consts)` | `mcfPerHomeDay` (2 dp) at −20°F, 70°F, no setback | none; show vs the steady-state expectation UA × 90 × 24 ÷ (η × HHV) | 1.04 Mcf/home/day |

The SoCalGas card must not say pass or fail as if it were a test we nearly passed. Suggested copy (H2 decision,
honest gap): "Gap: our model keeps less of the event-hour saving than SoCalGas reported (1.14% vs 1.5–3.0% daily).
ConEd's pilot implies about half the saving is lost to snapback; SoCalGas's implies far less. One house model can't
match both under these test conditions, so our net-savings numbers lean conservative." Use amber, not red.

Conditions to print on each card (they are what the functions simulate):
- ConEd-like: outdoor 30°F constant, 70°F setpoint, −4°F setback 06:00–10:00; day 2 of a 2-day run is measured.
- SoCalGas-like: outdoor 45°F constant, 68°F setpoint, −4°F 06:00–10:00; r is the share of homes that respond,
  fitted so the fleet's event-hour reduction equals 15.1% (`socal_event_pct`, sourced).
- Labels: published targets sourced (`socal_event_pct`, `socal_daily_pct`, `coned_snapback_pct`); retention target
  derived (1 − 0.52); pass bands assumed; model outputs derived.

Parameter table: read `data/cohort_spec.json`. The tuned fields are `heating[].caBtuPerF` (1,500 / 3,000),
`hamMult` (1.5), `mass[].tauMassH` (40 / 60); allowed ranges Ca 1,500–8,000 BTU/°F, Ham ×1–6, τ 15–60 h. Everything
in that file is assumed.

## `/ops` KPIs (for W3)

Per-run totals come from `runPlan` / `compareStrategies`; per-day values from `gasDays(run)`. Capacity is a daily
limit (msg 32), so headline the tight day, not a multi-day average (msg 62).

| KPI | Source | Note |
| --- | --- | --- |
| Relief on tightest day (MMcf/day) | `gasDays(run)`: `reliefMMcf` of the day with the largest `baselineSystemMMcf − capacityMMcf` | feb2024 Demo preset (25k homes, 6% overrides), OPTIMIZED: 2.06 (2.15 with overrides off) |
| Uncovered shortfall (MMcf/day) | max over days of `uncoveredMMcf`; banner when > 0 | Demo preset: OPT 0.94 · SUSTAIN 1.69 · NAIVE 2.80 · none 3.00 (overrides off: OPT 0.85, SUSTAIN 1.64) |
| Peak-hour relief (MMcf/hour) | `totals.peakHourReliefMMcfh` | |
| Minimum indoor (°F) | `hours[h].minTaF` | includes normal night setpoints (64°F) |
| Homes at floor (%) | `hours[h].shareAtFloor` × 100 | only homes the program holds at the floor |
| Overrides | `hours[h].overrides` | 0 when no setback is dispatched |
| Value ($/day) | tightest-day `reliefMMcf` × 1,000 × `marginal_price_usd_mcf` | nearest $100 |
| Net over the whole run | `totals.netSavedMMcf` | secondary detail only: includes snapback days |

## `/home` (for W4)

Reads `sim_config`, the caller's own `household` row, and aggregates (Section 9). A household follows its template
cohort (`<heating>-steady-average-light`; "other" heating uses furnace) and is never held below 62°F (server-side,
`household.floor_f`, H1 decision msg 123).

| On screen | Source | Format / label | Note |
| --- | --- | --- | --- |
| Indoor temperature | `household.ta_f` | °F, 1 dp, derived | |
| Setpoint | `household.target_f` | °F, 1 dp | |
| Status | exempt → Exempt; overridden → Overridden; `target_f < normal − 0.05` → "Holding −X°F" (X = normal − target_f, 1 dp); `ta_f < normal − 0.25` → Recovering; else Normal | text | normal = `normalSetpointF(templateCohort, clockHourAt(sc, sim_hour))`: build the template from the `cohort` row, never hard-code 70 |
| Countdown to event end | (`event_end_hour` − `sim_hour`) simulated hours | "h:mm sim time" | label it simulated so a 2 h/s clock isn't mistaken for real time |
| Gas saved this event | `household.saved_cf` | cf, whole number, derived | **net of reheating**: it rises while holding and falls during recovery (snapback). Caption it: "Net, after your home reheats." |
| Dollars | `saved_cf ÷ 1,000 × marginal_price_usd_mcf` | $, 2 dp (amounts are small), derived from `marginal_price_usd_mcf` (sourced) | the nearest-$100 rule is for fleet-scale values |
| Community relief so far | Σ `aggregate_hour.relief_mmcf` for completed hours | MMcf, 2 dp, derived | also net of snapback |
| Day's relief target (bar) | current gas day d: max(0, Σ_{h in d} `weather_hour.system_mmcfh` − `capacity_mmcfd`) | MMcf, 2 dp, derived | the no-program shortfall for that gas day; progress = Σ `relief_mmcf` for the day's completed hours. On days with no shortfall, hide the bar and say "No shortfall today" |

Expected magnitudes (feb2024 Demo preset, OPTIMIZED, a household joining at the start): about 95 cf saved on Feb 2
and about 64 cf net over the whole run, roughly $1.10. Feb 2's target is 3.00 MMcf; the fleet relieves 2.06 with 6%
overrides. Per-home numbers are small by design. The pitch is the fleet total, so show the community bar
prominently. A household that joins mid-run counts savings from its join time.
