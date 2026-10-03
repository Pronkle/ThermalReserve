# Sources

Every link below was opened on 2026-10-03 and returned the page (HTTP 200). The page's own text was checked for the number it supports. No URL was written from memory. Constant keys refer to `data/constants.json`, whose `source` fields carry the same links.

## Southcentral Alaska gas supply

| Source | Supports | Supporting text (short) |
| --- | --- | --- |
| ADN editorial board, "Editorial: The winter nobody wants to imagine", Aug 8, 2026. <https://www.adn.com/opinions/editorials/2026/08/08/editorial-the-winter-nobody-wants-to-imagine/> | `shortfall_bcf`, `shortfall_days`, `storage_aug_bcf`, `marginal_price_usd_mcf` | "3 billion cubic feet short"; "18 days with no heat"; "approximately 6.54 billion cubic feet in storage on Aug. 7"; HEX offered gas at "$17.50 per thousand cubic feet" |
| Homer News (Jeffrey Kennett), "Winter gas shortfall comes into sharper focus for Southcentral Alaska", Sep 10, 2026. <https://www.homernews.com/2026/09/10/winter-gas-shortfall-comes-into-sharper-focus-for-southcentral-alaska/> | `lng_earliest`, `shortfall_days`, curtailment order | Kenai Mayor Knackstedt: an import project "may not be ready until the fourth quarter of 2029"; reductions "phased by customer class" |
| ADN (Alex DeMarban), "Southcentral Alaska shatters record for natural gas use during subzero cold streak", Feb 2, 2024. <https://www.adn.com/business-economy/energy/2024/02/02/southcentral-alaska-shatters-record-for-natural-gas-use-during-subzero-cold-streak/> | `record_day_mmcf`, `customers`, `jan_avg_mmcfd`, `jan2024_total_bcf` | "268 million cubic feet of gas a day to its 150,000 customers"; average January "about 160 million cubic feet a day"; January use "hit 5.6 billion cubic feet" |
| Enstar, "2024 Winter Update", slides to the House Special Committee on Energy, Feb 6, 2024. <https://www.akleg.gov/basis/get_documents.asp?session=33&docid=28450> (meeting page: <https://www.akleg.gov/basis/Meeting/Detail?Meeting=HENE+2024-02-06+11%3A00%3A00>) | `deliverability_loss_mmcfd`, `customers` (152,000) | Jan 14 field order: withdrawal capacity "150 Mmcf/d to 121.5 Mmcf/d"; Jan 25 order: "150 Mmcf/d [to] 105 Mmcfd" |
| Alaska Public Media (Wesley Early), "Southcentral Alaska gas utility says high demand is straining gas storage system", Feb 1, 2024. <https://alaskapublic.org/2024/02/01/southcentral-alaska-gas-utility-says-high-demand-is-straining-gas-storage-system/> | Context for the 2024 storage-well failure | Storage output reduced "about 30% … about 45 million cubic feet a day"; prior record 254 MMcf |
| ADN / Alaska Journal of Commerce (Elwood Brehmer), "New natural gas deal by Hilcorp and Enstar could bring rate savings", May 14, 2020. <https://www.adn.com/business-economy/energy/2020/05/14/new-natural-gas-deal-by-hilcorp-and-enstar-could-bring-rate-savings/> | `annual_bcf` | Enstar "expects its demand to remain at roughly 33.6 billion cubic feet … per year through 2025" |
| Petroleum News (Alan Bailey), "New Enstar supplies", Mar 6, 2016. <https://www.petroleumnews.com/pntruncate/978589605.shtml> | `needle_peak_mmcfd` | Needle-peak call option: "up to 20 million cubic feet per day of additional gas during the months of December, January and February" |
| Enstar letter to the RCA, TA340-4 (gas cost adjustment), May 15, 2023. <https://www.enstarnaturalgas.com/wp-content/uploads/2023/05/TA340-4-Letter-Final.pdf> | Context: needle-peak contract terms, customer count | "152,048 Gas Sales Customers as of March 31, 2023"; 0.293 Bcf of Needle Peak Call Option gas assumed for 2023–24 |
| Regulatory Commission of Alaska, residential gas rate surveys, 2011 and 2020. <https://rca.alaska.gov/RCAWeb/Documents/Reports/2011gas.pdf>, <https://rca.alaska.gov/RCAWeb/Documents/Reports/2020Gas.pdf> | Cross-check for `avg_home_mcf_year` | Enstar Anchorage average monthly usage: 137 CCF (2011), 146 CCF (2020), G1 class |

## Prior art: gas demand response

