# Brief: CHAT (iMessage concierge + insights agent)

Written for a fifth coding agent joining Thermal Reserve at MHacks 2026. Read `AGENTS.md` in full first; it still governs you (ownership, contracts, honesty, secrets, git, AI log, escalation). This brief adds your role. If this brief and `AGENTS.md` disagree, `AGENTS.md` wins until H1 says otherwise. Also read `stdb/HANDOFF.md`, `docs/architecture.md`, `docs/MODELING.md`, `docs/todo-notifications.md` (an earlier notification plan you are now replacing) and `apps/web/src/routes/Home.tsx`.

## 1. Goal and prize track

Build an iMessage companion for enrolled households, on **Photon's Spectrum framework** (`spectrum-ts`). It must:

1. Text the household whenever the dispatch changes their (simulated) thermostat, briefly, and offer to explain why.
2. Answer follow-up questions about **why the model raised or lowered the heat at that time**, grounded in the same data and model that the website shows.
3. Do this through **two cooperating agents**:
   - **Concierge** (conversation agent): owns the iMessage conversation, tone, timing, memory, and deciding when to speak and when to stay quiet. It never computes numbers itself.
   - **Insights** (analyst agent): answers data questions using tools that read the live SpacetimeDB state and call `packages/model`. Every number it states comes from a tool result.

We are entering this prize track, and every design choice below serves it:

> Build AI agents that naturally participate in human conversations through iMessage. Participants can create AI companions, multi-agent systems, or other experiences that understand social context, persist context across interactions, and seamlessly integrate AI into everyday communication. Projects must integrate with Photon's Spectrum framework and use Spectrum to connect their agent to iMessage to qualify for the prize.

Judges must see all four of these working: **natural participation** (it feels like texting a person, not a bot), **social context** (it reads intent, mood, and silence), **persistent context** (it remembers the household across conversations and restarts), and **multi-agent** (Concierge hands questions to Insights and you can show the handoff). **Spectrum must be the iMessage transport.** Don't use BlueBubbles, a raw AppleScript bridge, or SMS APIs.

## 2. What is already decided (verified Oct 3, 2026 against the spectrum-ts repo, v12.10.x; recheck the docs before coding, per AGENTS.md rule 7)

- **Package:** `spectrum-ts` (npm). The cloud iMessage provider is `imessage` from `spectrum-ts/providers/imessage`. Docs: https://docs.photon.codes, source and `docs/` folder: https://github.com/photon-hq/spectrum-ts, dashboard: https://app.photon.codes.
- **No Mac is needed to build or test.** The **cloud** iMessage provider runs on Node or Bun on Linux and connects to Photon's managed lines over gRPC. Only the separate `@spectrum-ts/imessage-local` package needs a Mac (it reads `~/Library/Messages/chat.db`). Do not install the local package; we don't need it. The team's Mac is optional, useful only as one more iPhone/Messages test client.
- **Offline development:** the `terminal` provider (`spectrum-ts/providers/terminal`) needs no credentials and runs the same agent code in a terminal chat UI. In a non-TTY it falls back to a readline loop, which you can use for scripted tests.
- **Core API shape** (from the docs):
  ```ts
  import { Spectrum, text, reply, reaction, Emoji } from "spectrum-ts";
  import { imessage } from "spectrum-ts/providers/imessage";
  const app = await Spectrum({ providers: [imessage.config()] }); // reads SPECTRUM_PROJECT_ID / SPECTRUM_PROJECT_SECRET
  for await (const [space, message] of app.messages) {
    await space.responding(async () => { await space.send(text("...")); }); // typing indicator
  }
  const im = imessage(app);
  const user = await im.user("+15551234567");
  const dm = await im.space.create(user);   // start a DM (outbound)
  await message.react(Emoji.like);          // tapback
  await app.stop();                         // wire to SIGINT/SIGTERM yourself
  ```
