# Phone test procedure (Checkpoint 3, Sun 02:00–03:00)

Step-by-step script for the real-phone run of `docs/test-plan.md`. Screen text below is copied from the app on `main` (a60e3e3 and later), so testers can match it word for word. Record every result in the test plan's "Runs" section; file each FAIL to its owner as a `[REQUEST]` (see "Filing a failure" at the end).

**Production URL:** <https://thermal-reserve.vercel.app> · **Database:** `thermal-reserve` (production). Use `?db=thermal-reserve-dev` only if H1 says so.

## Roles

| Role | Who | Device |
| --- | --- | --- |
| Operator | H3 (or H1) | Mac, Chrome, `/ops` |
| Phone A | H3 or teammate | iPhone, Safari |
| Phone B | teammate | Android phone, Chrome |
| Second screen | anyone | Windows or Linux laptop, Chrome, `/ops` (watch only) |
| Recorder | DATA (BlackHeron) | fills the test plan, files bugs, takes the timings H3 calls out |

## Before you start (01:45)

1. **Passcode:** get the production operator passcode from H1 in person. Never type it into chat, mail, or the repo.
2. **Phones:** on each phone, clear site data for `thermal-reserve.vercel.app` (iPhone: Settings → Safari → Advanced → Website Data; Android Chrome: site settings → Clear & reset). Turn off battery saver. Have a stopwatch ready on another phone or watch.
3. **Laptops:** open a fresh browser profile (or a private window) on the Mac and the second-screen laptop.
4. **Check the deploy:** on the Mac, open `/ops`. The header shows a QR code labeled "Join a home", and the chart legend reads "No program · Naive morning setback · …". If not, stop: production isn't on W4 yet (tell DATA).
5. **Recorder:** copy sections 1–5 of `docs/test-plan.md` into a new "Run 1 (02:00)" section.

## Part A: operator setup (Mac, 5 min)

