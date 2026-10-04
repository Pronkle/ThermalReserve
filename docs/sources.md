# Sources

Every link below was opened on 2026-10-03 and returned the page (HTTP 200). The page's own text was checked for the number it supports. No URL was written from memory. Constant keys refer to `data/constants.json`, whose `source` fields carry the same links.

## Southcentral Alaska gas supply

| Source | Supports | Supporting text (short) |
| --- | --- | --- |
| ADN editorial board, "Editorial: The winter nobody wants to imagine", Aug 8, 2026. <https://www.adn.com/opinions/editorials/2026/08/08/editorial-the-winter-nobody-wants-to-imagine/> | `shortfall_bcf`, `shortfall_days`, `storage_aug_bcf`, `marginal_price_usd_mcf` | "3 billion cubic feet short"; "18 days with no heat"; "approximately 6.54 billion cubic feet in storage on Aug. 7"; HEX offered gas at "$17.50 per thousand cubic feet" |
| Homer News (Jeffrey Kennett), "Winter gas shortfall comes into sharper focus for Southcentral Alaska", Sep 10, 2026. <https://www.homernews.com/2026/09/10/winter-gas-shortfall-comes-into-sharper-focus-for-southcentral-alaska/> | `lng_earliest`, `shortfall_days`, curtailment order | Kenai Mayor Knackstedt: an import project "may not be ready until the fourth quarter of 2029"; reductions "phased by customer class" |
| ADN (Alex DeMarban), "Southcentral Alaska shatters record for natural gas use during subzero cold streak", Feb 2, 2024. <https://www.adn.com/business-economy/energy/2024/02/02/southcentral-alaska-shatters-record-for-natural-gas-use-during-subzero-cold-streak/> | `record_day_mmcf`, `customers`, `jan_avg_mmcfd`, `jan2024_total_bcf` | "268 million cubic feet of gas a day to its 150,000 customers"; average January "about 160 million cubic feet a day"; January use "hit 5.6 billion cubic feet" |
| ADN (Sean Maguire), "Enstar tells lawmakers it was 'extremely close' to being unable to deliver gas during Anchorage cold snap", Feb 6, 2024 (page dated Feb 7; opened 2026-10-04). <https://www.adn.com/business-economy/energy/2024/02/06/enstar-tells-lawmakers-gas-storage-was-extremely-close-to-being-depleted-during-recent-anchorage-cold-snap/> | `headroom_2024_mmcfd` | "CINGSA was maxed out and Hilcorp could only deliver an additional 10 million cubic feet"; "the Railbelt utilities were using a record 250 million cubic feet of gas per day" |
| Enstar, "2024 Winter Update", slides to the House Special Committee on Energy, Feb 6, 2024. <https://www.akleg.gov/basis/get_documents.asp?session=33&docid=28450> (meeting page: <https://www.akleg.gov/basis/Meeting/Detail?Meeting=HENE+2024-02-06+11%3A00%3A00>) | `deliverability_loss_mmcfd`, `customers` (152,000) | Jan 14 field order: withdrawal capacity "150 Mmcf/d to 121.5 Mmcf/d"; Jan 25 order: "150 Mmcf/d [to] 105 Mmcfd" |
| Alaska Public Media (Wesley Early), "Southcentral Alaska gas utility says high demand is straining gas storage system", Feb 1, 2024. <https://alaskapublic.org/2024/02/01/southcentral-alaska-gas-utility-says-high-demand-is-straining-gas-storage-system/> | Context for the 2024 storage-well failure | Storage output reduced "about 30% … about 45 million cubic feet a day"; prior record 254 MMcf |
| ADN / Alaska Journal of Commerce (Elwood Brehmer), "New natural gas deal by Hilcorp and Enstar could bring rate savings", May 14, 2020. <https://www.adn.com/business-economy/energy/2020/05/14/new-natural-gas-deal-by-hilcorp-and-enstar-could-bring-rate-savings/> | `annual_bcf` | Enstar "expects its demand to remain at roughly 33.6 billion cubic feet … per year through 2025" |
| Petroleum News (Alan Bailey), "New Enstar supplies", Mar 6, 2016. <https://www.petroleumnews.com/pntruncate/978589605.shtml> | `needle_peak_mmcfd` | Needle-peak call option: "up to 20 million cubic feet per day of additional gas during the months of December, January and February" |
| Enstar letter to the RCA, TA340-4 (gas cost adjustment), May 15, 2023. <https://www.enstarnaturalgas.com/wp-content/uploads/2023/05/TA340-4-Letter-Final.pdf> | Context: needle-peak contract terms, customer count | "152,048 Gas Sales Customers as of March 31, 2023"; 0.293 Bcf of Needle Peak Call Option gas assumed for 2023–24 |
| Regulatory Commission of Alaska, residential gas rate surveys, 2011 and 2020. <https://rca.alaska.gov/RCAWeb/Documents/Reports/2011gas.pdf>, <https://rca.alaska.gov/RCAWeb/Documents/Reports/2020Gas.pdf> | Range for `avg_home_mcf_year` (146 CCF/month × 12 = 175.2 Mcf/year) | Enstar Anchorage average monthly usage: 137 CCF (2011), 146 CCF (2018–2020), G1 class. Footnote: some heavy-use residential customers are in other classes and not in this average |