- **Plan limits (Free/Pro = shared pool of numbers):** DMs only (no group creation), the sending number may differ per recipient, **5,000 outbound messages per server per day**, **50 new conversations per line per day**.
- **Photon's deliverability guidance:** Apple filters on behavior. Avoid bursts, cold outreach, more than 2–3 unanswered follow-ups, links or media in a first message, and late-night sends. **Inbound-first** conversations (the user texts first) never show the "Report Junk" banner. Share a contact card after the first exchange.
- **Runtime:** the cloud transport needs a long-lived Node process (gRPC stream). It cannot run on Vercel static hosting or in an edge isolate.

## 3. Timeline reality

Per `AGENTS.md` §14, code freeze is **Sun Oct 4, 10:00 Eastern** and judging starts at 11:30. When you start, read the clock and tell your human how many hours remain. Build in the phase order below. Each phase ends with something demoable, so if time runs out you stop at a working phase rather than holding half of everything. If H1 has not extended the freeze for CHAT, cut whatever doesn't fit before 10:00 and say so.

## 4. Ownership, accounts, approvals (do these first; they're escalation triggers)

| Item | Who | Notes |
| --- | --- | --- |
| Your folder | **CHAT owns `apps/imessage/**`** | `apps/*` is already in the root workspaces glob, so no root `package.json` edit is needed. Ask H1 to add a CHAT row to the AGENTS.md "Who's who" table, and send DATA your roster line. |
| New dependencies | **H1 approves** | `spectrum-ts`, `@anthropic-ai/sdk`, a small SQLite library (`better-sqlite3`, or Node 22's built-in `node:sqlite` if it's stable enough; check). `package-lock.json` changes go through the merge gate. |
| Photon project | **Human creates it** at app.photon.codes | Puts `SPECTRUM_PROJECT_ID` and `SPECTRUM_PROJECT_SECRET` in `apps/imessage/.env` (gitignored). Never print or commit them. Ask the human which number(s) the project can be texted on (Phase 0). |
| Claude API key | **Human provides** | `ANTHROPIC_API_KEY` in the same `.env`. |
| Where the process runs during judging | **H1 decides** | `docs/architecture.md` says "no laptop process runs during judging." The options are a team laptop (needs H1's exception) or a host like Railway/Fly/Render (account → human). Ask early; it changes nothing in the code. |
| Changes in `apps/web` (link button on `/home`) | **WEB owns it** | Send a `[REQUEST]` with an exact patch; don't edit it yourself. |
| Any SpacetimeDB schema or reducer change | **H1 approves; STDB implements** | Adding a table doesn't wipe data; adding a column does (`stdb/HANDOFF.md`). Prefer designs with **no** schema change. |
| Copy that mentions AI | **H1/H3** | AGENTS.md §3 says never say "AI-powered." In messages, call it "the Thermal Reserve assistant" and be honest that it's automated if asked. Check with H3 how the Devpost should phrase this for the prize track. |

## 5. Architecture

```
SpacetimeDB (Maincloud, thermal-reserve / thermal-reserve-dev)
   │  subscription (spacetimedb client SDK + @thermal-reserve/stdb-bindings)
   ▼
apps/imessage  (one long-lived Node 22 process)
   ├─ stdb/        live mirror of public tables (sim_config, household, cohort, cohort_state,
   │               plan_hour, weather_hour, aggregate_hour, event_log)
   ├─ watcher/     per-household change detector → "notable change" events
   ├─ concierge/   conversation agent: inbound loop, notification composer, memory, intent, tone
   │     └── asks ──► insights/   analyst agent: Claude + tools over stdb mirror and packages/model
   ├─ memory/      SQLite: contacts, per-person memory, per-thread history, outbox, failures
   └─ transport/   Spectrum app: cloud iMessage in prod, terminal provider in dev (separate entrypoints)
```

- **Two entrypoints, per Spectrum's guidance:** `src/main.imessage.ts` (cloud) and `src/main.terminal.ts` (dev). Everything else takes a transport-agnostic `Spectrum` instance.
- **Read-only to SpacetimeDB** except for the stretch actions in §8. Verify that the `spacetimedb` 2.10.2 client SDK and the generated bindings run in Node (they're used in the browser today). Connect with your own identity token, stored in `.env` or a gitignored file, never the operator passcode.
- **`packages/model` is a dependency, not something you edit.** It's pure TypeScript; HiGHS runs in Node. Import `compareStrategies`, `runPlan`, `solvePlan`, `whatIf`, `loadConstants`, `normalSetpointF`, and read `data/*.json` the way `apps/web/src/lib/ops.ts` does. If you need a new export (for example LP dual values per gas day), send ENGINE a `[REQUEST]`.

### 5.1 Linking a phone to a household

The user wants the phone number given at registration. Two designs; spike both in Phase 0 and pick one with H1.

**A. Inbound-first link (preferred: no schema change, phone never stored in SpacetimeDB, follows Photon's best practice).**
- After joining, `/home` shows a button **"Get updates by iMessage"**. It's an `sms:<photon line>&body=Link my home <CODE>` deep link, so the user only taps Send. Registration is giving the number: the user's own text delivers it.
- `<CODE>` = first 6 characters of base32(SHA-256(household identity hex)). `/home` knows its identity; the concierge computes the same code for every household from the public `household` table.
- The concierge receives the text, matches the code, replies with a confirmation that names the home's nickname ("Linked to Test iPhone. Reply NO if that isn't your home."), and stores phone ↔ identity in its own SQLite.
- Requires Photon to give us a number that users can text first. Confirm in Phase 0. Caveat to state honestly: the identity is public, so a determined person could link to someone else's home. That's acceptable for a demo; say so in the README.

**B. Typed number + outbound first message (fallback if A isn't possible on our plan).**
- Add an optional phone field to the `/home` consent screen (WEB) and a **private** table `household_contact(identity, phone_e164, opted_in_at)` with a `set_contact` reducer (STDB, H1-approved; adding a table is safe). The phone must **never** go in the public `household` table.
- Verify how a non-owner client can read a private table in the current SpacetimeDB TypeScript API (views or procedures; `packages/stdb-bindings/src/types/procedures.ts` shows procedures exist). Don't use the database owner's credentials in the concierge.
- The concierge then `im.space.create(user)`s and sends a text-only opener with no link that asks a question ("Thermal Reserve demo here for Test iPhone. Want a text when your heat changes during an event? Reply YES."). Nothing else is sent until the user replies. This counts toward the 50 new conversations per line per day.

Either way: consent is explicit, STOP works immediately, `reset_households` (household row gone) → the concierge deletes that contact and memory within one minute.

## 6. Behavior spec

### 6.1 When to text (watcher → concierge)

The simulation runs at 0.5–4 sim-hours per real second, so the 72-hour event lasts 18–144 real seconds. A message per tick would be a burst that gets the line flagged. Notify on **transitions**, then coalesce:

| Trigger (per linked household) | Detected from |
| --- | --- |
| Setback begins (normal → holding) | `household.target_f` drops ≥ 0.5°F below that clock hour's normal setpoint |
| Depth changes by ≥ 1°F while holding | `target_f` vs the last notified target |
| Recovery begins (heat raised back) | target returns to normal while `ta_f` is still below it |
| Household overrides / rejoins | `household.overridden` flips; acknowledge, don't explain |
| Event ends | `sim_hour ≥ event_end_hour`; one summary with net `saved_cf` |
| Exempt households | One message at event start ("your heat stays steady"), nothing more |

- **Throttle and catch-up list:** at most one proactive message per household per 20 real seconds (configurable). Transitions that happen while a household is rate limited are queued, not dropped. When the window opens, send **one** message that lists every queued transition since the last message sent, oldest first, each with its simulated time and the new target or state, and ending with the current state and one question. Example:
  > Since my last text (simulated):
  > • Thu 06:00 heat lowered to 66°F
  > • Thu 14:00 lowered further to 65°F
  > • Fri 02:00 heat raised back toward 70°F
  > Now: indoor 67.1°F, recovering. Want the reasons behind any of these?
  - Send it as one message, never one bubble per event (bubbles would recreate the burst).
  - If more than 6 transitions are queued, list the 5 most important (setback start, deepest point, recovery start, override, event end) and add "plus N smaller changes."
  - Clear the queue only after the send is acknowledged, so a crash or restart neither loses nor repeats items (§6.1 restart safety).
  - The concierge keeps the listed events in thread history, so a reply like "why the second one?" resolves to the right event.
- **Unanswered streak:** after 2 proactive messages with no reply, switch that person to "event summary only" until they text again; the summary uses the same catch-up list format. Tell them once that you're doing this. (This is social awareness and deliverability in one.)
- **Quiet hours:** use the real clock. No proactive texts 22:00–08:00 in the recipient's time zone unless they opted in. Demo night may need the opt-in, so make it a stored preference ("text me anytime").
- **Demo mode flag** (`CHAT_DEMO=1`): shorter throttle, quiet hours off, and a log line for every suppressed message so you can show judges why it stayed silent.
- **Restart safety:** persist "last notified state" per household, and give every outbound message a stable id (Spectrum's clientGuid pattern in `docs/best-practices/recovery-and-state`), so a restart never re-sends.

### 6.2 What a proactive message looks like

Short, specific, one question at the end. Plain words, °F, sim clock labeled, no exclamation marks (AGENTS.md copy rules). Always mark it as a simulation.

> Thermal Reserve demo, Thu Feb 1 06:00 (simulated): we lowered Test iPhone's heat to 66°F. Indoor is 68.4°F and will stay above 62°F. Want to know why now?

> Heat's coming back up to 70°F. Tomorrow has spare gas capacity, so the reheat happens then. Ask me anything.

The concierge writes these from a **structured fact object** the watcher builds (times, temperatures, reasons from §7.2). The LLM chooses wording and length; it never invents the facts. Use `space.responding()` for the typing indicator, and use 1–3 bubbles, never a wall of text.

### 6.3 Conversation (concierge)

Classify each inbound message (one cheap model call or rules first) into:

| Intent | Response |
| --- | --- |
| Why / how / when / how much (data question) | Hand to Insights (§7), relay the answer in the user's style |
| Acknowledgement ("ok", "thanks", "👍") | Tapback (`Emoji.like` / `love`), no text. This is what a person does. |
| Feeling cold / unhappy | Empathize briefly, state the floor (62°F), tell them how to override (Override button on `/home`; or by text, a stretch in §8) |
| Preference ("only big changes", "stop at night", "call me Sam", "shorter") | Save to memory, confirm in one line |
| STOP / unsubscribe | Unlink immediately, confirm once, never text again unless they text first |
| Small talk / off-topic | One friendly line, steer back gently; don't pretend to be human |
| Can't answer from data | Say so plainly; never guess |

### 6.4 Memory (persistent context)

SQLite in `apps/imessage/data/` (gitignored). Scope memory by person (`resourceId` = sender address) and history by thread, per Spectrum's recovery-and-state guidance.

- **Contact:** phone, household identity, linked_at, opted_in, quiet-hours setting, notification level, unanswered streak, last notified state.
- **Person memory** (small JSON the concierge updates through a tool): preferred name, verbosity, things they care about ("worried about the baby's room", "likes numbers"), questions already answered (so it doesn't repeat itself), last explanation given.
- **Thread history:** last ~30 turns, sent to the models with prompt caching on the stable prefix.
- **Outbox and failures** tables per §6.1 restart safety.
- **Show it off:** after a restart, a returning user gets a reply that uses what was remembered ("Last time you asked about tomorrow; it's colder, so…").

## 7. Insights agent

### 7.1 Interface

```ts
ask(input: { question: string; householdIdentity: string; simHour: number; personMemory: PersonMemory })
  : Promise<{ answer: string; facts: Fact[]; toolCalls: string[] }>
```

It runs in-process behind this interface so it can later become its own service (or power an "Ask why" box on `/home`). Log every handoff (`concierge → insights: "why now?" → 3 tool calls → answer`) in a form you can put on screen during the demo; that log is our multi-agent evidence.

### 7.2 Tools (deterministic code; the model only picks tools and writes prose)

| Tool | Returns (all numbers with unit and label: sourced / derived / assumed) |
| --- | --- |
| `household_now(identity)` | Indoor °F, target °F, normal setpoint now, mode, overridden, exempt, saved cf, cohort key in plain words (e.g. "furnace, average envelope") |
| `plan_window(identity, fromHour, toHour)` | Planned target per hour for the household's template cohort (`plan_hour`) vs normal setpoint; strategy and plan id |
| `weather(fromHour, toHour)` | Outdoor °F per hour (`weather_hour`), with the scenario name and source |
| `gas_day(day)` | No-program system demand, capacity (daily), shortfall, relief so far, live vs planned (`aggregate_hour` + scenario + `capacity_mmcfd`) |
| `explain_decision(identity, hour)` | **The core "why."** A structured reason list: which gas day the hour belongs to; that day's demand vs capacity; whether the setback is there to cover that day's shortfall, or the heat is being recovered on a day with spare capacity; the depth chosen vs the maximum allowed and the 62°F floor; the counterfactual from `compareStrategies` (what NAIVE_4H or no program would leave uncovered that day). Pure function, unit-tested. |
| `compare_strategies()` | Cached `compareStrategies` result for the current scenario and enrolled count: per-day net relief and uncovered shortfall per strategy |
| `constant(key)` | Value, unit, label, source from `data/constants.json` |
| `what_if(...)` | `whatIf` from the model, with `formulaLines` |

Optional, if ENGINE can add it in time: the LP's dual value on each gas day's capacity constraint ("how much comfort one more MMcf of gas costs that day") makes `explain_decision` much sharper. Request it; don't block on it.

### 7.3 Honesty guard (it's our team's edge; make it visible)

- The system prompt requires every number in an answer to come from a tool result in this turn, with its label when it's assumed or derived. Never claim real thermostat control. Say "simulated."
- **Post-check:** extract the numbers from the draft answer and confirm each appears, rounded, in that turn's tool outputs. On failure, regenerate once with the offending numbers listed, then fall back to a template answer built from `facts`. Unit-test the checker.
- If the household has no plan data (BASELINE dispatched, or no event), say there's no setback and why. Don't make one up.

### 7.4 Models

Use the Claude API with tool use. Read the current model list and the prompt-caching docs before choosing (the Claude API skill or docs). Suggested split: a fast, cheap model for concierge intent and wording (Haiku 4.5), and a stronger one for Insights (Sonnet 5.5). Set timeouts. If Insights takes longer than ~8 s, the concierge sends "Checking the numbers…" inside `responding()` so the chat never goes silent.

## 8. Phases and acceptance

**Phase 0: Spike and decisions (target ≤ 1 h).**
- Hello-world on the `terminal` provider; then cloud iMessage from Linux to a teammate's iPhone (human provides credentials).
- Node script subscribes to `thermal-reserve-dev` with the generated bindings and prints `household` updates during a run.
- Find out from the dashboard or docs which number users can text first on our plan → choose link design A or B with H1.
- Get H1's answers on hosting, dependencies, and the CHAT row.
- *Accept:* a real iMessage sent from a Linux process lands on an iPhone; household updates stream into Node. Post `[CP] CHAT phase 0` with the decisions.

**Phase 1: Proactive notifications (the core loop).**
- Linking (A or B), watcher, throttle/coalesce, the four message types, STOP, persistence of contact and last-notified state.
- *Accept:* on `thermal-reserve-dev`, with the Demo preset + Optimized plan at 2 h/s, a linked phone receives between 3 and 6 messages for the whole run (start, ≤ 2 changes, recovery, summary), none within 20 s of another, all with correct °F matching `/home`; every transition the watcher detected appears in exactly one message (sent directly or in a catch-up list). Restarting the process mid-run sends no duplicates.

**Phase 2: Insights + Q&A (multi-agent).**
- Insights tools, `explain_decision`, honesty guard, concierge intent routing, tapbacks, typing indicators.
- *Accept:* for 10 scripted questions (the "why now", "how cold will it get", "why not yesterday", "how much have I saved", "what if 50,000 homes", "is this real", one off-topic, one "too cold", one "thanks", one STOP) run through the terminal provider in non-TTY mode, every numeric answer passes the honesty check and matches the model or `/home` values; "thanks" produces a tapback only; STOP unlinks.

**Phase 3: Social and persistent context (what wins the track).**
- Person memory and preferences, unanswered-streak behavior, quiet hours, a remembered-context reply after restart, contact-card share after the first exchange (cloud supports it), handoff log viewer for the demo.
- *Accept:* a three-session script (link → ask why → set "only big changes" → restart → event) shows the preference honored and earlier context used.

**Stretch (only with H1 approval; each needs STDB work):** text "override" / "rejoin" to act on the household (a concierge-authorized `override_for` reducer); a household group chat for family members (needs a Business dedicated line); "Ask why" box on `/home` backed by the same Insights agent.

**Every phase:** `npm test` from the root must pass **offline with no credentials** (the merge gate runs it). Put network/credential tests behind an env flag. `npm run build -w apps/web` still passes. Log each `[DONE]` in `docs/AI_LOG.md`.

## 9. Demo script contribution (send to H3 and DATA for `docs/phone-test-procedure.md` and the pitch)

1. Judge joins on `/home`, taps **Get updates by iMessage**, sends the prefilled text, and gets "Linked to <nickname>" plus a contact card.
2. Operator dispatches Optimized and starts at 1 h/s (slower than the usual 2 h/s so messages have room).
3. Judge's phone: "we lowered your heat to 66°F… want to know why now?" → judge types "why?" → the typing indicator shows → a 2-bubble answer citing that day's gas shortfall vs capacity and where the reheat lands, with labels.
4. Judge: "that's cold for my kid" → empathy, the 62°F floor, how to override. Judge: "thanks" → a tapback, no text.
5. Screen shows the handoff log: concierge → insights → tools → answer, with the honesty check passing.
6. Event ends → a summary text with net cubic feet saved, labeled simulated.

## 10. Deliverables

- `apps/imessage/` with `README.md` (setup, env vars, how to run terminal mode and iMessage mode, link design, honest limitations), tests, and both entrypoints.
- `[REQUEST]` to WEB with the `/home` patch (link button and copy); `[REQUEST]` to STDB only if design B or a stretch is chosen.
- Text for DATA: a Devpost subsection "iMessage companion (Photon Spectrum)" covering the multi-agent design, memory, social behaviors, and the honesty guard, plus an architecture diagram update for `docs/architecture.md`.
- Q&A lines for `docs/qa.md`: what we store (phone, preferences; deleted on STOP and on household reset), why inbound-first, why it doesn't spam.

## 11. Do not

- Commit `.env`, tokens, Photon secrets, the SQLite file, or any phone number (tests use fake `+1555…` numbers).
- Put a phone number in any public SpacetimeDB table, in logs at info level, or in a URL.
- Send messages in bursts, more than 2 follow-ups to a non-responder, links or media in a first message, or anything to a number that didn't opt in.
- Let the LLM produce a number that no tool produced, claim real thermostat control, use exclamation marks, or say "AI-powered."
- Edit files outside `apps/imessage/**` (send `[REQUEST]`s), change a contract without H1, or install `@spectrum-ts/imessage-local`.
- Use any iMessage transport other than Spectrum (it disqualifies us from the prize).