| Step | Do | Expect | Test plan |
| --- | --- | --- | --- |
| A1 | Open `/ops`. Press **Demo preset**. When the browser asks "Operator passcode", enter H1's passcode | Header reads "LIVE · THERMAL-RESERVE"; scenario "Feb 2024 cold snap (replay)"; Enrolled homes 25,000; Comfort floor 62.0 °F; Speed 2 h/s; status idle | E1 |
| A2 | Look at the fleet chart and KPI cards | Lines: No program, Naive morning setback (dashed amber, spikes after each morning), the active plan, Live. Every KPI has a "derived" or "assumed" chip; hover each KPI and read its formula | E2, B4, B5 |
| A3 | Set Strategy to **Optimized**, press **Solve plan** | Solve finishes in under 5 s and shows its time; scroll the event log during the solve: the page stays responsive | E3 |
| A4 | Press **Dispatch** | Event log shows a dispatch line | E4 |
| A5 | On the second-screen laptop, open `/ops` (don't claim operator) | Same state within 1 s; it shows "Viewer" | F5 |

Don't press Start yet.

## Part B: phones join (10 min)

Do Phone A first, then Phone B. The recorder times each join from scan to live card.

| Step | Do (on the phone) | Expect | Test plan |
| --- | --- | --- | --- |
| B1 | Scan the QR code on the Mac's `/ops` header (tap it to enlarge). Start the stopwatch | `/home` opens: "Steady heat. A stronger community.", one button **Join as an Anchorage home**, and "This is a demo. It does not connect to your thermostat." | P1 |
| B2 | Tap **Join as an Anchorage home** | "Tell us about your home": Nickname (optional), Heating type (Furnace, Boiler, Other), Thermostat (Nest, ecobee, Honeywell, Other, None), checkbox "Someone here needs steady heat (infant, elderly, medical)" | P2 |
| B3 | Phone A: nickname "Test iPhone", Furnace, Nest, box **unchecked**. Phone B: leave nickname empty, Boiler, None, box **unchecked**. Tap **Continue** | Consent screen reads "During a gas emergency your heat may be lowered up to 5°F, never below 62°F. Override any time." and "This demo simulates your heat and savings. No real thermostat is controlled." No exclamation marks | P3 |
| B4 | Tap **Join**. Stop the stopwatch when the live card appears | Join under 20 s from scan. Live card: big indoor °F, setpoint, status "Normal", sim clock, **Override** button. Phone B's nickname defaults to "Home NNNN" | P4, P5, P2 |
| B5 | Mac: watch the map | A large, pulsing dot appears within 2 s of each join, with the nickname on hover; event log shows "… joined" | E5 |
| B6 | Both phones: check width | No sideways scrolling; text readable without zoom | P10 |

## Part C: run the event (15 min)

| Step | Do | Expect | Test plan |
| --- | --- | --- | --- |
| C1 | Mac: press **Start** | Sim clock advances about 2 hours per real second; Live line advances and tracks the Optimized line; map dots turn blue (holding) and amber (recovering) | E4 |
| C2 | Phones: watch the card as the event begins | Status changes to "Holding −X°F"; indoor temperature falls but never below 62 °F; "Net gas saved this event" and "Gas value, not a bill credit" start counting | P5, P8 |
| C3 | Phone A: tap **Override**. Start the stopwatch | Within 2 s: card shows "Normal heat restored. You can rejoin when ready."; button changes to **Rejoin event**; Mac's event log shows an override line and a reassign line | E6, P6 |
| C4 | Phone A: tap **Rejoin event** | Status returns to holding; event log shows the rejoin | P6 |
| C5 | Phone B: reload the page (pull down, or reload button) | Same household returns (same nickname); the Mac's map still shows one dot for it, not two | P7 |
| C6 | Phone B: open **Why this matters** | Sheet opens and closes; text reads "If gas runs short, Enstar's plan cuts large commercial and industrial customers first. Small voluntary reductions at home make those cuts smaller and lower the chance of rolling blackouts. Override any time." (AGENTS.md §3, H1) | P9 |
| C7 | Phones: look at "Community today" | Net saved and the bar toward the day's target; on a day with no shortfall it says "No extra relief is needed to cover this day's modeled demand." | P8 |
| C8 | Let the run finish (about 48 s at 2 h/s) | Status finished; record the totals and the tightest-day KPIs (expected with the Demo preset: relief 2.06 MMcf/day, uncovered 0.94, value $36,100/day) | E7, N4 |

## Part D: special cases (10 min)

| Step | Do | Expect | Test plan |
| --- | --- | --- | --- |
| D1 | Mac: **Reset** (not Reset households). A third phone or a private tab joins with the "Someone here needs steady heat" box **checked** | Consent says the home is exempt; live card says "Your home keeps steady heat. You are exempt from setbacks."; no Override button; status Exempt during the event | P11 |
| D2 | Mac: drag Comfort floor to 60 °F, press **Apply inputs**. A new private tab joins as a household. Start the run | That household never goes below 62 °F (study-only setting; never show this in the demo). Set the floor back to 62 °F afterward | P12 |
| D3 | Mac devtools → Network → block `tile.openstreetmap.org`, reload `/ops` | Plain map with dots appears within about 3 s | F1 |
| D4 | Mac: turn Wi-Fi off for 10 s, then on | "Disconnected — retrying" banner, then live updates resume | F2 |
| D5 | Phone: open `/whatif` and `/validation`; then turn on airplane mode and reload | Both pages render (what-if default 1.43 MMcf/day; ConEd 0.465 Pass; SoCalGas 1.14% Gap). If they don't render offline, note it (E8) | E8, N1–N9 |
| D6 | Mac in Safari: open `/ops` | Map and chart fit at the window size; QR enlarges on click | B1–B3 |

## Part D2: iMessage companion (only if CHAT ships, ~10 min)

First add Phone A's number as a project user in the Photon dashboard (Photon won't text any other number), then run `docs/test-plan.md` §4b (C-0 to C-9) with Phone A (iPhone, Messages). Use **1 h/s** instead of 2 h/s so the texts have room. The companion process must be running (where it runs during judging is H1's decision). Skip this part entirely if CHAT hasn't reached its Phase 1.

## Part E: clean up (2 min)

1. Mac: press **Reset households**, then **Reset**. Confirm the map shows no large household dots and the event log is cleared.
2. Set the comfort floor back to **62 °F** if D2 changed it.
3. Close the second-screen tab.
4. Recorder: post `[CP3]` with PASS/FAIL counts and the deployed bundle name.

## Before judging (after the last test run)

Production keeps whatever the last run left. Before judges arrive, on `/ops` as operator:

1. **Reset households** (removes test phones from the map and the household count).
2. **Demo preset** (reloads `feb2024`, 25,000 homes, floor 62°F, idle at hour 0).
3. Check: no large household dots, event log shows only the scenario load, status idle.

## Filing a failure

One `[REQUEST]` per failure, to the owner (WEB for `apps/web`, STDB/H1 for `stdb/`, ENGINE for numbers from the model, DATA for data and docs):

```
[REQUEST] <owner>: <one-line symptom> (test plan <ID>)
Device/browser: iPhone 15, Safari 18 (example)
Steps: 1. … 2. … 3. …
Expected: …   Actual: …
Screenshot: <path>   Time: 02:14
```

## If something blocks the run

| Problem | Do |
| --- | --- |
| Can't claim operator ("wrong passcode") | Ask H1 for the passcode again; don't guess |
| Production database broken | Switch every device to `?db=thermal-reserve-backup` (H1 must claim operator on it first) |
| Join button stays disabled | "The operator needs to load a scenario before you can join." → press Demo preset on the Mac |
| Vercel site down | Stop; tell H1 (deploys belong to STDB/H1) |
