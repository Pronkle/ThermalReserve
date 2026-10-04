# Pitch: Thermal Reserve (pressure version)

DATA, Oct 4. Rewritten for the pressure console (AGENTS.md Sections 3, 4.3 and 5). Placeholders are in [BRACKETS]; H1's Anchorage story is left for H1 to write. Numbers are ENGINE's on `main` `c525a5c` (msg 198; H1 msg 244); re-check them on the verdict strip before rehearsing. Speaker split follows `docs/qa.md`: **H1** problem and impact, **H2** demo and technical, **H3** data and honesty.

**Say:** "modeled pressure", "re-planned as each new forecast arrived", "simulated homes", "fewer customers cut".
**Never say:** "our program would have saved Feb 2024", "sized before the cold snap", "psi", "Enstar's pressure", "measured" (about our results), "first", "AI-powered", "cheap", any Anchorage smart-thermostat penetration figure. No CO2 or diesel numbers.

## 3:00 version

### 0:00–0:35 · The problem (H1)

[H1 ANCHORAGE STORY: one or two sentences.]

"Southcentral Alaska heats with Cook Inlet gas, and Cook Inlet is running down. This summer Enstar's president told lawmakers the utility could enter winter about 3 billion cubic feet short.

But the danger isn't the season's total. It's one evening. On the record cold night of January 31, 2024, Enstar told lawmakers it came extremely close to being unable to deliver gas: storage was maxed out, and Hilcorp could add only about 10 million cubic feet more.

The whole region runs on one pressurized system of pipes. When demand outruns what wells and storage can deliver, the gas stored in the pipes drains and pressure falls. Then Enstar has to cut customers, businesses and power plants first. And if an area loses pressure entirely, every meter is shut off and relit by hand: in Rhode Island in 2019 that left about 7,500 customers without gas for a week."

### 0:35–0:55 · The idea (H1)

"Smart thermostats can turn heat down a couple of degrees across thousands of homes at once. Utilities elsewhere already do this, but for short events, and short events backfire: when they end, every house reheats at once. Con Edison measured that about half the saving came back that way.

Thermal Reserve plans those setbacks hour by hour against the pipes themselves, counting the reheating that follows, so the system stays above the curtailment line."

### 0:55–2:15 · Demo (H2, on `/ops`; follows AGENTS.md Section 4.3)

Setup before judges arrive: Reset demo pressed, Near-miss loaded, solved, dispatched, paused at hour 0. Phone ready with the QR code visible.

1. **(0:55) The screen.** "This is the February 2024 cold snap replayed with 11.5 million cubic feet a day less supply than that winter had. The top chart is a modeled pressure index: 100 means the pipes are full, zero means curtailment begins. It's a model, not Enstar's telemetry."
2. **(1:05) No program.** Point at the gray and amber lines. "Doing nothing, or the usual four-hour morning setback, drops below the line on the coldest evening, for three hours."
3. **(1:15) Start.** "Our plan eases 25,000 simulated homes a few degrees at the right hours. Watch the white live line, run on our server, trace the plan." When a re-plan appears in the log: "That's a new weather forecast arriving. We use the forecasts that existed at the time, and the plan is re-made every time a new one comes in."
4. **(1:30) Judge joins.** Hand the phone or invite a judge to scan. "Any household can join in three taps. There's your home on the map. Tap Override." The log shows the override and the reassignment. "Other homes cover for you, and no home ever goes below 62 degrees."
5. **(1:50) Verdict.** Pause near the minimum. "The lowest point stays above our 10-point safety reserve. The cost is comfort: on average about one and a half degrees cooler over three days." [Read the verdict strip's numbers aloud; expected lowest 10, 105 °F·h per home.]
6. **(2:00) Stress.** Press Stress. "Now lose 28.5 million a day, the size of the 2024 storage-well failure. Here nobody can prevent curtailment, and the screen says so. The fleet cuts the gas that has to be curtailed from about 40 to about 34 million cubic feet: fewer customers cut, not none."

### 2:15–2:45 · Why you can trust the numbers (H3)

"Every number on screen carries a label: sourced, derived or assumed, with a link. The house model is calibrated to Enstar's average home and 30 years of Anchorage weather. On the validation page the same physics reproduces the snapback ConEd measured. We also show where our model disagrees with a published pilot, and how far off the archived forecasts were: about 3 degrees half a day out, 4 to 5 degrees two to three days out. That's why we plan colder than forecast."

### 2:45–3:00 · Close (H1)

"In February 2024 nobody was cut off, but the margin was about 10 million cubic feet. Thermal Reserve shows how thousands of thermostats, planned against the pipes and re-planned with every forecast, can turn a near miss into a held line, and make a bad night smaller. Next step: Enstar's real hourly data and a pilot with a few hundred Anchorage homes. Thank you."

## 60-second version

(H1) "Southcentral Alaska's gas grid fails on one cold evening, not over a season: on January 31, 2024 Enstar came extremely close to being unable to deliver. When demand outruns supply, pressure in the shared pipes falls and customers get cut.

(H2, on `/ops`) This is that cold snap with 11.5 million cubic feet a day less supply. Doing nothing drops our modeled pressure below the curtailment line for three hours. Thermal Reserve eases 25,000 simulated thermostats a few degrees at the right hours, re-planning as each new forecast arrives, and the pressure stays above a safety reserve, at about one and a half degrees cooler on average. With a loss the size of the 2024 well failure it can't prevent curtailment, but it cuts it by about a seventh.

(H3) Every number is labeled and sourced, and the physics reproduces the snapback ConEd measured."

## If a judge asks "what if Southcentral runs short in a cold snap?" (spoken answer; not on screen)

From ENGINE's coverage table (msg 198; 25,000 homes, 10-point reserve):

- **Feb 2024 weather:** 25,000 homes hold the full reserve with up to 11.5 MMcf/day less supply, and stay above the curtailment line up to 13 MMcf/day less.
- **Last winter's coldest stretch (Jan 2026):** they hold the reserve up to 26 MMcf/day less and stay above the line up to 27.
- **Design −20°F for three days:** 25,000 homes with up to a 5°F setback can't keep that synthetic snap above the line, even with no supply lost. Say so plainly: that is a supply problem, not a thermostat one.

Answer in two sentences, for example: "With 25,000 homes, a February 2024-type cold snap could lose about 11 million cubic feet a day of supply and nobody would be cut. A three-day −20°F snap is beyond what thermostats can fix; it needs supply."

## Rehearsal checklist

- [ ] Reset demo between judges (one press); check Near-miss is paused at hour 0.
- [ ] After a page load the verdict strip is blank ("Not solved for these inputs: press Solve plan") until Solve plan or Reset demo is pressed. That is expected; press one before reading numbers aloud (ENGINE msg 276).
- [ ] Verdict strip numbers read aloud match production (ENGINE's production check after `c525a5c`).
- [ ] Phone on the production URL, QR code reachable; fallback: judges watch rather than join.
- [ ] If the pressure screen fails, demo `/ops?ui=gas` and switch the claim to "plans against a daily supply limit" (Section 5).
- [ ] Timed run under 3:00, five times (Section 14).
