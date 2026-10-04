# Demo assets: screenshots, `/validation` copy, backup video (D-C1)

DATA, Oct 4. For H3 (screenshots, video) and WEB (copy). Numbers are ENGINE's on `main` `d79dbda` (msg 198; H1 msg 244); re-check them on production before capturing. Claims follow AGENTS.md Section 5: say "modeled" near "pressure", "re-planned as each new forecast arrived", never "sized before the cold snap", never "our program would have saved Feb 2024".

## 1. Devpost screenshots (capture on https://boreaflux.vercel.app)

Browser at 1280×800 for `/ops`, phone at 390 px for the others. Fresh profile, light-on-dark ops theme as shipped.

| # | Page and state | What must be visible | Caption (paste into Devpost) |
| --- | --- | --- | --- |
| 1 | `/ops`, Reset demo → Near-miss, Start, paused near hour 69 (the minimum) | All three charts, verdict strip, status sentence, live line over the Optimized line, No program and Naive below the red line | "Near-miss: with 11.5 MMcf/day less supply than Feb 2024, no program drops the modeled pressure below the curtailment line for 3 hours; 25,000 homes, re-planned as each forecast arrived, stay above the reserve." |
| 2 | `/ops`, Stress preset, solved, paused at its minimum | Pressure chart far below zero, status sentence with curtailed gas | "Stress: with 15 MMcf/day less supply (an assumed case), the fleet roughly halves modeled curtailed gas, from 3.0 to 1.6 MMcf, and cuts the hours below the line from 17 to 7. It reduces curtailment; it can't remove it." |
| 3 | `/ops`, Near-miss mid-run, crop to the temperature chart and event log | Forecast band stepping at a re-plan, planning line, a "Re-plan …, new forecast" log line | "The plan is re-made every time a new forecast arrives, planning 0.75σ colder than forecast." |
| 4 | `/home` on a phone, joined, during the event | Live card, status "Holding", pressure line, Override button | "Households join by QR code in three taps, see their home and the system pressure, and can override any time." |
| 5 | `/validation`, scrolled to ConEd and SoCalGas cards | Pass chip (ConEd), amber gap note (SoCalGas) | "The same physics reproduces ConEd's measured snapback; we show where it's more pessimistic than SoCalGas." |
| 6 | `/validation`, forecast-error table | Table with leads and RMSE | "Archived forecasts were off by about 3°F half a day out and 4–5°F two to three days out." |
| 7, 8 | Notability (H3) | Two pages of team notes | [H3 caption] |

Optional: `/ops?ui=gas` (the earlier gas-volume console) and `/whatif` defaults (1.43 MMcf/day).

## 2. `/validation` forecast-error copy (for WEB, optional)

The page already prints `forecast_error.json` `scope`, `method` and `source` verbatim, which is correct. If WEB wants a plain-language lead sentence above the table, use this (numbers are the pooled row of `forecast_error.json`; label derived):

> "How good were the forecasts the planner used? We compared each archived National Blend of Models forecast for Anchorage airport with what was later observed. Daily highs and lows were off by about 2.7°F half a day ahead and 4.7°F three days ahead, and ran warm at longer leads (+1.9 to +2.2°F at 48–72 h). That is why the planner plans for colder than forecast."

Keep it out of the site if it can't read the numbers from `forecast_error.json` (rule: no retyped numbers). Do not add the replay curve-versus-hourly-observations gap to the site (H1, msg 242).

## 3. Backup video shot list (90 s, follows AGENTS.md Section 4.3)

Record on production at 1280×800 with the phone mirrored or filmed beside it. Voice-over lines are suggestions for H3; keep each number as written.

| Time | Shot | Voice-over |
| --- | --- | --- |
| 0:00–0:10 | `/ops` with Near-miss loaded, paused at hour 0 | "Southcentral Alaska runs on one pressurized gas system. On the coldest evening of 2024, Enstar told lawmakers it came extremely close to being unable to deliver gas." |
| 0:10–0:22 | Hover the pressure chart: No program and Naive cross the red line; point to the label under the title | "This is a modeled pressure index: 100 is full pipes, 0 is where curtailment begins. With 11.5 MMcf a day less supply than 2024, doing nothing goes below the line for three hours." |
| 0:22–0:40 | Press Start; live line traces Optimized; a re-plan appears in the log and the forecast steps on the temperature chart | "Our planner eases 25,000 thermostats a few degrees at the right hours, counting the reheating that follows, and re-plans as each new forecast arrives." |
| 0:40–0:55 | Phone: scan QR, join, dot appears on the map; tap Override; log shows override and reassignment | "Anyone can join from a phone, see their home and the system pressure, and override with one tap. The fleet covers for them, and no home goes below 62°F." |
| 0:55–1:05 | Pause at the minimum; verdict strip | "Lowest pressure 10, never in the reserve band, at about 4.8 degrees cooler across 22 setback hours." [check the verdict strip's numbers on production first] |
| 1:05–1:20 | Press Stress | "Take away 15 million cubic feet a day and nobody can prevent curtailment. The fleet roughly halves the gas that has to be cut, from about 3 to 1.6 million cubic feet: fewer customers cut, not none." |
| 1:20–1:30 | `/validation` cards | "The same physics reproduces the snapback ConEd measured, and every number on screen carries its source." |

Do not say: "our program would have saved Feb 2024", "sized before the cold snap", "Enstar's pressure", "psi", "AI-powered", "first", or any Anchorage smart-thermostat penetration figure.
