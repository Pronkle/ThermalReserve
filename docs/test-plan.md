# Test plan

Run by DATA with H3 at Checkpoint 3 (Sun 02:00–03:00), then the end-to-end test every hour after 06:00 (AGENTS.md Section 14). Production URL: <https://thermal-reserve.vercel.app>.

**How to record.** Fill the Result column with PASS, FAIL, or SKIP (with reason). File every FAIL as a `[REQUEST]` to the owner with steps to reproduce, device and browser, and a screenshot path. Copy this file's tables into a dated section at the bottom for each run.

## 0. Setup

| # | Item | Notes |
| --- | --- | --- |
| 0.1 | Devices | Team has: iPhone (Safari), Android phone (Chrome), Mac (Safari and Chrome for `/ops`), Windows and Linux laptops (Chrome; second `/ops` window for F5, and Edge/Firefox spot-check if time allows) |
| 0.2 | Fresh state | Laptop: fresh browser profile. Phones: clear site data for the Vercel URL |
| 0.3 | Operator passcode | From H1 in person; never typed into chat or the repo |
| 0.4 | Database | `thermal-reserve` (production) unless H1 says otherwise |

## 1. End-to-end demo test (Section 14)

| # | Step | Expected | Owner if it fails | Result |
| --- | --- | --- | --- | --- |
| E1 | Open `/ops` in a fresh profile; claim operator; press **Demo preset** | `feb2024` loaded, 25,000 enrolled, speed 2 h/s, **comfort floor 62°F**, status idle at hour 0. The demo never uses a floor below 62°F (60–61°F is a study-only setting, H3 decision) | WEB / STDB | |
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
| P3 | Consent screen | Says heat may be lowered up to N°F, **never below 62°F** (server-enforced for real households since 0502d71), override any time; no exclamation marks | | |
| P4 | Enroll timing | Under 20 s from scan to live card | | |
| P5 | Live card | Indoor °F (large), setpoint, status, sim clock, countdown to event end | | |
| P6 | Override, then Rejoin | Status changes both ways; `/ops` log shows both | | |
| P7 | Reload the page | Same household (token persisted); no duplicate dot on `/ops` | | |
| P8 | Savings | Cubic feet saved this event and dollars at $17.50/Mcf; community bar | | |
| P9 | "Why this matters" sheet | Opens and closes; text matches Section 3 | | |
| P10 | Width 360–430 px | No horizontal scroll; text readable | | |
| P11 | "Steady heat" household | Shows Exempt; never set back | | |
| P12 | Operator floor set to 60°F (study setting), then a phone joins | The phone's household still never goes below 62°F | | |

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

Every number on screen must trace to `data/constants.json` or a model function, with a label (AGENTS.md Section 2). "Expected" values were computed on `main` (615b4d6; demo values updated for 6% overrides per ENGINE, d29e79e) (UA 398.3, HHV 988, tuned `cohort_spec.json`) and match ENGINE's `packages/model/NUMBERS.md`; if a constant changes, recompute them from the reference. Tolerance is display rounding (MMcf/day 2 dp, °F 1 dp, % 1 dp, $ nearest 100) unless stated.

