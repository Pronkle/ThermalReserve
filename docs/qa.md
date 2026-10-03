# Judge Q&A bank

Two sentences at most, then stop talking. **H1** takes problem and impact, **H2** technical, **H3** data and process. Numbers come from `data/constants.json` or the model's `whatIf` (UA 398.3, η 0.85, HHV 988); sources with links are in `docs/sources.md`. Lines marked ⏳ need final numbers before judging.

Don't say: "first gas demand response", "cheap" or "cheaper than gas", "AI-powered", any Anchorage smart-thermostat penetration figure, or that we control real thermostats.

| # | Likely question | Answer | Who | Backing |
| --- | --- | --- | --- | --- |
| 1 | Why not just tell everyone to turn down the heat? | Anchorage did, with Energy Watch: a 2-hour drill in 2012 cut the area's total energy load about 1.5%, and earlier drills 2–4%. Nobody knows if that holds for three days at −20°F or who took part, so we automate it, measure it, and keep the broadcast as a second tier. | H1 | ADN, Nov 6, 2012 (sourced). Say "energy load", not "gas" |
| 2 | Where do your numbers come from? | Enstar's 149 Mcf average home, 30 years of Anchorage airport degree-days from ACIS, the 268 MMcf record day, and the SoCalGas and ConEd evaluations. Every number on screen is labeled sourced, derived, or assumed, with a link. | H3 | `docs/sources.md` |
| 3 | How do you know the simulation is right? | The same physics reproduces ConEd's measured snapback (retention 0.47 vs 0.48 published), but it's more pessimistic than SoCalGas on daily savings (1.14% vs 2.2%), and the validation page shows that gap. The two pilots imply very different retention, so no single physical model matches both; ours errs low. | H2 | ENGINE E4, recomputed on `main` (derived) |
| 4 | Isn't this tiny compared to a 3 Bcf shortfall? | Yes for volume, and we say so: about 1% of 3 Bcf over 20 cold days. It matters for deliverability: 25,000 homes at a 5°F setback free about 1.4 MMcf/day, roughly 7% of the 20 MMcf/day needle-peak supply, on the days businesses would otherwise be cut. | H1 | `whatIf`: 1.42 MMcf/day, 7.1%, 0.95% over 20 days (derived) |
| 5 | What does it cost? | SoCalGas paid $50 per thermostat plus $25 for staying enrolled through the winter, and projected $17.65 per therm shifted or shed for its proposed pilots. It's not cheaper than gas; it's insurance against curtailing businesses. | H1 | SoCalGas 2018 release; SoCalGas 2023 DR application (sourced) |
| 6 | How would it control a real thermostat? | Today it's a simulation; real control would go through the aggregators utilities already use, or vendor APIs. Google's Nest Device Access API can set heat directly for a $5 developer fee, while ecobee isn't accepting new developer registrations. | H2 | Google Device Access docs; ecobee developer page (both checked 2026-10-03) |
| 7 | Is it safe at −20°F? | The comfort floor is enforced on the server: 62°F by default and never below 60°F. Households needing steady heat are exempt, and override is one tap. | H1 | `floor_default_f`, `floor_min_f`; floor clamp in Spacetime reducers |
| 8 | What's actually new here? | Planning multi-day events for net daily savings with staggered recovery, calibrated to Anchorage and checked against published pilots, running live. Gas demand response itself isn't new, and we cite SoCalGas and ConEd. | H2 | — |
| 9 | How does the optimizer work? | A linear program over 24 home types and the 96-hour scenario: least total discomfort subject to the daily gas capacity and comfort floors, solved with HiGHS in the browser. If it fails or times out, a rule-based plan runs and the console says so. | H2 | ⏳ Browser solve time: [MEASURED] (ENGINE measured ~0.2 s in Node on `design`) |
| 10 | Why SpacetimeDB? | The simulation clock is a scheduled server-side reducer, and every phone and the console share live state through subscriptions. Safety rules (floor, exemptions, operator) live in reducers, not in clients. | H2 | `stdb/` |
| 11 | How many Anchorage homes have smart thermostats? | We couldn't find that data, so we show results per enrolled home count instead of guessing. Programs elsewhere subsidize thermostats to grow enrollment. | H3 | No figure exists; never quote one |
| 12 | What about people who override? | We model a 6% per-event opt-out, taken from a published winter smart-thermostat pilot run by an electric co-op. Real overrides shift that home's share to others automatically, never below the floor. | H2 | NRECA 2021 (sourced); `override_rate` (assumed for Anchorage) |
| 13 | Would Enstar use this? | Enstar would ask large commercial and industrial users to cut before homes, and Kenai's mayor offered to share guidance showing how lowering thermostats could help. A pilot through an aggregator is the next step. | H1 | Homer News, Sep 10, 2026 (sourced) |
| 14 | Why not heat pumps or more storage? | Those take years and capital, and about two-thirds of Railbelt electricity comes from Cook Inlet gas anyway. This works with thermostats people already own, this winter. | H1 | Alaska Public Media, Apr 9, 2024 (sourced) |
| 15 | What was hardest? | Snapback: a one-node house model predicted almost no net savings from a short event, so we moved to a two-node model with fast indoor air and slow building mass, which can match the pilots. | H2 | Master plan §9; ENGINE |
| 16 | What would you do next? | Get real hourly sendout data from Enstar, pilot with a few hundred Anchorage homes through an aggregator, and add a live forecast mode. | H1 | — |
| 17 | Did you use AI? | Yes, and it's disclosed on Devpost: coding agents wrote much of the code under our direction. We chose the problem, designed the model, set the validation targets, and checked every number. | H3 | `docs/AI_LOG.md` |
| 18 | What about privacy? | A household stores a nickname, heating and thermostat type, and simulated temperatures; we never ask for an address. The public map shows sample homes, and real households are placed near a random sample dot. | H3 | Spacetime `household` table |
| 19 | Is this winter even short? | Hilcorp told lawmakers its stored gas could cover this winter if contracts are adjusted, and that by winter 2029 the region needs LNG imports or North Slope gas; Enstar's president described a 3 Bcf gap. Either way, imports may not be ready until late 2029. | H1 | Must Read Alaska, Sep 11, 2026; ADN editorial, Aug 8, 2026; Homer News, Sep 10, 2026 |
| 21 | Isn't the 75% space-heating share made up? | It's an assumption, and we checked it: EIA's 2020 household survey puts Alaska at 72–74% of home gas for space heating. Using 72% would lower every savings number by about 4%, for example 1.42 to 1.37 MMcf/day for 25,000 homes. | H3 | EIA RECS 2020, Table CE5.4.ST, Alaska row; H1 kept 0.75 (assumed) with the range shown |
| 22 | Doesn't furnace efficiency change your savings? | No. We calibrate each home from the gas it actually burns, so efficiency and gas energy content cancel out of the gas savings. Efficiency only affects the house physics slightly. | H2 | `docs/sources.md` "Checked assumptions"; DOE furnace rule (80% minimum since 2015) |
| 20 | How does this fit sustainability? | It stretches a depleting regional resource on the worst days without new infrastructure. It's the energy-systems side of the theme: using what we already have more carefully. | H1 | — |

