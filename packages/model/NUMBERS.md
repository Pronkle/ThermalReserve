# Numbers guide: which model output feeds each number on screen

ENGINE owns this file. It maps every number on `/ops` (pressure console), `/home`, `/whatif`, `/validation`, and the
gas details drawer (`?ui=gas`) to the model function or constant behind it, with its label and display format. Rule: the UI never computes physics or retypes a constant;
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

## `/ops` pressure console (Oct 4 overhaul)

Setup: `p = pressureParams(consts, consts.raw, lostMMcfd, reserveIdx)`, so R = `deliverability_2024_mmcfd` (278,
derived) − lost and W = `linepack_usable_mmcf` (9.54, derived, fixed). Run `cfg` with `capacityMMcfd = p.rMMcfd`. For any
run: `idx = pressureIndex(run.hours.map(h => h.systemMMcfh), p)` (index[t] = P at the **end** of hour t) and
`s = pressureSummary(idx, p)`. The selected plan's run is `replanRun(...).run` under forecast planning (default:
re-plan at hour 0 and on each new forecast run, drift thresholds `Infinity`, buffer `forecast_buffer_sigma_default`
0.75σ; H1 contract msg 244). Under Observed weather it is `runPlan` of the `solvePlan(..., { pressure: p })` plan.
Every pressure number is labeled **derived** and "modeled". Never psi, never Enstar telemetry.

| On screen | Source | Format | Note |
| --- | --- | --- | --- |
| Verdict: lowest pressure | `s.minIndex` (selected plan, large; No program, small) | index points, 0 dp | green ≥ reserve, amber 0 to reserve, red < 0 |
| Verdict: hours below the line | `s.hoursBelowZero` | h | |
| Verdict: discomfort | `run.totals.degreeHoursBelowNormal` | °F·h/home, 0 dp | equals Σ `discomfortSeries(run, baseline, cohorts, cfg).meanF` (within 1%) |
| Discomfort in words | °F·h ÷ hours where any cohort `mode === 'holding'` | "about X°F cooler across N setback hours", °F 1 dp | do not divide by 24: Stress would read as a 16.8°F setback |
| Status sentence | `s.hoursBelowZero`, `s.curtailedMMcf` (MMcf 1 dp), `s.reserveHeld` (0 dp) | Section 4.1 sentences | "Above the line; X of the 10-point reserve held" uses `reserveHeld` |
| Curtailed gas | `s.curtailedMMcf` | MMcf, 1 dp in captions | clamped replay (H1 contract msg 201): curtail just enough each hour to keep linepack ≥ 0; never compute it from the chart minimum |
| Chart 1 tooltip "X MMcf would have to be curtailed by this hour" | `curtailedSeriesMMcf(idx, p)[t]` | MMcf, 1 dp | cumulative, same accounting |
| Chart 1 markers | `s.firstBelowHour` (No program), `s.minHour` / `s.minIndex` (selected) | clock label of the end of hour t | |
| Chart 1 "planned" dotted line | latest segment's `expectedIdx` | index | additive field on each `replanRun` segment |
| Chart 2 forecast, band, planning line | segment `forecastF`, `sigmaF`, `planningOutdoorF` | °F, 1 dp | re-plan ticks at segment `fromHour`, reason `forecast` |
| Chart 3 | `discomfortSeries(run, baseline, cohorts, cfg)`: `meanF` (area), `worstF` (coldest home type) | °F below preferred | baseline = `runPlan(planBaseline)` |
| Minimum indoor | min over hours of `hours[h].minTaF` | °F, 1 dp | includes normal night setpoints (64°F) |
| Plan chip | segment 0 `runIso` / mode | text | "Plan uses observed weather" when there are no runs or mode is OBSERVED |

Today (2026-10-04 05:55 ET, `main` d79dbda; feb2024, 25,000 homes, floor 62°F, max setback 5°F, 6% overrides, reserve
10, W 9.54). Columns: min P @ hour | hours below 0 | first below | hours in reserve band | curtailed MMcf | °F·h/home |
setback hours | min indoor °F.

| Preset | Plan | Values |
| --- | --- | --- |
| Near-miss (lost 11.5, R 266.5) | No program | −6.9 @69 · 3 · 68 · 3 · 0.66 · 0 · 0 · 64.0 |
| | Naive 4-hour | −4.6 @69 · 2 · 68 · 4 · 0.44 · 46 · 12 · 64.0 |
| | Staggered | 4.1 @69 · 0 · – · 4 · 0 · 311 · 72 · 62.0 |
| | Optimized, observed weather | 10.4 @69 · 0 · – · 0 · 0 · 75 · 17 · 64.0 |
| | **Optimized, re-plan default** | **10.2 @69 · 0 · – · 0 · 0 · 105 · 22 · 62.0**; 17 segments (start + 16 new-forecast re-plans) |
| Stress (lost 28.5, R 249.5) | No program | −420.9 @93 · 71 · 19 · 5 · 40.15 · 0 · 0 · 64.0 |
| | Naive 4-hour | −414.3 @93 · 71 · 19 · 5 · 39.52 · 46 · 12 · 64.0 |
| | Staggered | −378.2 @93 · 69 · 19 · 4 · 36.08 · 311 · 72 · 62.0 |
| | Optimized, observed or re-plan | −360.9 @93 · 67 · 20 · 4 · 34.43 · 402 · 90 (re-plan 91) · 62.0 |

Near-miss = 11.5 is `coverageTable` on feb2024 at 25,000 homes: the largest loss (0.5 steps) where the observed-weather
plan holds the full reserve. lastwinter allows 26; design holds at no loss. `presets.test.ts` pins these and the
re-plan default, so the gate fails if a data or model change breaks the demo's claims.

## `/home` pressure line

`pressureIndex(aggregate_hour.system_mmcf in hour order, { rMMcfd: sim_config.capacity_mmcfd, wMMcf: linepack_usable_mmcf,
reserveIdx })`, then take the last completed hour. WEB sends R through `set_params` after every load, so
`capacity_mmcfd` holds R. Show it as "System pressure: N, above the curtailment line" (0 dp, derived, modeled). It matches
the console's live line at the same simulated hour.

## `/validation` forecast error

Read `data/forecast_error.json` (derived): per scenario and pooled, mean error and RMSE (forecast − observed, °F) at
6, 12, 24, 48, 72 h with counts. Print its `method` and `scope` verbatim. `forecast_rmse_f` (constants) is the pooled RMSE
the planner uses when a run has no σ.

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

## Gas details drawer and `?ui=gas` (formerly the `/ops` KPIs, W3)

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