## Prior art: gas demand response

| Source | Supports | Supporting text (short) |
| --- | --- | --- |
| CALMAC Study SCG0224, "2018-2019 Winter Load Impact Evaluation of SoCalGas Smart Therm Program", Oct 24, 2019. <https://www.calmac.org/publications/SoCalGas_2019_DR_Evaluation_Report_-_PUBLIC_FINAL.pdf> | `socal_event_pct`, `socal_daily_pct` | Morning event hour: "0.093 MMcf/hr, or 15.1%"; morning-event day: "0.207 MMcf, or 2.2%" |
| Con Edison, "Gas Demand Response Report on Pilot Performance – 2019/2020", Jul 1, 2020, NY PSC Case 17-G-0606. <https://documents.dps.ny.gov/public/Common/ViewDoc.aspx?DocRefId=%7B7FA119BD-B04D-4378-95A3-BB26697815AC%7D> | `coned_snapback_pct` | "Snapback reduced calculated gas load reduction by an average of 52 percent" |
| Con Edison, same report for 2020/2021, Jul 1, 2021. <https://documents.dps.ny.gov/public/Common/ViewDoc.aspx?DocRefId=%7B8381AFA5-CBF0-4AC0-8192-78946C53F638%7D> | `coned_snapback_pct` (repeat) | "by an average of 52 percent during the 2020/2021 Winter Capability period" |
| NRECA Business & Technology Report, "Shifting Space Conditioning Load: A Smart Thermostat Demand Response Pilot", Jun 2021. <https://www.cooperative.com/programs-services/bts/Documents/Reports/Report-Smart-Thermostat-Pilot-June-2021.pdf> | `winter_optout_pct` | "opted-out at rates of 13% and 6% from summer and winter events" (electric co-op pilot, not gas) |
| SoCalGas, Demand Response application A.23-01, Chapter 1 (Darren Hanway), Jan 6, 2023. <https://www.socalgas.com/sites/default/files/2023-01/DR_Application_Chapter_1_Policy.pdf> | `socal_cost_usd_therm` | Proposed pilots: "average levelized cost of $17.65/therm shifted or shed" (a projection) |
| SoCalGas press release, "SoCalGas Makes Energy Saving This Winter Even Smarter with New Smart Therm Program", Dec 20, 2018. <https://www.prnewswire.com/news-releases/socalgas-makes-energy-saving-this-winter-even-smarter-with-new-smart-therm-program-300769742.html> | `rebate_upfront_usd`, `rebate_annual_usd` | "$50 incentive, plus an additional $25 for staying enrolled through April 1, 2019" |

## Context used in the Q&A (`docs/qa.md`)

Each page opened on 2026-10-03; none of these feed a constant.