## Numbers to have ready

| Number | Value | Label |
| --- | --- | --- |
| Saving per home, 5°F setback at −20°F | 56.9 cf/day | derived |
| 25,000 homes, 5°F | 1.42 MMcf/day; 7.1% of 20 MMcf/day needle peak; 5.0% of the 2024 deliverability loss; ~$24,900/day at $17.50/Mcf | derived |
| 10,000 homes, 5°F | 0.57 MMcf/day; 2.8% of needle peak | derived |
| 50,000 homes, 5°F | 2.85 MMcf/day; 14.2% of needle peak | derived |
| 25,000 homes, 5°F, 20 days | ~28 MMcf, about 0.95% of 3 Bcf | derived |
| Record day | 268 MMcf, Jan 31, 2024 | sourced |
| Validation | ConEd retention 0.465 (pass, band 0.38–0.58); SoCalGas daily 1.14% (gap, band 1.5–3.0%); Anchorage 1.04 Mcf/home/day at −20°F | derived |
| Feb 2024 replay, 25,000 homes, Feb 2 | Uncovered shortfall: none 3.00, naive 2.80, staggered 1.64, optimized 0.85 MMcf | derived |
| Storage, Aug 7, 2026 | ~6.54 Bcf of 13 Bcf working capacity | sourced |