| # | Where | Expected on screen | Reference | Result |
| --- | --- | --- | --- | --- |
| N1 | `/whatif` defaults (16.7%, 5°F, −20°F, 3 days, Tier 2 0%) | **1.43 MMcf/day** | `whatIf().mmcfPerDay` | |
| N2 | `/whatif` "Show the math" | 9 formula lines, printed verbatim, each constant with its label in brackets (e.g. "UA 398 BTU/(h·°F) [derived]", "HHV 988 BTU/cf [sourced]") | `whatIf().formulaLines` | |
| N3 | `/whatif` shares and value at defaults | **7.1%** of needle peak · **5.0%** of 2024 deliverability loss · **0.14%** of 3 Bcf (3 days) · **$24,900/day** | `whatIf()` fields | |
| N3b | `/whatif` copy | Changing outdoor °F does **not** change the result, and the page doesn't imply colder = more savings | NUMBERS.md note | |
| N4 | `/ops` KPIs after **Demo preset** (`feb2024`, 25,000 homes, 6% overrides), OPTIMIZED dispatched | Relief on the tightest day (Feb 2) **2.06 MMcf/day** · uncovered shortfall **0.94 MMcf/day** · value **$36,100/day** (tightest-day relief × $17.50/Mcf). With overrides set to 0: 2.15 / 0.85 / $37,600 | `gasDays(runPlan(...))`; NUMBERS.md | |
| N4b | Same (Demo preset, 6% overrides), uncovered shortfall per strategy | none **3.00** · naive **2.80** · staggered **1.69** · optimized **0.94** MMcf/day (overrides 0: 3.00 / 2.80 / 1.64 / 0.85) | `gasDays()`; NUMBERS.md | |
| N4c | `/ops` minimum indoor and homes at floor | Min indoor may read 64.0°F (night setback homes); homes at floor counts only program-held homes; overrides 0 under BASELINE | NUMBERS.md `/ops` table | |
| N5 | `/ops` capacity default per scenario | design **292.5** · feb2024 **265.0** · lastwinter **251.3** MMcf/day | `capacityMMcfd` in `data/scenarios/<id>.json` | |
| N6 | `/validation` ConEd card | retention **0.465** (shown 0.47 at 2 dp), target 0.48, band 0.38–0.58, **pass** | `validateConEdLike()` | |
| N7 | `/validation` SoCal card | r **0.30**, event **15.1%**, daily **1.14%** vs 2.2% published, band 1.5–3.0%, **gap** in amber (not a red fail) | `validateSoCalLike()` | |
| N8 | `/validation` Anchorage sanity | **1.04 Mcf/home/day** at −20°F, 70°F | `anchorageSanity()` | |
| N9 | `/validation` parameter table | Ca **1,500 / 3,000** BTU/°F · Ham ×**1.5** · τ **40 / 60** h, all labeled assumed, with allowed ranges | `data/cohort_spec.json` | |
| N10 | Labels | Every number shows a sourced / derived / assumed chip | `label` in `constants.json` | |
| N11 | Removed numbers | `needle_peak_days` (25 days) appears nowhere | `docs/sources.md` "Dropped" | |
| N11b | Energy Watch wording | If the 1.5% appears, it says "energy load", not gas use | `docs/sources.md` | |
| N12 | Copy | No "AI-powered", "first gas demand response", "cheap", or penetration figures; °F and MMcf/day units visible; plain words, not code names like `NAIVE_4H` | AGENTS.md Sections 2–3 | |

### Pre-check on production, Sat 17:50 (DATA, headless Chromium, no login)

| Check | Result |
| --- | --- |
| All five routes return 200 | PASS |
| `/ops` at 1280×800 and 1440×900: map and fleet chart fully visible, no scroll | PASS |
| Connected to `thermal-reserve`; KPI label chips; units; "No real thermostats are controlled" footer | PASS |
| N4: KPIs headline a 4-day average ("Net relief 0.21 MMcf/day", "Gas value $3,600/day"), not the tightest day | FAIL, filed to WEB (planned in W3) |
| N12: chart legend shows `BASELINE`, `NAIVE_4H`, `SUSTAIN_STAGGER` | FAIL, filed to WEB |
| Water mask not yet used for map dots | Pending WEB |
| QR code in header | Pending W4 |

### Pre-check on production after W4, Sat 18:50 (DATA, headless Chromium, no login, no join)

Production bundle `index-CMwD9--i.js` = main a60e3e3.

| Check | Result |
| --- | --- |
| `/home` at 390 px: one-line pitch, "Join as an Anchorage home", "does not connect to your thermostat", footer, no horizontal scroll (P1, P10) | PASS |
| `/ops` at 1280×800: QR in header, plain legend names, footer visible, uncovered banner | PASS (earlier N4 and N12 FAILs now fixed) |
| `/ops` Staggered preview, feb2024, 25k: tightest-day relief 1.31, value $22,900 (= 1.31 × $17,500), uncovered 1.69 (matches NUMBERS.md, 6% overrides) | PASS |
| Join flow, override, reload (P2–P9, P11, P12) | Not run (would add a household to production); real phones at 02:00 |

### Run 0: H1's real-phone check on production, Sat ~18:45 (reported by STDB msg 132, ENGINE msg 134)

| Check | Result |
| --- | --- |
| Two real phones joined via https://thermal-reserve.vercel.app/home and ticked through a `feb2024` OPTIMIZED run to hour 96 | PASS (H1 reports it worked; server shows 2 households) |
| Household floor 62°F on both (P12 server side) | PASS (`floor_f` = 62 each) |
| Live household saving vs model | PASS: `saved_cf` ≈ 63 cf vs NUMBERS.md ~64 cf (steady-average-light template) |
| Event log: dispatch, 2 joins, override and reassign entries (E5, E6) | PASS (server side); which override entries came from the phones is not distinguishable |
| Devices (one iOS, one Android?) | **Unknown: H1 to confirm.** Run 1 at 02:00 covers both explicitly |
| Join time, map-dot timing, reload persistence, consent text (P1–P11) | Not recorded; covered in Run 1 |

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
