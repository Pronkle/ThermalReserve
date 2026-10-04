# BoreaFlux: one-pager, draft 3

> Draft 3 by DATA (Oct 4): the pressure version in BoreaFlux colors. Drafts 1 and 2 are kept (`onepager*.md`, `.html`, `.pdf`). Print layout: `onepager-v3.html` → `onepager-v3.pdf` (one Letter page; every link checked, all returned HTTP 200 on Oct 4). Numbers: `packages/model/NUMBERS.md` "Today" table and `data/constants.json`.

## BoreaFlux

**Thermostat setbacks planned against modeled pipeline pressure, so Southcentral Alaska's gas grid stays above the curtailment line on the coldest evenings.**

Try it: [boreaflux.vercel.app](https://boreaflux.vercel.app) · join as a household at [/home](https://boreaflux.vercel.app/home) (QR code: `apps/web/public/household-join.svg`, verified to encode that URL) · MHacks 2026

### The problem

- On the record cold evening of Jan 31, 2024, Enstar told lawmakers it came "extremely close" to being unable to deliver gas: storage was maxed out and Hilcorp could add only about 10 million cubic feet more. [1]
- Southcentral runs on one pressurized system of pipes. When demand outruns delivery, the gas stored in the pipes drains, pressure falls, and Enstar must cut customers: large users and power plants first, homes last. [2, 3]
- This winter Enstar could start about 3 Bcf short. [4]
- Losing pressure is slow to undo: in Rhode Island in 2019 it left 7,455 customers without gas for about a week while every meter was shut off and relit. [5]
- Smart-thermostat programs elsewhere cut gas in short events, but homes reheat afterward. In ConEd's pilot that snapback erased about half the saving. [6]

### What we built

A simulation of 25,000 Anchorage homes, not control of real thermostats. An operator console shows three charts on one clock: modeled pipeline pressure, outdoor temperature (forecast vs actual) and home discomfort.

- **Planner:** a linear program over 24 home types and 96 hours finds the least discomfort that keeps pressure above a 10-point reserve every hour, counting the reheating that follows.
- **Real forecasts:** it plans with the weather forecasts that existed at the time (archived National Blend of Models runs for Anchorage airport [7]) and re-plans as each new forecast arrives, every 6 hours, planning 0.75σ colder than forecast.
- **Households:** scan the QR code, join in three taps, see your home on a live map and the system pressure, and override with one tap. The server never holds a home below 62°F; homes needing steady heat are exempt.

### Pressure, in one line

Red below 0 (gas must be curtailed), amber 0–10 (reserve), blue up to 100 (pipes full). Each hour the pipes gain what wells and storage can deliver (278 MMcf/day in Feb 2024: the 268 MMcf record day plus ~10 of headroom) and lose what customers burn. Usable pipe storage: 9.54 MMcf (derived). Modeled linepack margin; not psi and not Enstar telemetry.

### How it's built

Browser (React on Vercel; HiGHS LP in a Web Worker) → SpacetimeDB (runs the house physics every second) → every screen (console and phones update live; same physics file on both sides).

### Results: the Feb 2024 cold snap, with less supply

Nobody was cut off in Feb 2024. We replay that weather and gas demand with less supply than it had. 25,000 homes (assumed participation); numbers derived from the model, BoreaFlux re-planned on archived forecasts.

| Preset | Plan | Lowest pressure | Hours below the line | Curtailed gas | Cost |
| --- | --- | --- | --- | --- | --- |
| Near-miss: 11.5 MMcf/day less (the most 25,000 homes can cover while holding the full reserve) | No program | −7 | 3 | 0.66 MMcf | — |
| | BoreaFlux | +10 | 0 | none | about 4.8°F cooler across 22 setback hours (105 °F·h per home); no home below 62°F |
| Stress: 15 MMcf/day less (assumed case) | No program | −31 | 17 | 2.99 MMcf | — |
| | BoreaFlux | −16 | 7 | 1.57 MMcf | 269 °F·h per home |

Near-miss: above the curtailment line for the whole cold snap. Stress: curtailment not removed, but about half the gas cut and 10 fewer hours below the line.

### Why trust the numbers

| Check | Published | Ours | Result |
| --- | --- | --- | --- |
| Saving kept after snapback, ConEd-like conditions | 48% [6] | 46.5% | Pass (38–58%) |
| Gas per home on a −20°F day | ~1.0 Mcf [8] | 1.04 Mcf | Consistent |
| Archived forecast error (RMSE), 12 h / 72 h ahead | — | 2.7 / 4.7°F | Why we plan colder |

Each home's heat loss is calibrated from Enstar's 149 Mcf average home [8], 30 years of Anchorage airport weather [9] and Alaska's gas energy content [10]. Every number on screen carries a sourced, derived or assumed label.

**What it doesn't do.** It doesn't close the seasonal 3 Bcf gap or control real thermostats today, and the 0.75σ forecast buffer was tuned on the Feb 2024 replay. It helps on the evenings when pressure decides who gets cut.

### Sources (every link opened and checked, Oct 3–4, 2026)

1. Anchorage Daily News, Enstar testimony to the House Energy Committee, Feb 6, 2024. <https://www.adn.com/business-economy/energy/2024/02/06/enstar-tells-lawmakers-gas-storage-was-extremely-close-to-being-depleted-during-recent-anchorage-cold-snap/>
2. Alaska Beacon, Jul 28, 2026 (ADN reprint Jul 29). <https://www.adn.com/business-economy/energy/2026/07/29/as-winter-approaches-southcentral-alaska-utilities-are-worried-about-running-short-of-gas/>
3. ENSTAR tariff §1220, Interruption Program, eff. Sep 27, 2023. <https://enstarnaturalgas.com/wp-content/uploads/2023/10/Binder-1200.pdf>
4. ADN editorial board, Aug 8, 2026. <https://www.adn.com/opinions/editorials/2026/08/08/editorial-the-winter-nobody-wants-to-imagine/>
5. RI Division of Public Utilities and Carriers, Aquidneck Island investigation, Oct 30, 2019. <https://ripuc.ri.gov/sites/g/files/xkgbur841/files/eventsactions/AI_Report.pdf>
6. Con Edison, Gas Demand Response pilot report 2019/2020 (NY PSC 17-G-0606). <https://documents.dps.ny.gov/public/Common/ViewDoc.aspx?DocRefId=%7B7FA119BD-B04D-4378-95A3-BB26697815AC%7D>
7. Iowa Environmental Mesonet, MOS archive (NBS/NBE, PANC). <https://mesonet.agron.iastate.edu/api/1/docs>
8. ADN, Energy Watch drill results, Nov 6, 2012. <https://www.adn.com/energy/article/results-are-latest-southcentral-alaska-energy-watch-drill/2012/11/06/>
9. ACIS, Anchorage airport daily data 1996–2025. <https://www.rcc-acis.org/docs_webservices.html>
10. U.S. EIA, heat content of delivered gas, Alaska, 2025. <https://www.eia.gov/dnav/ng/ng_cons_heat_a_epg0_vgth_btucf_a.htm>

Team: Manning Zhang, Allen Guo, Gustavo Rodriguez · MHacks 2026 · a simulation; pressure is modeled.
