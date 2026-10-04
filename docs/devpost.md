# BoreaFlux: Devpost draft

> Draft v1 by DATA (Oct 4, rewritten for the pressure console; claims follow AGENTS.md Section 5). H3 owns the final text. Placeholders are in [BRACKETS]; ⏳ marks numbers that must come from final test output before submission. Every number here is in `data/constants.json` or computed by `packages/model`; links are in `docs/sources.md`.

**Tagline:** Thermostat setbacks planned against modeled pipeline pressure, so Southcentral Alaska's gas grid stays above the curtailment line on the coldest evenings.

**Links:** live app <https://boreaflux.vercel.app> · repo [REPO URL] · backup video [VIDEO URL]

**Team:** [H1 NAME], [H2 NAME], [H3 NAME]

---

## 1. Inspiration

In August 2026 the Anchorage Daily News editorial board asked what happens if Southcentral Alaska runs out of gas in a cold snap. Cook Inlet storage held about 6.54 Bcf on Aug 7 against 13 Bcf of working capacity, and Enstar's president told lawmakers the utility could enter winter about 3 Bcf short, the equivalent of 18 days of winter supply. Enstar would ask large commercial and industrial users to cut back before homes, and LNG imports may not be ready until late 2029.

[H1 PERSONAL CONNECTION TO ANCHORAGE: one or two sentences.]

Smart-thermostat demand response already exists elsewhere, but short events mostly shift gas use to later in the day: ConEd measured that snapback erased an average of 52% of calculated savings. On the record cold evening of Jan 31, 2024, Enstar told lawmakers it came "extremely close" to being unable to deliver gas: storage was maxed out and Hilcorp could add only about 10 million cubic feet. Southcentral runs on one pressurized system of pipes, so the risk on the coldest evening is pressure, not the season's total. We wanted to know whether a fleet of thermostats, planned hour by hour and counting the reheating that follows, could keep that system above the line.

## 2. What it does

⏳ Sections 2 and 3 describe the product as specified; before submitting, confirm each feature against the deployed app and cut anything that isn't live.

BoreaFlux simulates a fleet of Anchorage homes and dispatches thermostat setbacks to keep a **modeled pipeline pressure index** (100 = pipes full, 0 = curtailment begins; not psi, not Enstar telemetry) above a reserve, with the least discomfort. It's a simulation: it does not control real thermostats.

- **Operator console (`/ops`).** Three charts on one clock: modeled system pressure, outdoor temperature (forecast vs actual), and home discomfort, with a verdict strip and a one-line status. Two presets replay Feb 2024 with less supply than it had: **Near-miss** (11.5 MMcf/day less) and **Stress** (28.5 MMcf/day less, the size of the 2024 storage-well failure). Solve, dispatch, and watch the live run re-plan as each new forecast arrives, on a map of 1,000 sample homes. The previous gas-volume console is kept at `/ops?ui=gas`. [SCREENSHOT: ops console, Near-miss mid-event]
- **Household app (`/home`).** Scan a QR code, join in three taps, and see your indoor temperature, setpoint, status, gas saved and the live system pressure. Override any time; your share moves to other homes, never below the 62°F comfort floor. [SCREENSHOT: phone app]
- **What-if calculator (`/whatif`).** Pick participation, setback depth, outdoor temperature, and days; see MMcf/day, share of the needle-peak supply, and value, with every formula and constant shown. [SCREENSHOT]
- **Validation (`/validation`).** The same physics run under ConEd-like and SoCalGas-like conditions, next to the published results, with pass bands, plus the archived forecasts' error by lead time. [SCREENSHOT: validation page]

## 3. How we built it

[ARCHITECTURE DIAGRAM: export from `docs/architecture.md`]

