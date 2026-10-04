# BoreaFlux: one-pager, draft 2

> Draft 2 by DATA (draft 1 is kept in `onepager.md` / `.html` / `.pdf`). Print layout: `onepager-v2.html` → `onepager-v2.pdf` (one Letter page). In the PDF, every sourced number links to its source, and the numbered list at the bottom repeats the links. **UNFINISHED:** team names. H3 owns the final.

## BoreaFlux

**Coordinated thermostat setbacks that keep Southcentral Alaska's gas demand under supply on the coldest days of a multi-day cold snap.**

Join from your phone: [boreaflux.vercel.app/home](https://boreaflux.vercel.app/home) · QR code: `apps/web/public/household-join.svg` (embedded in the HTML)

### The problem

- Enstar's president warned lawmakers the utility could enter this winter about **3 Bcf short** of gas, the equivalent of **18 days without heat** in sustained cold. [1]
- On Aug 7, 2026, Cook Inlet storage held about **6.54 Bcf** of its 13 Bcf working capacity. [1]
- In a shortage, Enstar would ask **large commercial and industrial customers to cut back first**, before homes, and imported LNG may not arrive until **late 2029**. [2]
- Thermostat programs elsewhere save gas during short events, but homes reheat afterward ("snapback"). In ConEd's pilot, snapback erased **52%** of the savings. [3]

### What we built

A **simulation**, not control of real thermostats. An operator console plans setbacks for a simulated fleet of Anchorage homes (24 home types, shown as 1,000 dots on a map). An optimizer picks the smallest total temperature drop that keeps each day's gas demand under supply, planning across the whole cold snap so reheating lands on days with spare gas.

Households join from a phone, see their indoor temperature and gas saved, and can opt out with one tap. The server never lets a home drop below **62°F**, and homes that need steady heat are exempt.

### Honest impact

A sustained setback at −20°F outside, automated homes only (derived). Each home's heat loss is calibrated from Enstar's 149 Mcf average home [4], 30 years of Anchorage weather [5], and Alaska's gas energy content, 988 BTU per cubic foot [6].

| Enrolled homes | Gas saved, 5°F setback | Share of Enstar's 20 MMcf/day peak supply [7] | Value at $17.50/Mcf [1] |
| --- | --- | --- | --- |
| 10,000 | 0.57 MMcf/day | 2.8% | ~$10,000/day |
| 25,000 | 1.42 MMcf/day | 7.1% | ~$24,900/day |
| 50,000 | 2.85 MMcf/day | 14.2% | ~$49,800/day |

Peak supply: extra gas Enstar's supply contract lets it buy on the coldest winter days. $17.50/Mcf: the price producer HEX offered Enstar for extra gas in 2026.

**Two assumptions, checked against data (assumed):**
- **75% of a home's gas goes to space heating.** EIA's 2020 household survey puts Alaska at 72–74% [9]. At 72%, every savings figure above would be about 4% lower.
- **Furnace efficiency 0.85.** Gas furnaces must be at least 80% efficient (federal minimum since 2015; 95% from Dec 2028) [10], and Anchorage homes mix older and newer units. It doesn't change the gas numbers: we calibrate from gas actually burned, so efficiency cancels out.

**What it doesn't do:** close the seasonal shortfall. Over 20 cold days, 25,000 homes save about 28 MMcf, under 1% of 3 Bcf. BoreaFlux helps on the coldest days, when businesses would otherwise be cut.

### Does the model match real pilots?

We ran the same physics under each pilot's conditions (derived).

| Test | Published | Ours | Pass band | Result |
| --- | --- | --- | --- | --- |
| Savings kept after reheating (ConEd-like) | 48% [3] | 46.5% | 38–58% | Pass |
| Net daily savings (SoCalGas-like) | 2.2% [8] | 1.14% | 1.5–3.0% | Gap |

Pass bands are our own choice, set around each published value before testing. We show the gap instead of tuning it away: the two pilots imply different amounts of snapback, and on daily savings our model errs low.

### How it works

Browser (React app on Vercel: charts, map, what-if, and the optimizer) → SpacetimeDB (runs the house physics every second for every home type and real phone) → every screen updates live. The browser and the server run the same physics file, and a test checks that they agree.

### Sources (every link opened and checked on Oct 3, 2026)

1. Anchorage Daily News editorial board, "The winter nobody wants to imagine," Aug 8, 2026. <https://www.adn.com/opinions/editorials/2026/08/08/editorial-the-winter-nobody-wants-to-imagine/>
2. Homer News, "Winter gas shortfall comes into sharper focus for Southcentral Alaska," Sep 10, 2026. <https://www.homernews.com/2026/09/10/winter-gas-shortfall-comes-into-sharper-focus-for-southcentral-alaska/>
3. Con Edison, "Gas Demand Response Report on Pilot Performance – 2019/2020," Jul 1, 2020 (NY PSC Case 17-G-0606). <https://documents.dps.ny.gov/public/Common/ViewDoc.aspx?DocRefId=%7B7FA119BD-B04D-4378-95A3-BB26697815AC%7D>
4. Anchorage Daily News, "Results are in for latest Southcentral Alaska Energy Watch drill," Nov 6, 2012. <https://www.adn.com/energy/article/results-are-latest-southcentral-alaska-energy-watch-drill/2012/11/06/>
5. ACIS Web Services, Regional Climate Centers: daily data for Anchorage Ted Stevens International Airport, 1996–2025. <https://www.rcc-acis.org/docs_webservices.html>
6. U.S. Energy Information Administration, "Heat Content of Natural Gas Delivered to Consumers," Alaska, 2025. <https://www.eia.gov/dnav/ng/ng_cons_heat_a_epg0_vgth_btucf_a.htm>
7. Petroleum News, "New Enstar supplies," Mar 6, 2016. <https://www.petroleumnews.com/pntruncate/978589605.shtml>
8. CALMAC SCG0224, "2018-2019 Winter Load Impact Evaluation of SoCalGas Smart Therm Program," Oct 24, 2019. <https://www.calmac.org/publications/SoCalGas_2019_DR_Evaluation_Report_-_PUBLIC_FINAL.pdf>
9. EIA, 2020 Residential Energy Consumption Survey, Table CE5.4.ST (Alaska row: natural gas use per household by end use). <https://www.eia.gov/consumption/residential/data/2020/state/pdf/ce5.4.st.pdf>
10. U.S. Department of Energy, consumer furnace standards final rule, Federal Register, Dec 18, 2023 (document 2023-25514). <https://www.govinfo.gov/content/pkg/FR-2023-12-18/html/2023-25514.htm>

MHacks 2026 · Team: [H1 NAME], [H2 NAME], [H3 NAME] (UNFINISHED). Every number is labeled sourced, derived, or assumed.
