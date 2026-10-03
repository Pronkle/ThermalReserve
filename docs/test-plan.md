# Test plan

Run by DATA with H3 at Checkpoint 3 (Sun 02:00–03:00), then the end-to-end test every hour after 06:00 (AGENTS.md Section 14). Production URL: <https://thermal-reserve.vercel.app>.

**How to record.** Fill the Result column with PASS, FAIL, or SKIP (with reason). File every FAIL as a `[REQUEST]` to the owner with steps to reproduce, device and browser, and a screenshot path. Copy this file's tables into a dated section at the bottom for each run.

## 0. Setup

| # | Item | Notes |
| --- | --- | --- |
| 0.1 | Devices | At least one iOS phone (Safari) and one Android phone (Chrome); one laptop with Chrome and Safari (or Chrome only if no Mac, noted) |
| 0.2 | Fresh state | Laptop: fresh browser profile. Phones: clear site data for the Vercel URL |
| 0.3 | Operator passcode | From H1 in person; never typed into chat or the repo |
| 0.4 | Database | `thermal-reserve` (production) unless H1 says otherwise |

## 1. End-to-end demo test (Section 14)

| # | Step | Expected | Owner if it fails | Result |
| --- | --- | --- | --- | --- |
| E1 | Open `/ops` in a fresh profile; claim operator; press **Demo preset** | `feb2024` loaded, 25,000 enrolled, speed 2 h/s, status idle at hour 0 | WEB / STDB | |
| E2 | Look at the fleet chart and KPI strip | BASELINE, NAIVE_4H and OPTIMIZED (or SUSTAIN_STAGGER before the LP) lines visible; NAIVE recovery spike visible after each event; every KPI has a value and a label chip | WEB | |
| E3 | **Solve plan** | Finishes in under 5 s; elapsed time shown; UI stays responsive (scroll the event log during the solve) | WEB / ENGINE | |
| E4 | **Dispatch**, then **Start** | Event log shows `dispatch`; LIVE line advances about 2 hours per second and tracks the OPTIMIZED line; map dots change color | WEB / STDB | |
| E5 | Scan the QR code with phone 1; enroll | Three taps through the flow; large dot appears on the `/ops` map within 2 s | WEB / STDB | |
| E6 | Tap **Override** on phone 1 | Within 2 s the event log shows `override` and `reassign`; phone card shows normal heat and the button becomes "Rejoin event" | WEB / STDB | |
| E7 | Let the run finish | Status `finished`; totals within 5% of `compareStrategies` and the solved plan | ENGINE / STDB | |
| E8 | Open `/whatif` and `/validation` on a phone with Wi-Fi off after loading them once (or reload on mobile data) | Both render without a Spacetime connection | WEB | |
| E9 | **Reset households**, then **Reset** | Households gone; state back to the preset at hour 0 | STDB / WEB | |

## 2. Phones (`/home`)

Run on each phone; record iOS and Android results separately.

| # | Step | Expected | Result iOS | Result Android |
| --- | --- | --- | --- | --- |
| P1 | Open `/home` from the QR code | Screen 1 names the product in one line; one button "Join as an Anchorage home" | | |
| P2 | Join with defaults | Nickname defaults to "Home NNNN"; heating and thermostat pickers work; "steady heat" checkbox present | | |
| P3 | Consent screen | Says heat may be lowered up to N°F, never below the floor, override any time; no exclamation marks | | |
| P4 | Enroll timing | Under 20 s from scan to live card | | |
| P5 | Live card | Indoor °F (large), setpoint, status, sim clock, countdown to event end | | |
| P6 | Override, then Rejoin | Status changes both ways; `/ops` log shows both | | |
| P7 | Reload the page | Same household (token persisted); no duplicate dot on `/ops` | | |
| P8 | Savings | Cubic feet saved this event and dollars at $17.50/Mcf; community bar | | |
| P9 | "Why this matters" sheet | Opens and closes; text matches Section 3 | | |
| P10 | Width 360–430 px | No horizontal scroll; text readable | | |
| P11 | "Steady heat" household | Shows Exempt; never set back | | |