- **Physics.** Each home type is a two-node thermal model (indoor air and building mass), solved exactly with a 2×2 matrix exponential and run in 5-minute steps. 24 home types cover furnace or boiler, night setback or not, three envelope tightness levels, and light or heavy mass.
- **Calibration.** The average heat-loss coefficient comes from Enstar's 149 Mcf average home and 30 years (1996–2025) of Anchorage airport degree-days from ACIS: 9,818.5 °F·days per year, giving UA = 398.3 BTU/(h·°F) (derived) with Alaska's delivered gas at 988 BTU/cf (EIA, 2025).
- **System demand.** Daily Southcentral demand = a + b × degree-days, fitted to two sourced anchors: January 2024's 5.6 Bcf and the 268 MMcf record day. The fit implies 35.0 Bcf a year, close to Enstar's forecast of 33.6. The 24-hour demand shape is assumed and illustrative.
- **Pressure model.** Hour by hour, the pipes' stored gas (linepack) gains what wells and storage can deliver and loses what customers burn. The delivery limit is the modeled Feb 2024 record day (268 MMcf) plus the ~10 MMcf/day of headroom Enstar reported, 278 MMcf/day (derived); usable linepack is 9.54 MMcf (derived: the smallest buffer that absorbs a normal day's hourly swing). Curtailed gas is counted by replaying the series and curtailing just enough each hour to keep the pipes from going below empty.
- **Optimizer.** A linear program over 24 home types and 96 hours finds the least total discomfort that keeps modeled linepack above a 10-point reserve every hour, with far heavier penalties for curtailment, solved in the browser with HiGHS (WebAssembly) in a Web Worker. In a 972-case sweep it never fell back and the slowest solve took 453 ms in Node. If it fails or times out, a rule-based staggered plan runs and the console says so.
- **Forecasts and re-planning.** The replays use the weather forecasts that existed at the time: 21 archived National Blend of Models runs per replay for Anchorage airport, from the Iowa Environmental Mesonet. The plan is re-made as each new run arrives (every 6 simulated hours), planning for 0.75 standard deviations colder than forecast (assumed; chosen on the Feb 2024 replay). The forecasts were off by about 3°F half a day out and 4–5°F two to three days out.
- **Live simulation.** A SpacetimeDB TypeScript module on Maincloud runs the clock as a scheduled reducer, integrates every home type plus a no-program "twin," applies overrides and reassignment, and holds all shared state. The browser and the server run the same physics file, and a test checks they match hour by hour.
- **Web app.** React, Vite, TypeScript, Tailwind, Recharts, Leaflet with OpenStreetMap tiles, deployed on Vercel.
- **Data.** Scenarios replay real Anchorage weather (the Jan 31–Feb 3, 2024 cold snap and last winter's coldest stretch, Jan 2–5, 2026) plus a synthetic −20°F design snap. Everything rebuilds offline from saved ACIS responses with `npm run data`.

### iMessage companion (Photon Spectrum) ⏳ UNFINISHED: only if CHAT ships

[CHAT supplies this text (brief §10): the two-agent design (a Concierge that owns the conversation and an Insights agent that answers "why" questions from tool results only), persistent memory, social behaviors (tapbacks, quiet hours, backing off when nobody replies), and the honesty guard that rejects any number no tool produced. Spectrum is the iMessage transport, which the Photon prize track requires. Cut this subsection if CHAT doesn't reach a demoable phase by the 10:00 freeze.]

## 4. Validation

Results from ENGINE's validation tests (E4, after tuning only Ca, Ham and the mass time constant within their allowed ranges), recomputed by DATA on `main` with the final constants.

| Test | Conditions (assumed) | Published | Our model | Band | Result |
| --- | --- | --- | --- | --- | --- |
| ConEd-like snapback | 30°F outside, 70°F, −4°F from 06:00 to 10:00 | 52% of savings lost (retention 0.48) | retention 0.465 (derived) | 0.38–0.58 | **Pass** |
| SoCalGas-like daily savings | 45°F outside, 68°F, −4°F from 06:00 to 10:00; response rate fitted to the 15.1% event-hour cut (r = 0.30) | 2.2% net daily | 1.14% (derived) | 1.5–3.0% | **Gap**: below the band |
| Anchorage sanity | −20°F outside, 70°F | ~1.0 Mcf/home/day (derived from 149 Mcf/year) | 1.04 Mcf/home/day (derived) | — | Consistent |

**The gap, stated plainly.** Our model reproduces ConEd's snapback but is more pessimistic than SoCalGas on daily savings: 1.14% against a published 2.2% (best reachable within the allowed parameter ranges was about 1.35%). The two pilots imply very different retention (about 48% for ConEd, about 87% for SoCalGas), and one physical model can't match both. We show the gap on the validation page instead of tuning past physically plausible values; if anything, our daily-savings numbers err low.

## 5. Honest impact

Steady-state savings from a sustained setback at −20°F, automated homes only (derived from UA 398.3 BTU/(h·°F) and gas at 988 BTU/cf, sourced from EIA; furnace efficiency 0.85, assumed):

| Enrolled homes | 5°F setback | 8°F setback | 5°F as share of the 20 MMcf/day needle peak | 5°F value at $17.50/Mcf |
| --- | --- | --- | --- | --- |
| 10,000 | 0.57 MMcf/day | 0.91 MMcf/day | 2.8% | ~$10,000/day |
| 25,000 | 1.42 MMcf/day | 2.28 MMcf/day | 7.1% | ~$24,900/day |
| 50,000 | 2.85 MMcf/day | 4.55 MMcf/day | 14.2% | ~$49,800/day |

What this does **not** do: solve the seasonal shortfall. Over 20 cold days, 25,000 homes at 5°F save about 28 MMcf, under 1% of a 3 Bcf gap. BoreaFlux is a deliverability tool for the coldest days, not a supply fix. We found no data on how many Anchorage homes have smart thermostats, so we report results per enrolled home instead of guessing.

## 6. Challenges we ran into

- **Snapback.** A one-node house model barely cools during a 4-hour event and predicts that almost all savings come back afterward, far worse than ConEd measured. We moved to a two-node model with fast indoor air and slow building mass, which can match the pilots and stays linear for the optimizer.
- **Capacity is daily, not hourly.** Holding hourly demand under a flat hourly line fought the normal morning peak and made the optimizer chase hours it couldn't fix. We switched to a daily limit per gas day and state the assumption that pipeline linepack and storage absorb swings within the day.
- **Keeping numbers honest.** Every number carries a source, derivation, or "assumed" label. Re-checking sources changed several details (the record day was Jan 31, 2024, not in February), and figures we couldn't trace were removed.
- **From daily volume to hourly pressure.** Our first version planned against a daily gas limit, which missed how the grid actually fails: on one evening, not across a day. Ten hours before the deadline we rebuilt the console and the optimizer around a modeled pressure index, keeping the old console at `/ops?ui=gas`.
- **Forecasts ran warm.** A single plan made from the forecast at the start of the Feb 2024 cold snap goes below the curtailment line, because the forecasts were several degrees too warm by day 3. Re-planning on each new forecast with a cold buffer fixes that, so that is what we claim.
- **Coordinating four AI agents.** Folder ownership, frozen contracts, a merge gate on tests, and Agent Mail messages kept four agents from overwriting each other.

## 7. Accomplishments, what we learned, and what's next

In Feb 2024 nobody was cut off, and we don't claim our program would have saved it. We ask what happens with less supply (feb2024 replay, 25,000 homes, all derived from the model):

| Preset | Supply lost vs Feb 2024 | No program | 25,000 homes, re-planned on forecasts |
| --- | --- | --- | --- |
| Near-miss | 11.5 MMcf/day | modeled pressure below the curtailment line for 3 hours (lowest −6.9); about 0.66 MMcf curtailed | stays above the 10-point reserve (lowest 10.2); about 1.5°F cooler on average over the three days (105 °F·h per home); 16 re-plans |
| Stress | 28.5 MMcf/day | about 40.2 MMcf curtailed | about 34.4 MMcf curtailed (14% less), at 402 °F·h per home; the fleet reduces curtailment but cannot remove it |

[⏳ ADD after the end-to-end test: the live run tracks the planned pressure within X points. WEB measured a 0.117-point maximum error on Maincloud at 2 and 4 h/s (AI log, 05:18); confirm on production.]

**Learned:** short events mostly move gas use around; the hour the grid is tightest matters more than the day's total, and plans have to be re-made as forecasts change.

**Next:** Enstar's real hourly sendout and pressure data in place of our modeled index; real hourly temperatures in the replays; a pilot with a few hundred Anchorage homes through a thermostat aggregator.

## 8. AI use disclosure

Coding agents wrote much of the code under human direction: four Claude Code roles (ENGINE, STDB, DATA and CHAT; Claude Opus 5.5 on one Claude Max and two Claude Pro accounts) and one OpenAI Codex role (WEB, GPT-6.1 Sol). ENGINE, WEB and STDB started fresh sessions for the overnight pressure overhaul. [⏳ If CHAT ships: add the fifth agent (CHAT, iMessage companion; tool, account, model TBD), and say that the companion itself uses the Claude API at runtime, without the phrase "AI-powered".] Humans chose the problem, designed the model and validation, set every contract, reviewed code, and verified the numbers. The agents coordinated through MCP Agent Mail and git branches with a test-gated merge. A line-by-line log is in `docs/AI_LOG.md`. [H3: summarize the final log here.]

## 9. Notability

[H3: one sentence on how the team used Notability, plus 2 screenshots.] Add "Notability" to built-with.

## 10. Sources

Full list with links, dates, and the supporting text for each number: `docs/sources.md`. Main sources:

- Anchorage Daily News editorial board, "The winter nobody wants to imagine," Aug 8, 2026
- Anchorage Daily News, "Southcentral Alaska shatters record for natural gas use during subzero cold streak," Feb 2, 2024
- Anchorage Daily News, "Results are in for latest Southcentral Alaska Energy Watch drill," Nov 6, 2012
- Homer News, "Winter gas shortfall comes into sharper focus for Southcentral Alaska," Sep 10, 2026
- Enstar, "2024 Winter Update," House Special Committee on Energy, Feb 6, 2024
- CALMAC SCG0224, "2018-2019 Winter Load Impact Evaluation of SoCalGas Smart Therm Program," Oct 24, 2019
- Con Edison, "Gas Demand Response Report on Pilot Performance," 2019/2020 and 2020/2021
- NRECA, "Shifting Space Conditioning Load: A Smart Thermostat Demand Response Pilot," Jun 2021
- ACIS Web Services, Regional Climate Centers (Anchorage Ted Stevens International Airport daily data)
- Anchorage Daily News (Sean Maguire), "Enstar tells lawmakers it was 'extremely close' to being unable to deliver gas during Anchorage cold snap," Feb 6, 2024
- Alaska Beacon (James Brooks), "As winter approaches, Southcentral Alaska utilities are worried about running short of gas," Jul 28, 2026
- Enstar Natural Gas Company tariff, §1220b curtailment priorities
- Rhode Island Division of Public Utilities and Carriers, "Summary Investigation Into the Aquidneck Island Gas Service Interruption of January 21, 2019," Oct 30, 2019
- Iowa Environmental Mesonet, MOS archive (National Blend of Models forecasts for PANC)

---

**Built with:** SpacetimeDB, TypeScript, React, Vite, Tailwind CSS, HiGHS, Leaflet, OpenStreetMap, Recharts, Vercel, Vitest, Claude Code, OpenAI Codex, MCP Agent Mail, Notability [⏳ if CHAT ships: Photon Spectrum, iMessage, Claude API, SQLite]

## Submission checklist

- [ ] All three teammates added on Devpost
- [ ] Theme: Sustainability; opt into the Spacetime and Notability sponsor prizes; LLM judging if allowed
- [ ] ⏳ If CHAT ships: opt into the Photon iMessage prize track (Spectrum must be the iMessage transport)
- [ ] Table number entered
- [ ] Public repo link, live app link, backup video link
- [ ] Screenshots: see `docs/demo-assets.md` (pressure console Near-miss and Stress, temperature chart with re-plans, phone app, validation page, Notability ×2)
- [ ] ⏳ Validation table filled from final test output
- [ ] No secrets in the repo: no Agent Mail token, registration tokens, or `.mcp.json`
- [ ] Submitted by 11:30 AM Sunday