| Source | Supports | Supporting text (short) |
| --- | --- | --- |
| CALMAC Study SCG0224, "2018-2019 Winter Load Impact Evaluation of SoCalGas Smart Therm Program", Oct 24, 2019. <https://www.calmac.org/publications/SoCalGas_2019_DR_Evaluation_Report_-_PUBLIC_FINAL.pdf> | `socal_event_pct`, `socal_daily_pct` | Morning event hour: "0.093 MMcf/hr, or 15.1%"; morning-event day: "0.207 MMcf, or 2.2%" |
| Con Edison, "Gas Demand Response Report on Pilot Performance – 2019/2020", Jul 1, 2020, NY PSC Case 17-G-0606. <https://documents.dps.ny.gov/public/Common/ViewDoc.aspx?DocRefId=%7B7FA119BD-B04D-4378-95A3-BB26697815AC%7D> | `coned_snapback_pct` | "Snapback reduced calculated gas load reduction by an average of 52 percent" |
| Con Edison, same report for 2020/2021, Jul 1, 2021. <https://documents.dps.ny.gov/public/Common/ViewDoc.aspx?DocRefId=%7B8381AFA5-CBF0-4AC0-8192-78946C53F638%7D> | `coned_snapback_pct` (repeat) | "by an average of 52 percent during the 2020/2021 Winter Capability period" |
| NRECA Business & Technology Report, "Shifting Space Conditioning Load: A Smart Thermostat Demand Response Pilot", Jun 2021. <https://www.cooperative.com/programs-services/bts/Documents/Reports/Report-Smart-Thermostat-Pilot-June-2021.pdf> | `winter_optout_pct` | "opted-out at rates of 13% and 6% from summer and winter events" (electric co-op pilot, not gas) |
| SoCalGas, Demand Response application A.23-01, Chapter 1 (Darren Hanway), Jan 6, 2023. <https://www.socalgas.com/sites/default/files/2023-01/DR_Application_Chapter_1_Policy.pdf> | `socal_cost_usd_therm` | Proposed pilots: "average levelized cost of $17.65/therm shifted or shed" (a projection) |
| SoCalGas press release, "SoCalGas Makes Energy Saving This Winter Even Smarter with New Smart Therm Program", Dec 20, 2018. <https://www.prnewswire.com/news-releases/socalgas-makes-energy-saving-this-winter-even-smarter-with-new-smart-therm-program-300769742.html> | `rebate_upfront_usd`, `rebate_annual_usd` | "$50 incentive, plus an additional $25 for staying enrolled through April 1, 2019" |

## Weather

| Source | Supports |
| --- | --- |
| ACIS Web Services (Regional Climate Centers), documentation: <https://www.rcc-acis.org/docs_webservices.html>. Data endpoint `https://data.rcc-acis.org/StnData` (POST only; requests and responses saved in `data/raw/`) | `hdd_annual`, `ua_mean_btuh_per_f`, scenario temperatures |

## Link not found

Searched on 2026-10-03; these keep their outlet-and-topic description from the master plan.

| Constant | Claimed source | Status |
| --- | --- | --- |
| `avg_home_mcf_year` (149 Mcf/year) | Enstar via ADN, 2012 | Not found. RCA surveys give ~164–175 Mcf/year for Enstar's G1 residential class (see above). Needs a decision: see "Open questions" |
| `energy_watch_2012_pct` (~1.5%) | ADN, 2012 | Not found |
| `needle_peak_days` (25 days/winter) | Petroleum News, 2021 | Not found. The verified 2016 article gives 20 MMcf/day for Dec–Feb, with no day limit |

## Open questions from the check

1. **Record-day date.** The 268 MMcf record was set around midnight on Wednesday, **Jan 31, 2024**, not in February (reported Feb 2). Task D2's Jan 30–Feb 2 window already covers it.
2. **Deliverability loss.** 28.5 MMcf/day is the first (Jan 14) storage-well failure only. A second failure on Jan 25 brought capacity to 105 MMcf/day (a 45 MMcf/day loss in total).
3. **Average home use.** 149 Mcf/year has no source yet; the RCA's published averages are higher. UA is calibrated from this number, so changing it would move UA by about 10–17%.
4. **Needle peak.** The source is Petroleum News 2016, not 2021, and "up to 25 days/winter" is unconfirmed.
5. **Rebate.** The $25 is a once-per-season bonus for staying enrolled, which matches "$25/year" only if renewed each winter.
6. **$17.65/therm** is SoCalGas's projected cost for proposed pilots, not a measured cost.
