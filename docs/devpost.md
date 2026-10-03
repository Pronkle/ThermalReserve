# Thermal Reserve: Devpost draft

> Draft v0 by DATA. H3 owns the final text. Placeholders are in [BRACKETS]; ⏳ marks numbers that must come from final test output before submission. Every number here is in `data/constants.json` or computed by `packages/model`; links are in `docs/sources.md`.

**Tagline:** Multi-day, snapback-aware thermostat setbacks that keep Southcentral Alaska's gas demand under the line on the coldest days.

**Links:** live app <https://thermal-reserve.vercel.app> · repo [REPO URL] · backup video [VIDEO URL]

**Team:** [H1 NAME], [H2 NAME], [H3 NAME]

---

## 1. Inspiration

In August 2026 the Anchorage Daily News editorial board asked what happens if Southcentral Alaska runs out of gas in a cold snap. Cook Inlet storage held about 6.54 Bcf on Aug 7 against 13 Bcf of working capacity, and Enstar's president told lawmakers the utility could enter winter about 3 Bcf short, the equivalent of 18 days of winter supply. Enstar would ask large commercial and industrial users to cut back before homes, and LNG imports may not be ready until late 2029.

[H1 PERSONAL CONNECTION TO ANCHORAGE: one or two sentences.]

Smart-thermostat demand response already exists elsewhere, but short events mostly shift gas use to later in the day: ConEd measured that snapback erased an average of 52% of calculated savings. We wanted to know what a fleet of thermostats could do across a multi-day cold snap if it were planned for net daily savings instead.

## 2. What it does

⏳ Sections 2 and 3 describe the product as specified; before submitting, confirm each feature against the deployed app and cut anything that isn't live.

Thermal Reserve simulates a fleet of Anchorage homes and dispatches thermostat setbacks to keep total gas demand under a daily capacity line. It's a simulation: it does not control real thermostats.

- **Operator console (`/ops`).** Load a cold-snap scenario, compare three strategies (no program, a naive 4-hour morning setback, and an optimized plan), solve and dispatch the plan, and watch the live run on a map of 1,000 sample homes, a fleet chart, and KPIs with formulas and labels. [SCREENSHOT: ops console mid-event]
- **Household app (`/home`).** Scan a QR code, join in three taps, and see your indoor temperature, setpoint, status, and gas saved. Override any time; your share moves to other homes, never below the 62°F comfort floor. [SCREENSHOT: phone app]
- **What-if calculator (`/whatif`).** Pick participation, setback depth, outdoor temperature, and days; see MMcf/day, share of the needle-peak supply, and value, with every formula and constant shown. [SCREENSHOT]
- **Validation (`/validation`).** The same physics run under ConEd-like and SoCalGas-like conditions, next to the published results, with pass bands. [SCREENSHOT: validation page]

## 3. How we built it

[ARCHITECTURE DIAGRAM: export from `docs/architecture.md`]