## 3. Browsers (`/ops`)

| # | Check | Chrome | Safari |
| --- | --- | --- | --- |
| B1 | 1440×900: map and fleet chart both fully visible without scrolling | | |
| B2 | 1280×800: same | | |
| B3 | QR code enlarges on click and scans | | |
| B4 | Every KPI tooltip shows its formula and label | | |
| B5 | Chart axes have titles with units; each chart has a one-line caption | | |
| B6 | System tab: dashed line labeled "Daily capacity ÷ 24 (average)"; caption says the linepack/storage point is assumed | | |
| B7 | Keyboard: every control reachable by Tab, visible focus | | |
| B8 | `prefers-reduced-motion`: household marker does not pulse | | |

## 4. Numbers

Every number on screen must trace to `data/constants.json` or a model function, with a label (AGENTS.md Section 2). For each row, compare the screen value with the reference; tolerance is display rounding unless stated.

| # | Where | Value on screen | Reference | Result |
| --- | --- | --- | --- | --- |
| N1 | `/whatif` defaults (16.7%, 5°F, −20°F, 3 days, Tier 2 0%) | MMcf/day | `whatIf()` with the same inputs and `constants.json` | |
| N2 | `/whatif` "Show the math" | Every formula line | Each constant's value and label in `constants.json` | |
| N3 | `/whatif` % of needle peak, % of 2024 deliverability loss, % of 3 Bcf, $/day | | `whatIf()`; `needle_peak_mmcfd`, `deliverability_loss_mmcfd`, `shortfall_bcf`, `marginal_price_usd_mcf` | |
| N4 | `/ops` KPIs: net relief, peak-hour relief, min indoor °F, % at floor, overrides, value | | `runPlan` totals for the active plan; value uses `marginal_price_usd_mcf` | |
| N5 | `/ops` capacity default per scenario | MMcf/day | `capacityMMcfd` in `data/scenarios/<id>.json` | |
| N6 | `/validation` ConEd card | retention, band, pass/fail | `validateConEdLike()`; band from `validation_coned_band` | |
| N7 | `/validation` SoCal card | r, event %, daily %, band, pass/fail | `validateSoCalLike()`; band from `validation_socal_daily_band` | |
| N8 | `/validation` Anchorage sanity | Mcf/home/day at −20°F | `anchorageSanity()` | |
| N9 | `/validation` parameter table | Every tuned parameter | `data/cohort_spec.json` | |
| N10 | Labels | Every number shows a sourced / derived / assumed chip | `label` in `constants.json` | |
| N11 | Removed numbers | `needle_peak_days` (25 days) appears nowhere | `docs/sources.md` "Dropped" | |
| N12 | Copy | No "AI-powered", "first gas demand response", "cheap", or penetration figures; °F and MMcf/day units visible | AGENTS.md Sections 2–3 | |

## 5. Failure modes

| # | How to cause it | Expected | Result |
| --- | --- | --- | --- |
| F1 | Block `tile.openstreetmap.org` (browser devtools request blocking) and reload `/ops` | SVG fallback map with dots within about 3 s | |
| F2 | Turn off the laptop's network for 10 s during a run, then on | "Disconnected — retrying" banner, then reconnects and resumes live updates | |
| F3 | Force LP failure (capacity far below demand, or the solver timeout) and Solve | "Rule-based fallback in use" banner; plan still dispatches | |
| F4 | Set capacity below what the fleet can cover | "Uncovered shortfall: X MMcf/day" banner, X = worst day's excess | |
| F5 | Second laptop window on `/ops` | Same state within 1 s; non-operator cannot press operator buttons (or they are rejected) | |
| F6 | Phone joins before a scenario is loaded | Clear error, no crash | |

## Runs

(Copy sections 1–5 here per run, with date, time, devices, and tester.)
