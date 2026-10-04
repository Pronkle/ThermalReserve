# How Thermal Reserve works: modeling, planning, and what the screens show

This document explains the science behind Thermal Reserve: why we built it, how the model and the dispatch planner
work, what every chart and control on the operator console and the household app means, and what the results are.
Every number below comes from `data/constants.json`, `data/cohort_spec.json`, the scenario files in `data/scenarios/`,
or a model function in `packages/model`. Each one is labeled **sourced** (a published figure), **derived** (computed
from sourced figures), or **assumed** (our modeling choice). Figures reflect `main` on 2026-10-03; if DATA updates a
constant, the app and the tests recompute from it.

**Oct 4 pressure overhaul.** The operator console now leads with a modeled **pipeline pressure index** instead of
daily gas volumes, and the optimizer plans against the hourly gas balance of the pipes. Sections 2.8–2.10 and 3.0
describe the new model, optimizer, forecasts and screen; the gas-volume material in Sections 2.3–3.7 still applies to
the "Gas details" drawer and to `/ops?ui=gas`. Pressure figures are from `main` at `d79dbda` (ENGINE msg 198; H1's
re-plan decision, msg 244).

Contents:
1. [Motivation and purpose](#1-motivation-and-purpose)
2. [Process: how the model works](#2-process-how-the-model-works)
3. [Solution: what the operator sees and controls](#3-solution-what-the-operator-sees-and-controls)
4. [Solution: what the participant gives and sees](#4-solution-what-the-participant-gives-and-sees)
5. [The what-if calculator and the validation page](#5-the-what-if-calculator-and-the-validation-page)
6. [Impact and results](#6-impact-and-results)
7. [Where it lives in the code](#7-where-it-lives-in-the-code)

---

## 1. Motivation and purpose

**The problem.** Southcentral Alaska heats with natural gas from the Cook Inlet basin, and the basin is running down.
Enstar told legislators this winter may be about **3 Bcf** short, roughly 18 days of supply (sourced). The sharper
risk is not the seasonal total but the coldest days. Demand peaks during multi-day cold snaps, the record was
**268 MMcf in one day** in early 2024 (sourced), and on such days the system can run out of *deliverability*, the
rate at which gas can be pulled from wells and storage. A 2024 storage-well failure cut deliverability by
**28.5 MMcf/day** (sourced). Enstar's contracted "needle peak" supply for the very coldest days is about
**20 MMcf/day** (sourced). When delivery runs short, businesses are curtailed before homes.

**The idea.** Smart thermostats can turn heat down a few degrees across many homes at once ("demand response").
Programs like this exist elsewhere, but they were built for short events, and short events have a catch: when the
setback ends, every house reheats at once. That **snapback** pays back much of the saving later the same day. Con
Edison measured that about **52%** of the calculated saving was lost to snapback (sourced). A cold snap in Anchorage
lasts days, not hours, and the limit is on daily delivery.

**Our purpose.** Thermal Reserve is software that plans and dispatches **multi-day, snapback-aware thermostat
setbacks** across a simulated fleet of Anchorage homes. It answers the operator's real question: *what is the least
discomfort, spread across which homes and hours, that keeps total gas demand under the delivery limit, counting the
reheating that follows?* It shows the honest answer, including when the fleet cannot close the gap.

What it is not: it does not control real thermostats (we simulate; real control is future work), it does not solve
the seasonal 3 Bcf shortfall, and we make no claim about how many Anchorage homes have smart thermostats today (no
such figure exists).

---

## 2. Process: how the model works

The model has five layers, each feeding the next:

```
 homes (24 cohorts) ──► physics (two-node heat model) ──► strategies & LP planner ──► fleet + system gas
        ▲                        ▲                                  ▲                        │
   calibration             validation                  scenario weather + demand        charts, KPIs,
  (Anchorage gas use)   (ConEd, SoCalGas pilots)       + daily capacity                 live simulation
```

### 2.1 The fleet: 24 kinds of homes

We do not simulate 25,000 homes one by one. We simulate **24 cohorts**, each a representative home type, and weight
them by their share of the fleet. The cohorts are every combination of four factors (`data/cohort_spec.json`, all
assumed):

| Factor | Options and shares | What it changes |
| --- | --- | --- |
| Heating | furnace 70% (efficiency 0.85), boiler 30% (0.82) | appliance efficiency, air heat capacity, max heat output |
| Schedule | night setback 40% (64°F, 22:00–06:00), steady 60% (70°F all day) | the normal setpoint over the day |
| Envelope | tight 25% (×0.75 heat loss), average 50% (×1.00), leaky 25% (×1.35) | how fast the home loses heat |
| Mass | light 60% (time constant 40 h), heavy 40% (60 h) | how much heat is stored in walls and contents |

A cohort's share is the product of its four factor shares (shares sum to 1). Daytime setpoint is 70°F for everyone.

**Calibration to Anchorage.** The one number that sets how much gas a home uses is its total heat-loss rate, **UA**
(BTU per hour per °F of indoor-outdoor difference). We derive the fleet-average UA from real consumption:

```
UA = avg home gas (149 Mcf/yr, sourced) × space-heat share (0.75, assumed) × heat content (988 BTU/cf, sourced)
     × furnace efficiency (0.85, assumed) ÷ (24 h × annual heating degree days (9,818.5 °F·day, derived from ACIS))
   = 398.3 BTU/(h·°F)  (derived)
```

The envelope multipliers are renormalized so the share-weighted average UA equals exactly this value. Across
cohorts, UA ranges from about 291 to 525 BTU/(h·°F). Exempt homes (8%, assumed: someone needs steady heat) are
excluded from any setback and counted as ordinary demand.

### 2.2 The physics: a two-node heat model

Each cohort is a house with two temperatures: the **air** (Ta, what the thermostat reads) and the **mass** (Tm: walls,
floors, furniture). Heat flows like current in a circuit:

```
Ca · dTa/dt = Q  +  Uao·(To − Ta)  +  Ham·(Tm − Ta)      air:  furnace heat in, leaks out, trades with the mass
Cm · dTm/dt =       Umo·(To − Tm)  +  Ham·(Ta − Tm)      mass: leaks out slowly, trades with the air
```

| Symbol | Meaning | Average furnace home (steady, average envelope, light mass) |
| --- | --- | --- |
| Q | furnace heat delivered, BTU/h, between 0 and Qmax | Qmax ≈ 62,200 BTU/h |
| To | outdoor temperature, °F | from the scenario, hour by hour |
| Uao | air-to-outdoors loss, half of UA | 194 BTU/(h·°F) |
| Umo, Ham | mass-to-outdoors loss and air-mass coupling, chosen so the steady-state loss equals UA | 291 and 583 BTU/(h·°F) |
| Ca | air heat capacity (tuned) | 1,500 BTU/°F (boilers: 3,000) |
| Cm | mass heat capacity = time constant × UA | 15,500 BTU/°F |

Why two nodes: a single-temperature model cannot produce snapback correctly. When the thermostat drops, the air
cools fast but the mass cools slowly; when the setback ends, the furnace must reheat both. The mass is the "battery"
that makes long setbacks pay off and short ones disappoint.

**Exact solution, not approximation.** With heat and outdoor temperature held constant over a step, the equations
are linear, so we solve them exactly with a 2×2 matrix exponential (`physics.ts`). One hour for the average home:

```
[Ta]          [0.601  0.295] [Ta]
[Tm](t+1h) =  [0.029  0.951] [Tm](t)  +  (terms in Q and To)
```

The same exact update works for any step length, so twelve 5-minute steps equal one 1-hour step to within 0.01°F
(a test). The model runs at **5-minute sub-steps** everywhere a thermostat is simulated.

**The thermostat.** Because the update is linear in Q, the heat needed to reach (or hold) a setpoint by the end of
a step has a closed form (`heatToHold`), clipped to [0, Qmax]. A cooling house simply gets Q = 0 until it reaches its
lower setpoint; a recovering house gets up to Qmax. **Gas** is heat divided by efficiency and heat content:
`gas cf = Q × hours ÷ (efficiency × 988 BTU/cf)`.

### 2.3 System demand, scenarios and daily capacity

**Southcentral demand.** Daily system demand follows `D = a + b × HDD` (heating degree days, base 65°F), fitted
(`fitSystemDemand`) so January 2024 sums to the sourced 5.6 Bcf and the record day's HDD gives 268 MMcf:
a = 3.39 MMcf/day, b = 3.44 MMcf/day per HDD (derived). Each day's total is spread over 24 hours with an hourly shape
that peaks at 5.4% of the day around 07:00 (assumed, illustrative).

**Scenarios** (96 hours each: 12 h lead-in, 72 h cold event, 12 h easing). Replays use real Anchorage airport
temperatures from ACIS (sourced), interpolated hourly by an assumed cosine shape.

| Scenario | Dates | Coldest | Daily demand (MMcf) | Capacity |
| --- | --- | --- | --- | --- |
| `feb2024` (Demo preset) | Jan 31 – Feb 3, 2024 replay | −21°F | 254.3 · 257.7 · **268.0** · 261.1 | 265 MMcf/day |
| `design` | synthetic −20°F for 3 days | −25°F | 238.5 · 295.5 · 295.5 · 277.7 | 292.5 MMcf/day |
| `lastwinter` | Jan 2–5, 2026 replay | −16°F | 237.1 · 250.8 · 254.3 · 209.6 | 251.3 MMcf/day |

**Capacity is a daily limit** (H1-approved contract). Each scenario's capacity is a labeled hypothetical: 3 MMcf/day
below its peak day. A gas day is each 24-hour block from scenario start, and the rule is *total system demand that
day ≤ capacity*. Swings within the day are absorbed by pipeline linepack and storage (assumed). We first tried an
hourly limit (capacity ÷ 24 every hour). The morning peak alone exceeded it by about three times what the whole
fleet uses, so the shortfall banner was always on and the planner chased hours it could never fix. The daily rule
matches how delivery limits actually bind.

**Non-enrolled demand.** Everything in the system that is not an enrolled, non-exempt home: the scenario's system
demand minus the enrolled fleet's no-program gas. Changing the enrollment slider never changes total system demand;
it only changes how much of it the program can influence.

### 2.4 The five dispatch strategies

Every strategy produces a **plan**: a target indoor temperature for each cohort and hour (blank = normal setpoint).
The simulator then follows the plan with the thermostat logic above, and clamps every target to
[comfort floor, normal setpoint].

| Strategy | What it does | Why it's there |
| --- | --- | --- |
| **No program** (BASELINE) | everyone at their normal setpoint | the reference every saving is measured against |
| **Naive morning setback** (NAIVE_4H) | −4°F from 06:00 to 10:00 each event day | what a typical short-event program does; shows snapback |
| **Staggered** (SUSTAIN_STAGGER) | full allowed depth for the whole event, cohort start and end times staggered over 3 hours | a sensible rule-based plan; also the fallback if the solver fails |
| **Optimized** (LP, below) | the least discomfort that keeps each gas day under capacity | the product |
| **Max relief** (LP) | the most net gas saved within the depth and floor limits | shows the fleet's ceiling |

### 2.5 The optimizer: a linear program

The Optimized and Max relief plans come from a linear program (`lp.ts`) solved with **HiGHS**, an open-source solver
compiled to WebAssembly. It runs in the operator's browser in a background Web Worker, so the page never freezes.

**Variables**, per cohort c and hour t: indoor air temperature `ta[c,t]`, mass temperature `tm[c,t]`, furnace heat
`q[c,t]`; plus one slack `s[d]` per gas day (shortfall the fleet cannot cover). For 24 cohorts × 96 hours that is
about 7,000 variables.

**Constraints:**
- *Physics:* `[ta, tm](t+1) = A·[ta, tm](t) + Bq·q(t) + Bo·To(t)`, the exact hourly discretization of Section 2.2.
- *Comfort:* `max(floor, normal − max depth) ≤ ta ≤ normal`. Two refinements keep physics honest: the bounds follow
  what the house can actually reach (after a night setback it cannot jump back to 70°F in one hour, and a heavy house
  cannot cool to 64°F the instant the night schedule starts), so the LP never forces or invents a setback.
- *Heat:* `0 ≤ q ≤ Qmax`.
- *Daily capacity:* for each gas day d,
  `Σ_hours [ Σ_cohorts homes × ((1 − o_t) × gas(q) + o_t × normal gas) + non-enrolled demand ] − s[d] ≤ capacity`,
  where `o_t` is the expected share of homes that have overridden by hour t (the 6% override rate, assumed: set equal to a sourced co-op pilot figure, spread
  over the event). Overridden homes burn normal gas, so the plan does not promise relief that overrides will take
  back. The LP plans against capacity minus 0.02%, a margin that covers the difference between its hourly steps and
  the simulator's 5-minute steps.
- *Terminal recovery:* every home is back within 0.5°F of normal at the end of the scenario.

**Objective:**
- **Optimized:** minimize `Σ homes × (normal − ta)` (degree-hours of discomfort, weighted by how many homes feel it)
  `+ 100,000 × Σ s` (uncovered shortfall per Mcf: a last resort; covering 1 Mcf by setback costs about 2,200
  home-degree-hours, so the solver always prefers setbacks over shortfall) `+ a tiny gas term` (avoids needless heat).
- **Max relief:** the discomfort and gas weights swap; gas saved dominates.

Because the constraint is daily and the physics includes reheating, **the optimizer schedules snapback onto days
with spare capacity**. That is the "snapback-aware" part: it is not an add-on, it falls out of modeling the reheat
and the daily limit together.

**Robustness.** If HiGHS reports anything other than an optimal solution, it retries with presolve off and then with
the interior-point method. If that fails or takes longer than 5 seconds, `solvePlan` returns the Staggered plan with
the note "Rule-based fallback", and the console shows a banner saying so. A sweep of 486 slider combinations (all
scenarios, both modes, extremes of homes, floor, depth and capacity) never fell back; the slowest solve took 225 ms.

### 2.6 Running a plan: the simulator and the live clock

`runPlan` advances every cohort through the scenario in 5-minute sub-steps, with **two twins** per cohort: an
*actual* twin that follows the plan and a *baseline* twin that follows the normal setpoint from the same start.
Relief is always baseline-twin gas minus actual gas, so it automatically includes snapback. Each hour it reports
fleet gas, baseline gas, system demand, minimum indoor temperature, share of homes held at the floor, overrides,
and each cohort's state (holding, recovering, normal).

Fleet gas for an hour: `Σ_cohorts enrolled × share × (1 − exempt) × [(1 − overridden) × actual gas + overridden ×
baseline gas]`. Discomfort (degree-hours) is measured against the baseline twin, so normal night setbacks don't count
as program discomfort.

**The live simulation** runs the same algorithm inside a SpacetimeDB module on Maincloud. Physics code is shared
byte-for-byte (`npm run sync-physics`), and a scheduled tick advances the clock (2 simulated hours per real second in
the demo). Two differences are deliberate:
- overrides come from the 1,000 sample homes on the map (each has an override hour) instead of an expected ramp;
- when homes override, the depth they gave up is **reassigned** to participating homes, never past max depth or the
  floor.

A repository test re-implements the tick loop step for step and checks it matches `runPlan` within 1% every hour at
0.5–4 h/s. On the live database, an Optimized run tracked the solved plan within **0.43%** on all 96 hours.

### 2.7 Validation: does the model reproduce real pilots?

Before trusting the model for Anchorage, we ran it under published pilot conditions (`validation.ts`). We tuned only
three physically meaningful parameters, each inside a stated range: air heat capacity (Ca, 1,500–8,000 BTU/°F),
air-mass coupling (Ham, 1–6 × UA), and mass time constant (τ, 15–60 h).

| Check | Conditions | Model | Published / band | Result |
| --- | --- | --- | --- | --- |
| ConEd-like | 30°F outdoors, 70°F, −4°F 06:00–10:00 | **0.465** of event-hour saving kept over the day | 0.48 (1 − 52% snapback); band 0.38–0.58 | **Pass** |
| SoCalGas-like | 45°F, 68°F, −4°F 06:00–10:00; response rate fitted to the 15.1% event-hour cut | **1.14%** net daily reduction (r = 0.30) | 2.2% published; band 1.5–3.0% | **Gap, reported** |
| Anchorage sanity | −20°F, 70°F, no setback | **1.04** Mcf per home per day | steady-state UA × 90 × 24 ÷ (η × HHV) | consistent |

**The gap, stated plainly.** ConEd's data implies about half the saving is lost to snapback; SoCalGas's implies far
less (about 87% kept). One physical house model cannot match both under these test conditions; the best reachable
SoCalGas figure inside the allowed ranges was about 1.35%. We kept the tuning that matches ConEd closely and report
the SoCalGas gap. Our net-savings numbers therefore lean **conservative**.

---

### 2.8 Pipeline pressure: why the coldest evening is the risk (Oct 4)

On a cold day Southcentral's gas system fails on **pressure**, not on the season's total. Cold raises demand by about
**3.44 MMcf/day per °F** of daily mean temperature (derived, `system_fit.json` b). Wells and storage can deliver only
so fast: on the Feb 2024 record evening CINGSA storage was maxed out and Hilcorp could add only about **10 MMcf** more
(sourced, approximate; ADN, Feb 6, 2024). When demand outruns delivery, the gas stored in the pipes (linepack) drains
and pressure falls across one shared system (Alaska Beacon, Jul 28, 2026). Low pressure forces curtailment by tariff
order, large users and power plants first and homes last (Enstar tariff §1220b), and losing pressure in an area
means shutting off and relighting every customer (Aquidneck Island, RI, 2019: 7,455 customers, about a week; sources
in `docs/sources.md`).

**The pressure index** (`packages/model/src/pressure.ts`). Hour by hour, with inflow u, demand D (MMcf/h) and
linepack L (MMcf):

```
L[t+1] = L[t] + u[t] − D[t]      0 ≤ u[t] ≤ R/24      L ≤ W      L[0] = W
P[t]   = 100 × L[t] / W          (index[t] = P at the end of hour t)
```

- **R**, the maximum delivery rate: `R = 278 − lost` MMcf/day. 278 (`deliverability_2024_mmcfd`, derived) is the
  modeled Feb 2024 peak gas day, 268.0, plus the ~10 MMcf/day headroom. `lost` is the operator's "deliverability
  lost compared with Feb 2024" slider.
- **W**, usable linepack: **9.54 MMcf** (`linepack_usable_mmcf`, derived by `usableLinepackMMcf`): the smallest
  buffer that absorbs a normal day's hourly demand shape at 278 MMcf/day. Fixed; never recomputed from the slider.
- Inflow throttles only when the pipes are full: `u = min(R/24, W − L + D)`.
- **100 = full, 0 = curtailment begins.** The chart does not clamp below zero: a negative P means gas that would have
  to be curtailed by then. On-screen label: "Pressure index: modeled linepack margin. 100 = full, 0 = curtailment
  begins. Not psi and not Enstar telemetry."
- **Curtailed gas uses clamped accounting** (`[CONTRACT]` msg 201): replay the same series, curtailing just enough
  each hour to keep linepack at 0, and add those amounts (`pressureSummary.curtailedMMcf`,
  `curtailedSeriesMMcf`). With one episode below zero this equals its deepest deficit; with several it does not count
  the same gas twice.
- **The reserve** (`reserve_default_idx`, 10 points, assumed): a margin above the line that covers the difference
  between the hourly plan and the 5-minute simulation (minimum 5, `reserve_min_idx`).

**Discomfort** (`discomfortSeries`): each hour, degrees below each home's own no-program temperature, averaged over
enrolled homes, so normal night setbacks never count. Totals are in °F·h per home; for example 72 °F·h is about 1°F
cooler on average across a three-day cold snap.

### 2.9 The pressure-mode optimizer

`solvePlan(..., { pressure })` keeps the same house dynamics, comfort floor and setback limits as Section 2.5, but
replaces the daily capacity rows with an **hourly linepack balance**. For every hour t from the plan's start:

```
lp[t+1] = lp[t] + u[t] − fleet gas[t] − non-enrolled demand[t] − override terms[t] + c[t]
0 ≤ lp ≤ W      0 ≤ u ≤ R/24      lp[t+1] + r[t] ≥ reserve      c, r ≥ 0
objective = discomfort (as before) + 1e5 × Σ c  (curtailment)  + 1e4 × Σ r  (dipping into the reserve)
```

The fleet, override and non-enrolled terms are exactly the gas terms of the daily LP. The weights rank the goals:
first avoid curtailment, then hold the reserve, then minimize discomfort (`[CONTRACT]` msg 195 raised the reserve
weight from 1e3 to 1e4 so Near-miss holds the full reserve). Hourly curtailment is returned in
`Plan.shortfallMMcfh`. On failure or timeout the console falls back to the staggered rule-based plan and says so, as
before. ENGINE's sweep of 972 combinations (3 scenarios, 5k/25k/50k homes, floors, depths, losses, reserves, both
modes) had 0 fallbacks and a worst solve of 453 ms in Node.

### 2.10 Forecasts and re-planning

A real operator plans with forecasts, not with the weather that later happened. The two replays carry
`forecastRuns`: 21 archived National Blend of Models runs each (NBS to ~72 h, NBE beyond), for Anchorage airport
(PANC), from the Iowa Environmental Mesonet MOS archive (sourced; raw files in `data/raw/iem_mos_*.json`). Each run's
forecast daily highs and lows go through the same cosine curve as the observed series; its spread (`sigmaF`, 2–7°F)
comes from the forecast's own standard deviation. `design` gets constructed runs (assumed: 3°F too warm at 72 h,
shrinking to 0).

- **Planning weather** (`planningScenario`): observed temperatures before the plan's start; after it, the newest
  run available, minus a cold buffer of `bufferSigma × sigmaF`. Demand is shifted by the temperature difference times
  3.44 MMcf/day per °F, so a perfect forecast reproduces the observed scenario exactly.
- **Default policy** (H1, msg 244): re-plan at hour 0 and whenever a new forecast run arrives (every 6 simulated
  hours, `replan_interval_h`), with the drift triggers off, at a **0.75σ** buffer (`forecast_buffer_sigma_default`,
  assumed, chosen on the feb2024 replay and not validated on another winter). Each segment starts from the house
  states and pressure that the plan so far produced against **actual** weather (`replanRun`). The full schedule is
  precomputed in the browser at Solve time and dispatched to the live clock segment by segment.
- **Why not one plan up front:** a single plan from the hour-0 forecast goes below zero on the real Feb 2024
  forecasts, which ran warm (day 3 mean −7.4°F forecast at hour 0 vs −12.0°F observed). So the claim is
  "re-planned as each new forecast arrived", never "sized before the cold snap".
- **Forecast error** (`data/forecast_error.json`, `forecast_rmse_f`): pooled RMSE of forecast daily highs and lows
  against ACIS, 2.72 / 3.98 / 3.73 / 4.67°F at 12 / 24 / 48 / 72 h (derived; small samples; no samples at 6 h, which
  takes the 12 h value). Shown on `/validation`.
- **Known limit:** the replays' hour-by-hour temperatures are an assumed cosine curve through each day's observed high
  and low. Against the airport's hourly observations that curve is off by about 6°F RMSE on feb2024, and with real
  hourly data re-planning holds about 8 of the 10 reserve points instead of 10 (`docs/qa.md` #26). H1 kept the curve.

## 3. Solution: what the operator sees and controls

The operator console (`/ops`) is built for a utility operator on a laptop (1280×800 and up).

### 3.0 The pressure console (Oct 4)

`/ops` now stacks three charts on one clock, with the map, presets, controls and event log on the right:

1. **System pressure**: No program (gray, dashed), Naive 4-hour (amber, dashed), Staggered, Optimized (blue) and the
   Live line, with a red line at 0 ("Curtailment begins") and an amber reserve band from 0 to the reserve. Hovering
   below zero shows how much gas would have to be curtailed by that hour.
2. **Outdoor temperature**: actual (white), the forecast in use (blue dashed, ±1σ band, stepping at each re-plan)
   and the planning line (forecast minus buffer, amber dotted).
3. **Home discomfort**: °F below each home's own no-program temperature, average and coldest home type, with the
   max setback as a dashed line.

Above them a **verdict strip** shows lowest pressure, hours below the line and discomfort (°F·h per home) for the
selected plan, with No program small beside it, plus a chip with the planning basis ("Plan from forecast issued …" /
"Plan uses observed weather"). A **status sentence** replaces the shortfall banner, for example "Above the
curtailment line for the whole cold snap" or "Below the curtailment line for 3 hours: about 0.4 MMcf would be
curtailed, businesses first". The old gas charts and KPIs live in the collapsed **Gas details** drawer, and
`/ops?ui=gas` renders the previous console unchanged.

**Presets** (`data/presets.json`), both on the feb2024 scenario with 25,000 homes and a 10-point reserve:

| Preset | Lost vs Feb 2024 | No program | Optimized | Story |
| --- | --- | --- | --- | --- |
| Near-miss | 11.5 MMcf/day (largest loss at which 25,000 homes hold the full reserve) | min −6.9 at hour 69, 3 h below, 0.66 MMcf curtailed | observed weather: min +10.4, 0 h below, 75 °F·h/home; re-planned on forecasts (default): min 10.2, 105 °F·h/home, 16 re-plans | Nobody gets cut off |
| Stress | 28.5 MMcf/day (the 2024 storage-well failure) | 40.15 MMcf curtailed | 34.43 MMcf curtailed (Staggered 36.08), 402 °F·h/home | Fewer customers cut, not none |

The deliverability slider's tick marks come from `data/deliverability_ticks.json`: 0 (Feb 2024 as it happened),
11.5 (Near-miss), 20 (needle-peak contract), 28.5 (2024 storage-well failure). On `/home`, a line under the live card
shows the live pressure index ("System pressure: 34, above the curtailment line").

### 3.1 Header and banners

- **Product name, scenario name, simulated clock** (for example "Wed, Jan 31, 06:00", Anchorage time), status
  (preview / connected / running), and a **QR code** that opens the household app on a phone.
- **Banners:** "Uncovered shortfall: X MMcf/day" (the worst gas day's demand above capacity under the current plan),
  "Rule-based fallback in use" (the solver fell back to Staggered), "Disconnected — retrying" (live connection lost).

### 3.2 The map

1,000 sample homes placed around 12 weighted neighborhood anchors (Downtown, Midtown, Spenard, Eagle River, Wasilla,
Palmer, Kenai and others), deterministic from seed 42, kept off water by an OpenStreetMap water mask. **Each dot
represents enrolled homes ÷ 1,000** (25 homes at 25,000 enrolled, assumed). Color and outline show state: normal
(neutral), holding a setback (ice blue), recovering (amber), overridden (gray outline), exempt (hollow). Real
households who joined by phone appear as larger pulsing dots with their nickname.

### 3.3 The Fleet chart

*What it answers:* how much gas do the enrolled homes use, hour by hour, under each strategy?

- **x-axis:** simulation time, labeled with Anchorage clock time; the shaded band is the cold event.
- **y-axis:** enrolled fleet gas in **MMcf per hour**.
- **Lines:** *No program* (gray), *Naive morning setback* (amber, dashed), the selected plan (*Staggered*,
  *Optimized* or *Max relief*, blue), and **Live** (thick blue, drawn from the running simulation up to the current
  hour, tracing over the planned line).
- **How to read it:** where a line dips below gray, homes are saving gas. Where the amber line jumps **above** gray
  right after 10:00, that is snapback: the naive setback's reheating spike (its largest rebound in the demo is
  0.21 MMcf/hour above normal). The caption gives the whole-run net saving and notes that it includes recovery.

### 3.4 The System chart

*What it answers:* is all of Southcentral Alaska under its delivery limit, day by day?

- **y-axis:** total system demand in MMcf per hour.
- **Lines and areas:** demand *without program* (gray), demand *under the plan* (blue), the gap between them shaded
  green (relief), and a dashed line at **daily capacity ÷ 24 (average)**. Because capacity is daily, an hour above the
  dashed line is not by itself a problem; a whole **gas day shaded red** means that day's total exceeds capacity.
- The caption states that within-day swings are covered by linepack and storage (assumed).

### 3.5 The KPI strip

Each KPI has a label chip and a tooltip with its formula and source.

| KPI | Definition |
| --- | --- |
| Relief on tightest day (MMcf/day) | baseline minus actual enrolled-fleet gas on the gas day with the largest no-program shortfall (includes that day's recovery, exemptions and overrides) |
| Peak-hour relief (MMcf/hour) | baseline minus actual fleet gas in the event hour with the highest system demand |
| Minimum indoor (°F) | coldest cohort indoor temperature at the current hour (normal night setpoints of 64°F count) |
| Homes at floor (%) | share of homes the program is holding at the comfort floor right now |
| Overrides (homes) | homes that have opted out of the current event |
| Gas value ($/day) | tightest-day relief × 1,000 × $17.50/Mcf (sourced marginal price), rounded to $100 |

We deliberately headline the **tightest day**, not a multi-day average. The Optimized plan concentrates relief where
capacity binds and lets snapback land on a day with room, so its multi-day average looks smaller than the rule-based
plan's even though it covers more of the actual shortfall (Section 6).

### 3.6 Event log

A time-stamped feed: plan **dispatch**, household **join**, **override** (simulated and real), **reassign** (lost depth
moved to other homes, with the extra degrees), and **system** events (a gas day closed over capacity, run finished).

### 3.7 Operator controls (parameters the operator gives)

| Control | Range | Default (Demo preset) | What it changes in the model |
| --- | --- | --- | --- |
| Scenario | design, feb2024, lastwinter | feb2024 | weather, system demand, event window, default capacity |
| Strategy | No program, Naive morning setback, Staggered, Optimized, Max relief | choose Optimized, then Solve plan and Dispatch | which plan is previewed and dispatched |
| Enrolled homes | 1,000–50,000, step 1,000 | 25,000 | fleet size; non-enrolled demand adjusts so system demand is unchanged |
| Max setback | 2–10°F | 5°F (assumed) | how far below normal any home may be held |
| Comfort floor | 60–66°F | 62°F (assumed) | lowest indoor temperature for simulated homes; real households are never held below 62°F (enforced on the server) |
| Daily capacity | scenario capacity ± 30 MMcf/day | scenario's value (hypothetical) | the delivery limit per gas day |
| Speed | 0.5–4 simulated hours per second | 2 h/s | live clock rate (display only; physics is unchanged) |

**Buttons:** *Demo preset* (loads feb2024, 25,000 homes, 1,000 sample homes, floor 62°F, depth 5°F, speed 2,
idle at hour 0), *Solve plan* (runs the LP in the background and shows the elapsed time), *Dispatch* (sends the
plan to the live database), *Start / Pause / Reset* (live clock), *Reset households* (removes phone households),
*Apply inputs* (pushes slider changes to the live run). Overrides (6% of homes per event, assumed: set equal to the sourced 6% winter opt-out rate of an electric co-op smart-thermostat pilot)
and exempt share (8%, assumed) come from `constants.json`.

---

## 4. Solution: what the participant gives and sees

The household app (`/home`) is a phone page a judge reaches by scanning the console's QR code.

### 4.1 What the participant gives (three taps)

1. **Join as an Anchorage home.**
2. **Home details:** nickname (optional, up to 24 characters; defaults to "Home 1234"), heating type (furnace, boiler,
   other), thermostat brand (Nest, ecobee, Honeywell, other, none), and a checkbox **"Someone here needs steady heat
   (infant, elderly, medical)"**, which makes the home **exempt**: it is never set back.
3. **Consent:** "During a gas emergency your heat may be lowered up to N°F, never below 62°F. Override any time."
   N is the operator's max setback; the floor shown is the household's own floor.

Then, at any time: **Override** (normal heat restored immediately; the button becomes **Rejoin event**).

**How a household is modeled.** The server gives it a template cohort matching its heating type (steady schedule,
average envelope, light mass; "other" uses furnace) and simulates its own air and mass temperatures and a baseline
twin with the same physics. It follows its cohort's plan target, except it is held at normal heat if exempt or
overridden, and never below its 62°F floor. Its dot appears on the operator map within about 2 seconds of joining.

### 4.2 What the participant sees

| On the card | Meaning |
| --- | --- |
| Indoor °F (large) and setpoint | the household's simulated air temperature and current target |
| Status | Normal, Holding −X°F (X = degrees below normal), Recovering, Exempt, or Overridden |
| Sim clock and countdown | simulated time and time left in the event (the demo clock runs at 2 h/s) |
| Net gas saved this event (cf) | baseline-twin gas minus actual gas since joining. It **rises while holding and falls while the home reheats**; the caption says so |
| Gas value | saved cf ÷ 1,000 × $17.50, labeled "Gas value, not a bill credit" |
| Community today | relief so far on the current gas day against **today's relief target** = that day's no-program demand minus capacity (hidden on days with no shortfall) |
| Why this matters | businesses are curtailed before homes; your saving helps keep gas available for them |

Expected size: over the feb2024 demo a household saves about 95 cf on the tight day and about 64 cf net over the
run, roughly $1.10. Per-home numbers are small by design; the point is the community total. In the in-person phone
test, the two real households finished the run at about **63 cf** each, matching the model.

---

## 5. The what-if calculator and the validation page

**What-if (`/whatif`)** is a public, steady-state calculator. Inputs: participation (0–50% of ~150,000 customers),
setback (1–10°F), outdoor temperature (−40 to 30°F), cold-snap length (1–10 days), and Tier 2 pledged homes (0–50%,
counted at 30% effectiveness, assumed). The core formula:

```
saved cf per home per day = UA × setback × 24 ÷ (efficiency × heat content)
                          = 398.3 × 5 × 24 ÷ (0.85 × 988) = 56.9 cf/day   (5°F setback)
```

It reports MMcf/day, % of the 20 MMcf/day needle peak, % of the 28.5 MMcf/day 2024 deliverability loss, % of the
3 Bcf shortfall over the chosen days, and dollars per day. "Show the math" prints every formula with its constants
and labels. A steady setback saves the same heat loss at any outdoor temperature while the furnace runs, so outdoor
temperature does not change the result; the page says so. This calculator ignores snapback; the console models it in
full.

**Validation (`/validation`)** shows the three checks of Section 2.7 as cards with pass / gap status, an event-day
chart for each (normal day versus event day, gas per home per hour, setback window shaded), the conditions used, and
a table of every tuned parameter with its allowed range.

---

## 6. Impact and results

### 6.1 Headline impact (steady state, derived)

| Enrolled homes | Setback | Gas freed up | Share of needle peak (20 MMcf/day) | Share of 2024 deliverability loss | Share of 3 Bcf over 20 cold days | Value |
| --- | --- | --- | --- | --- | --- | --- |
| 25,000 (16.7% of customers) | 5°F | **1.42 MMcf/day** | **7.1%** | 5.0% | 0.95% | about $24,900/day |

That is a meaningful slice of the coldest-day **delivery** problem and a small slice of the **seasonal supply**
problem, and we say both.

### 6.2 Demo results: the February 2024 cold snap

Demo preset: feb2024 replay, 25,000 enrolled homes, 5°F max setback, 62°F floor, 6% overrides. Only **Feb 2**
(268.0 MMcf against 265 capacity) is over the limit without a program: a 3.00 MMcf shortfall.

| Strategy | Relief on Feb 2 | Uncovered on Feb 2 | What happens next day (Feb 3) |
| --- | --- | --- | --- |
| No program | 0 | **3.00 MMcf** | |
| Naive morning setback | 0.20 | **2.80** | snapback eats most of the event-hour saving |
| Staggered (rule-based) | 1.31 | **1.69** | relief spread across all days, including days that didn't need it |
| **Optimized (LP)** | **2.06** | **0.94** | −0.65 MMcf snapback lands on Feb 3, which has 3.9 MMcf of headroom |
| Optimized, 50,000 homes | 3.09 | **0 (fully covered)** | −1.07 on Feb 3, still under capacity |

What the optimizer does: nothing on Jan 31 and Feb 1 (no shortfall), the full allowed setback from midnight to
midnight on Feb 2 (the warm-up heat stored in the houses is released when it's needed), and recovery after midnight
on a day that can absorb it.

**Why the headline is per day.** Over the whole 96 hours, the Staggered plan saves more gas in total (4.02 MMcf net,
311 home-weighted degree-hours) than the Optimized plan (1.41 MMcf, 106 degree-hours). But Staggered spends most of
its effort on days with no shortfall and still leaves 1.69 MMcf uncovered on the day that matters. Optimized covers
**57% more of the actual shortfall (2.06 vs 1.31 MMcf) with about a third of the discomfort**. A whole-run average would hide that, so the
console headlines the tightest day and shows the whole-run figure as secondary detail.

Comfort: no simulated home goes below the 62°F floor (minimum indoor in the Optimized run: 62.0°F, reached only by
night-schedule homes whose normal night setpoint is 64°F).

### 6.3 Validation and trust

- ConEd snapback reproduced (0.465 vs 0.48 target): **pass**. SoCalGas daily reduction 1.14% vs 1.5–3.0%: **a stated
  gap**, which makes our savings conservative. Anchorage gas use per home: 1.04 Mcf/day at −20°F, consistent with
  calibration.
- Live simulation matches the model: tick re-implementation within 1% (test); live Optimized run within 0.43% of the
  plan on all 96 hours; real phone households saved 63 cf versus 64 predicted.

### 6.4 Engineering results

| Measure | Result |
| --- | --- |
| LP size | 24 cohorts × 96 hours ≈ 7,000 variables |
| Solve time | about 0.1–0.4 s in Node and in the browser Web Worker (5 s budget) |
| Robustness | 486-combination sweep of operator inputs: no fallbacks, slowest 225 ms |
| Simulation speed | all three strategies for 96 hours in about 50 ms |
| Tests | 54 model tests (physics, fleet, strategies, LP, validation, worker, tick parity, real data); web and data suites separate |
| Shared physics | one `physics.ts` runs in the browser and inside the SpacetimeDB module unchanged |

### 6.5 Limits we state openly

- The fleet is 24 representative cohorts, not individual homes; cohort shares and many parameters are assumed.
- Capacity values are labeled hypotheticals; hourly demand shape is illustrative, not Enstar data.
- The SoCalGas check shows a gap; we did not widen parameter ranges or change test conditions to hide it.
- Real thermostat control, customer acceptance, and Anchorage smart-thermostat penetration are not modeled or claimed.
- The what-if calculator is steady state; snapback is modeled only in the console's simulation.

---

## 7. Where it lives in the code

| File | What it holds |
| --- | --- |
| `packages/model/src/physics.ts` | two-node model, exact discretization, thermostat (`heatToHold`), gas, setpoint schedule |
| `packages/model/src/fleet.ts` | cohort construction and calibration, sample homes, water mask |
| `packages/model/src/strategies.ts` | the rule-based plans, `runPlan` simulator, `gasDays` per-day view |
| `packages/model/src/lp.ts` | the linear program, HiGHS solve, retries and fallback |
| `packages/model/src/worker.ts` | running the solver in a browser Web Worker |
| `packages/model/src/demand.ts` | system demand fit and hourly shape |
| `packages/model/src/validation.ts` | ConEd, SoCalGas and Anchorage checks |
| `packages/model/src/whatif.ts` | the steady-state calculator and its formula lines |
| `packages/model/src/pressure.ts` | pressure index, usable linepack, curtailed gas (clamped), discomfort series, coverage table |
| `packages/model/src/forecast.ts` | forecast runs, planning weather with buffer, `replanRun` |
| `packages/model/NUMBERS.md` | every on-screen number mapped to its source, label and format |
| `stdb/src/index.ts` | the live simulation clock (`tick`), overrides, reassignment, households |
| `data/` | constants with sources, cohort spec, scenarios, system fit, anchors, water mask |