- **Physics.** Each home type is a two-node thermal model (indoor air and building mass), solved exactly with a 2×2 matrix exponential and run in 5-minute steps. 24 home types cover furnace or boiler, night setback or not, three envelope tightness levels, and light or heavy mass.
- **Calibration.** The average heat-loss coefficient comes from Enstar's 149 Mcf average home and 30 years (1996–2025) of Anchorage airport degree-days from ACIS: 9,818.5 °F·days per year, giving UA = 398.3 BTU/(h·°F) (derived) with Alaska's delivered gas at 988 BTU/cf (EIA, 2025).
- **System demand.** Daily Southcentral demand = a + b × degree-days, fitted to two sourced anchors: January 2024's 5.6 Bcf and the 268 MMcf record day. The fit implies 35.0 Bcf a year, close to Enstar's forecast of 33.6. The 24-hour demand shape is assumed and illustrative.
- **Optimizer.** A linear program over 24 home types and 96 hours finds the least total discomfort that keeps each gas day under capacity, solved in the browser with HiGHS (WebAssembly) in a Web Worker. If it fails or times out, a rule-based staggered plan runs and the console says so.
- **Live simulation.** A SpacetimeDB TypeScript module on Maincloud runs the clock as a scheduled reducer, integrates every home type plus a no-program "twin," applies overrides and reassignment, and holds all shared state. The browser and the server run the same physics file, and a test checks they match hour by hour.
- **Web app.** React, Vite, TypeScript, Tailwind, Recharts, Leaflet with OpenStreetMap tiles, deployed on Vercel.
- **Data.** Scenarios replay real Anchorage weather (the Jan 31–Feb 3, 2024 cold snap and last winter's coldest stretch, Jan 2–5, 2026) plus a synthetic −20°F design snap. Everything rebuilds offline from saved ACIS responses with `npm run data`.

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

What this does **not** do: solve the seasonal shortfall. Over 20 cold days, 25,000 homes at 5°F save about 28 MMcf, under 1% of a 3 Bcf gap. Thermal Reserve is a deliverability tool for the coldest days, not a supply fix. We found no data on how many Anchorage homes have smart thermostats, so we report results per enrolled home instead of guessing.

## 6. Challenges we ran into

- **Snapback.** A one-node house model barely cools during a 4-hour event and predicts that almost all savings come back afterward, far worse than ConEd measured. We moved to a two-node model with fast indoor air and slow building mass, which can match the pilots and stays linear for the optimizer.
- **Capacity is daily, not hourly.** Holding hourly demand under a flat hourly line fought the normal morning peak and made the optimizer chase hours it couldn't fix. We switched to a daily limit per gas day and state the assumption that pipeline linepack and storage absorb swings within the day.
- **Keeping numbers honest.** Every number carries a source, derivation, or "assumed" label. Re-checking sources changed several details (the record day was Jan 31, 2024, not in February), and figures we couldn't trace were removed.
- **Coordinating four AI agents.** Folder ownership, frozen contracts, a merge gate on tests, and Agent Mail messages kept four agents from overwriting each other.

## 7. Accomplishments, what we learned, and what's next

On the Feb 2024 replay with 25,000 homes, only Feb 2 exceeds the (hypothetical) capacity line, by 3.00 MMcf. The optimized plan cuts that day's uncovered shortfall to 0.85 MMcf, against 1.64 for a rule-based staggered plan and 2.80 for a naive 4-hour morning setback; its snapback lands on Feb 3, which has spare capacity (all derived from the model). [ADD: live run tracking the optimized plan within X% per hour, after the end-to-end test.]

**Learned:** short events mostly move gas use around; multi-day planning with staggered recovery is where net daily savings come from.

**Next:** real hourly sendout data from Enstar; a pilot with a few hundred Anchorage homes through a thermostat aggregator; a live-forecast scenario from the National Weather Service.

## 8. AI use disclosure

Coding agents wrote much of the code under human direction: three Claude Code sessions (Claude Opus 5.5, one Claude Max and two Claude Pro accounts) and one OpenAI Codex session (GPT-6.1 Sol). Humans chose the problem, designed the model and validation, set every contract, reviewed code, and verified the numbers. The agents coordinated through MCP Agent Mail and git branches with a test-gated merge. A line-by-line log is in `docs/AI_LOG.md`. [H3: summarize the final log here.]

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

---

**Built with:** SpacetimeDB, TypeScript, React, Vite, Tailwind CSS, HiGHS, Leaflet, OpenStreetMap, Recharts, Vercel, Vitest, Claude Code, OpenAI Codex, MCP Agent Mail, Notability

## Submission checklist

- [ ] All three teammates added on Devpost
- [ ] Theme: Sustainability; opt into the Spacetime and Notability sponsor prizes; LLM judging if allowed
- [ ] Table number entered
- [ ] Public repo link, live app link, backup video link
- [ ] Screenshots: ops console mid-event, fleet chart naive vs optimized, validation page, phone app, Notability (2)
- [ ] ⏳ Validation table filled from final test output
- [ ] No secrets in the repo: no Agent Mail token, registration tokens, or `.mcp.json`
- [ ] Submitted by 11:30 AM Sunday