| Source | Supports | Supporting text (short) |
| --- | --- | --- |
| Homer News (Jeffrey Kennett), Sep 10, 2026 (link above) | Curtailment order; Kenai mayor (Q&A 13) | Enstar "would first look to large commercial and industrial users for reductions before residential customers"; Knackstedt offered to share conservation information "if Enstar develops guidance showing how measures such as lowering thermostats could help" |
| ADN (Suzanna Caldwell), Nov 6, 2012 (link above) | Earlier Energy Watch results (Q&A 1) | "In past years, the reduction was between 2 to 4 percent" |
| Must Read Alaska (Todd M Lindley), "Analysis: Hilcorp, HEX, and Chugach tell lawmakers this winter can be covered, 2029 cannot", Sep 11, 2026. <https://mustreadalaska.com/analysis-hilcorp-hex-and-chugach-tell-lawmakers-this-winter-can-be-covered-2029-cannot/> | Q&A 19 | Hilcorp storage gas "can be available today if contracts are adjusted"; "Come winter 2029 we will need LNG imports or access to North Slope gas" |
| Alaska Public Media (Kavitha George), "Railbelt electric utilities are facing a major energy crunch. Renewables may be the answer.", Apr 9, 2024. <https://alaskapublic.org/2024/04/09/railbelt-electric-utilities-are-facing-a-major-energy-crunch-renewables-may-be-the-answer/> | Q&A 14 | "Two-thirds of the region's electricity is currently generated from Cook Inlet natural gas" |
| Google, Device Access registration. <https://developers.google.com/nest/device-access/registration>; thermostat setpoint trait (SetHeat): <https://developers.google.com/nest/device-access/traits/device/thermostat-temperature-setpoint> | Q&A 6 | "a one-time, non-refundable fee (US$5) per account"; `SetHeat` sets the heat setpoint in HEAT mode |
| ecobee, Developer API page. <https://www.ecobee.com/en-us/developers/> | Q&A 6 | "we are not currently accepting new developer registrations at this time" (no date on the page) |

## Gas heat content

| Source | Supports | Supporting text (short) |
| --- | --- | --- |
| EIA, "Heat Content of Natural Gas Delivered to Consumers", released Sep 30, 2026. <https://www.eia.gov/dnav/ng/ng_cons_heat_a_epg0_vgth_btucf_a.htm> | `hhv_btu_per_cf` = 988 (H1 approved, replacing the assumed 1,030) | Alaska row, Btu per cubic foot: 985 (2020), 982, 984, 998, 1,003, 988 (2025). U.S.: 1,036–1,037 |

## Map water mask

