# Numbers guide: which model output feeds each number on screen

ENGINE owns this file. It maps every number on `/whatif`, `/validation`, and the `/ops` KPIs to the model function or
constant behind it, with its label and display format. Rule: the UI never computes physics or retypes a constant;
it calls the function and shows the label next to the value (AGENTS.md Sections 2, 3, 9).

Values in the "Today" column were computed on 2026-10-03 from `data/constants.json` (UA 415.2, HHV 1,030) and the
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
| ConEd-like | `validateConEdLike(cohorts, consts)` | `retention` (2 dp) vs target `consts.conedRetentionTarget` (0.48) and `band` | `pass` | 0.47 · **pass** (band 0.38–0.58) |
| SoCalGas-like | `validateSoCalLike(cohorts, consts)` | fitted `responseRate` r, `eventPct` (equals 15.1 by construction), `dailyPct` vs 2.2% published and `band` | `pass` | r 0.30 · 15.1% event · 1.16% daily · **gap** (band 1.5–3.0%) |
| Anchorage sanity | `anchorageSanity(cohorts, consts)` | `mcfPerHomeDay` (2 dp) at −20°F, 70°F, no setback | none; show vs the steady-state expectation UA × 90 × 24 ÷ (η × HHV) | 1.04 Mcf/home/day |

The SoCalGas card must not say pass or fail as if it were a test we nearly passed. Suggested copy (H2 decision,
honest gap): "Gap: our model keeps less of the event-hour saving than SoCalGas reported (1.16% vs 1.5–3.0% daily).
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
| Relief on tightest day (MMcf/day) | `gasDays(run)`: `reliefMMcf` of the day with the largest `baselineSystemMMcf − capacityMMcf` | feb2024 at 25k homes, OPTIMIZED: 2.14 |
| Uncovered shortfall (MMcf/day) | max over days of `uncoveredMMcf`; banner when > 0 | OPT 0.86 · SUSTAIN 1.64 · NAIVE 2.80 · none 3.00 |
| Peak-hour relief (MMcf/hour) | `totals.peakHourReliefMMcfh` | |
| Minimum indoor (°F) | `hours[h].minTaF` | includes normal night setpoints (64°F) |
| Homes at floor (%) | `hours[h].shareAtFloor` × 100 | only homes the program holds at the floor |
| Overrides | `hours[h].overrides` | 0 when no setback is dispatched |
| Value ($/day) | tightest-day `reliefMMcf` × 1,000 × `marginal_price_usd_mcf` | nearest $100 |
| Net over the whole run | `totals.netSavedMMcf` | secondary detail only: includes snapback days |