| Source | Supports |
| --- | --- |
| OpenStreetMap via the Overpass API (<https://overpass-api.de/>), retrieved 2026-10-03; © OpenStreetMap contributors, ODbL 1.0 (<https://www.openstreetmap.org/copyright>). Raw responses in `data/raw/osm_water_*.json` | `data/water_mask.json`: keeps sample homes out of lakes, Knik and Turnagain Arm, and tidal flats (32 of 1,000 homes were in water before) |

## Checked assumptions

These stay labeled "assumed" (values unchanged, AGENTS.md rule 11); the data below shows they are reasonable.

| Assumption | Evidence | Supporting text (short) |
| --- | --- | --- |
| `space_heat_share` = 0.75 | EIA, 2020 Residential Energy Consumption Survey, Table CE5.4.ST, released Jun 2023. <https://www.eia.gov/consumption/residential/data/2020/state/pdf/ce5.4.st.pdf> | Alaska, natural gas per household using each end use (hundred cubic feet): space heating 969, water heating 336, clothes dryers 23, cooking 23 → space heating 71.7–74.2% (RSE 4.2% / 4.9%). Total ≈ 135 Mcf/year, consistent with the 149 Mcf average home |
| `eta_furnace` = 0.85 | U.S. DOE, "Energy Conservation Standards for Consumer Furnaces," final rule, Federal Register, Dec 18, 2023 (document 2023-25514). <https://www.govinfo.gov/content/pkg/FR-2023-12-18/html/2023-25514.htm> | Current standard table: "Non-weatherized Gas ... 80 11/19/2015" (AFUE %); "Compliance with the amended standards ... is required on and after December 18, 2028" (95% AFUE) |
| Note | — | Efficiency and heat content cancel out of gas savings because UA is calibrated from gas burned; only `space_heat_share` scales the headline numbers (0.72 would lower them about 4%) |

## Curtailment order and rolling blackouts ("Why this matters" copy, H1, Oct 3 evening)

| Source | Supports | Supporting text (short) |
| --- | --- | --- |
| ADN / Alaska Beacon (James Brooks), "As winter approaches, Southcentral Alaska utilities are worried about running short of gas", Jul 29, 2026. <https://www.adn.com/business-economy/energy/2026/07/29/as-winter-approaches-southcentral-alaska-utilities-are-worried-about-running-short-of-gas/> (also Peninsula Clarion, Jul 28, 2026: <https://www.peninsulaclarion.com/2026/07/28/as-winter-approaches-kenai-peninsula-utilities-worried-about-running-short-of-gas/>) | Curtailment order | "Under Enstar's current plan, listed on the 162nd page of a filing with the Regulatory Commission of Alaska, industrial facilities would be cut off first, then businesses. Churches, schools, hospitals and homes would be last." |
| Homer News, Sep 10, 2026 (link above) | Curtailment order | Enstar "would first look to large commercial and industrial users for reductions before residential customers"; reductions "phased by customer class under the utility's tariff", human-needs facilities highest priority |
| KTNA / Mat-Su Sentinel, "MEA says Rolling Blackouts Possible under Worst-Case Winter Gas Shortage", Aug 4, 2026. <https://ktna.org/mea-says-rolling-blackouts-possible-under-worst-case-winter-gas-shortage/> | Rolling blackouts (worst case) | MEA "could institute rolling half-hour power blackouts this winter as a worst-case scenario response if extremely cold weather leaves natural gas utility Enstar unable to meet demand" (MEA would divert its gas to Enstar and run diesel at Eklutna) |
| Alaska Public Media (Ava White, Ashlyn O'Hara), "What to know about the Southcentral Alaska gas crunch", Sep 9, 2026. <https://alaskapublic.org/programs/alaska-economic-report/2026-09-09/what-to-know-about-the-southcentral-alaska-gas-crunch> | Context | Southcentral relies on gas for more than 70% of its electricity (ISER); MEA warned of possible rolling blackouts; "Chugach Electric is not planning blackouts this winter" |

**Primary source found (2026-10-04): Enstar's tariff.** The tiers are in Enstar's RCA tariff on its own site; the captcha-blocked RCA viewer link above is not needed.

| Source | Supports | Supporting text (short) |
| --- | --- | --- |
| ENSTAR Natural Gas Company tariff, RCA No. 4, Section 1200, §1220 "Interruption Program", Original Sheet Nos. 161–162, effective Sep 27, 2023 (Order U-22-032(8)). <https://enstarnaturalgas.com/wp-content/uploads/2023/10/Binder-1200.pdf> | Curtailment tiers (primary) | Priorities "in the order listed with (1) being the highest priority for uninterrupted service and (8) being the lowest": (1) residential and "hospitals, schools, churches and other human needs"; (2) small commercial, under 3,000 Mcf/day; (3)–(4) the same for non-sales end users; (5) large end users that cannot use an alternate fuel, including power generation; (6) large users that can switch fuel or buy power, including power plants with another supply; (7) firm service to power plants for interruptible sales; (8) interruptible service. Applies "unless the Company determines that a different response is necessary" |
| Same tariff, Section 800, §801 "Shortage and Interruption", Original Sheet No. 135. <https://enstarnaturalgas.com/wp-content/uploads/2023/10/Binder-800.pdf> | Apportionment | In a shortage, Enstar "will apportion its available supply of gas among all Customers in the most reasonable manner possible"; commercial use "may be curtailed or discontinued … in order to supply Residential Use Customers" |
| Enstar, "Energy Watch Plan: Conserve During Cold in Southcentral AK" (no date on page). <https://www.enstarnaturalgas.com/energy-watch-update/> | Household reductions help | "If called upon, customers should follow the steps below to reduce demand and stress on the pipeline system to support delivery to all customers in the Kenai Peninsula Borough, the Municipality of Anchorage, and the Matanuska-Susitna Borough" (page text is rendered by script; read via a rendering fetch) |

**How the "Why this matters" copy maps to sources:**
- "Enstar's plan cuts large commercial and industrial customers first": supported by the tariff (large end users, power plants and interruptible service are tiers 5–8; small businesses are tier 2, right after homes). ADN's "then businesses" is broader than the tariff.
- "…lower the chance of rolling blackouts": power generation sits in tiers 5–7, so deep shortfalls cut gas to power plants; MEA said that could force rolling blackouts in a worst case (KTNA). Chugach says it is not planning blackouts.
- "Small voluntary reductions at home make those cuts smaller": inference, grounded in §801 (supply is apportioned among all customers) and Enstar's Energy Watch request to reduce demand "to support delivery to all customers". No source states the effect size.

## Weather

| Source | Supports |
| --- | --- |
| ACIS Web Services (Regional Climate Centers), documentation: <https://www.rcc-acis.org/docs_webservices.html>. Data endpoint `https://data.rcc-acis.org/StnData` (POST only; requests and responses saved in `data/raw/`) | `hdd_annual`, `ua_mean_btuh_per_f`, scenario temperatures |

## Energy Watch 2012 and average home use

| Source | Supports | Supporting text (short) |
| --- | --- | --- |
| ADN (Suzanna Caldwell), "Results are in for latest Southcentral Alaska Energy Watch drill", Nov 6, 2012. <https://www.adn.com/energy/article/results-are-latest-southcentral-alaska-energy-watch-drill/2012/11/06/> | `avg_home_mcf_year`, `energy_watch_2012_pct` | "The average home consumes 149 thousand cubic feet (mcf) of natural gas a year"; the 2-hour drill on Oct 31 "reduced the area's energy load by 1.5 percent" |
| Homer News, "Conservation drill cuts load by about 1.5 percent", Nov 15, 2012. <https://www.homernews.com/2012/11/15/conservation-drill-cuts-load-by-about-1-5-percent/> | `energy_watch_2012_pct` (corroboration) | "energy load reduction of 1.5 percent"; poll: "61.2 percent were aware of a possible natural gas delivery problem and more than 42 percent were aware of the … conservation test" |

Range of average residential use (H1 decision: keep 149 as the model input). A ~140 Mcf/year Enstar estimate (KBBI 2019) was cited during review but no page containing it was found, so it is not listed.

| Figure | Source | Note |
| --- | --- | --- |
| 149 Mcf/year | ADN, Nov 6, 2012 (above) | Used (`avg_home_mcf_year`) |
| 175.2 Mcf/year | RCA 2020 residential rate survey, 146 CCF/month (above) | Rate-class (G1) average used for sample bills; may include small commercial |

Notes from re-checking both pages on 2026-10-03 (raw HTML, HTTP 200):
- The 1.5% is a reduction in the area's **energy load** across utilities during a 2-hour drill, not a gas-only figure. Say "energy load", not "gas use".
- ADN dates the drill to Oct 31, 2012; Homer News says Oct 30. Neither date is shown in the app.

## Dropped

| Former constant | Claimed source | Decision |
| --- | --- | --- |
| `needle_peak_days` (25 days/winter) | Petroleum News, 2021 | Dropped (H1). The verified 2016 article gives 20 MMcf/day for Dec–Feb with no day limit |

## Open questions from the check

1. **Record-day date.** The 268 MMcf record was set around midnight on Wednesday, **Jan 31, 2024**, not in February (reported Feb 2). Task D2's Jan 30–Feb 2 window already covers it.
2. **Deliverability loss.** 28.5 MMcf/day is the first (Jan 14) storage-well failure only. A second failure on Jan 25 brought capacity to 105 MMcf/day (a 45 MMcf/day loss in total).
3. **Average home use.** Resolved by H1: 149 Mcf/year is sourced (ADN 2012). UA is 398.3 after H1 approved the EIA heat content (988 BTU/cf).
4. **Needle peak.** The source is Petroleum News 2016, not 2021; the 25-day figure was removed.
5. **Rebate.** The $25 is a once-per-season bonus for staying enrolled, which matches "$25/year" only if renewed each winter.
6. **$17.65/therm** is SoCalGas's projected cost for proposed pilots, not a measured cost.

## Pressure overhaul checks (Oct 4, D-A2)

- **250 vs 268 MMcf/day.** ADN, Feb 2, 2024 (DeMarban) reports Enstar delivering 268 MMcf/day to its 150,000 customers around midnight on Wed Jan 31, 2024. ADN, Feb 6, 2024 (Maguire) reports Sims telling the House Energy Committee that the Railbelt utilities were using a record 250 MMcf/day during the cold weather. The two published figures differ and neither article reconciles them. The model keeps 268 (`record_day_mmcf`) as its anchor; reported to H1.
- **Headroom.** The Feb 6 article says Hilcorp could deliver only "an additional 10 million cubic feet" on the Wednesday evening. It gives no time unit; `headroom_2024_mmcfd` reads it as 10 MMcf/day and is marked approximate.
- **Forecast archive.** Iowa Environmental Mesonet MOS archive, API documented at <https://mesonet.agron.iastate.edu/api/1/docs> (opened 2026-10-04). A live call for PANC, model NBS, run 2024-01-30 19Z returned 3-hourly `tmp` and `tsd` to 2024-02-02 18Z; model NBE returned 12-hourly rows to 2024-02-10. Fetch script: `data/scripts/fetch-forecast.ts`.
- **Hourly observations, checked but not used (Oct 4).** Iowa Environmental Mesonet ASOS archive, routine hourly reports for PANC (<https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py?help>, opened 2026-10-04). The replays keep the assumed cosine curve through ACIS daily max/min (H1 decision). Against the hourly reports the curve is off by 6.0°F RMSE on feb2024 and 4.8°F on lastwinter, with lows at the wrong time of day. The real-hourly build is on branch `stdb/p-hourly`.
