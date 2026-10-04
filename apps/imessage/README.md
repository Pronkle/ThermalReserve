# Thermal Reserve iMessage companion

A long-lived Node process that texts linked households through **Photon Spectrum** (`spectrum-ts`) when the simulated dispatch changes their heat. It reads the live SpacetimeDB tables (read-only) and keeps its own memory in local SQLite. Owner: CHAT. Brief: `docs/agents/CHAT_BRIEF.md`.

Status: Phase 1 (proactive notifications, linking, STOP) and Phase 2 (two cooperating agents) verified on a real iPhone. Phase 3 (memory, back-off, contact card, agent screen) is built and tested offline; not yet run on a phone.

## Run it

```sh
npm install                                   # from the repo root
cd apps/imessage
npm test                                      # offline, no credentials
npm run dev                                   # terminal provider: chat in this terminal
npm start                                     # cloud iMessage; needs .env (below)
```

`apps/imessage/.env` (gitignored; never commit it):

```
SPECTRUM_PROJECT_ID=...
SPECTRUM_PROJECT_SECRET=...
ANTHROPIC_API_KEY=...
```

Other settings, all optional:

| Variable | Default | Meaning |
| --- | --- | --- |
| `STDB_DB` | `thermal-reserve-dev` | Database to watch (`thermal-reserve` for production) |
| `STDB_URI` | `wss://maincloud.spacetimedb.com` | Spacetime host |
| `CHAT_DEMO` | off | `1`: quiet hours off, and a log line for every held message |
| `CHAT_THROTTLE_S` | 20 | At most one proactive text per contact per window |
| `CHAT_DEBOUNCE_S` | 1.5 | Wait after a first change so same-tick changes share a text |
| `CHAT_TZ` | `America/New_York` | Recipient time zone for quiet hours (22:00–08:00) |
| `CHAT_HELLO_TO` | unset | A phone (E.164, put it in `.env` only) to text once at startup; see "Photon routing window" |
| `CHAT_DEBUG` | off | `1`: log every raw Spectrum event (numbers masked) |
| `CHAT_VIEWER_PORT` | 8787 | Agent screen on `http://127.0.0.1:<port>/` (`0` turns it off) |
| `CHAT_LLM` | `gemini` on `chat/gemini` | Model backend: `gemini` (concierge `gemini-3.5-flash-lite`, Insights `gemini-3.8-flash`) or `anthropic` (Claude Haiku 4.5 / Sonnet 5.5) |
| `GEMINI_API_KEY` | unset | Google AI Studio key for the Gemini backend (`.env` only) |
| `CHAT_GEMINI_PRICES` | unset | Optional `"liteIn,liteOut,flashIn,flashOut"` $/M tokens so `[usage]` lines show cost |
| `CHAT_ONBOARD` | off | `1`: auto-onboard households that opt in on `/home` (needs `CHAT_OPERATOR_PASSCODE` and `photon login`) |
| `CHAT_OPERATOR_PASSCODE` | unset | The database's operator passcode, used only for `claim_contact_reader` (`.env` only) |
| `PHOTON_PROJECT_ID` | from `.env` | Photon dashboard project id for the CLI (not a secret) |

### Demo day (judging)

```sh
cd apps/imessage
STDB_DB=thermal-reserve CHAT_DEMO=1 CHAT_ONBOARD=1 CHAT_HELLO_TO=<demo phone, E.164> npm start
```

`thermal-reserve` is the judged database (H1, STDB msg 300); fail over with `STDB_DB=thermal-reserve-backup` after the operator presses Reset demo there. `.env` must hold `SPECTRUM_PROJECT_ID`, `SPECTRUM_PROJECT_SECRET`, `ANTHROPIC_API_KEY`, `PHOTON_PROJECT_ID` and that database's `CHAT_OPERATOR_PASSCODE` (from H1, never in the repo), and `photon login` must be current (7-day token). Start it within 5 minutes of the iMessage demo step (Photon routing window), keep the laptop awake and online, and open the agent screen at http://127.0.0.1:8787/.

During judging the process runs on a team laptop (H1-approved exception to "no laptop process"). If it stops, the website is unaffected; texts just stop.

## How linking works (START / STOP, no codes)

1. A household joins on `/home`, ticks "Text me updates by iMessage" and enters a first name, last name and phone. `/home` calls `set_contact`; the row is private (only the companion's identity reads it, via `contact_feed`).
2. The companion adds the number to our Photon project and publishes the person's assigned Photon line (`set_contact_line`); `/home` shows "Text START to {line}".
3. The person texts **START** (any first text works). That is their consent, and it opts them in with Photon, which only lets us text people who have texted their line once. The companion links the number to that household and replies "Thank you. You're set for …".
4. **STOP** at any time deletes everything for the number, here and in the database (`remove_contact`). A number that never opted in on `/home` gets one line explaining how to join.

## Auto-onboarding from /home (H1-approved Oct 4)

A household can tick "Text me updates by iMessage" on `/home` and give a first name, last name and phone (no email). `/home` calls `set_contact`; the row lands in a **private** table that only the companion's identity can read, through the `contact_feed` view after `claim_contact_reader(passcode)`. With `CHAT_ONBOARD=1` the companion then:

1. adds the number to our Photon project with Photon's CLI (`npx -y @photon-ai/cli@2.2.0 spectrum users add`, using the laptop's `photon login`; Photon requires an email, so it gets a reserved `household-<code>@users.invalid` placeholder), skipping numbers already on the list;
2. sends one text-only opener ("…Reply YES to start, or STOP…") and nothing else until they reply YES;
3. deletes everything for that number if they clear it on `/home`, reply STOP, or the household is reset.

The CLI isn't in `package.json`: adding it hits an npm 10 bug and the workaround drops a web dependency from the lockfile, so it runs pinned through `npx` on the laptop only.

## What it sends

The watcher compares each linked household with the last state it told them about, and queues:

- setback start (target ≥ 0.5°F below the normal 70°F), a depth change of 1°F or more, recovery, override and rejoin, event end (net `saved_cf`), and one "your heat stays steady" text for exempt homes.

Changes are merged: at most one text per contact per 20 s. Anything that happens inside the window goes into a single catch-up list (oldest first, at most 5 lines plus "plus N smaller changes", ending with the current state and one question). Every text says "Thermal Reserve demo" and "(simulated)", uses the sim clock in Anchorage time like `/home`, and takes its numbers only from the household row and `data/constants.json`.

Replies it understands now: `START`, `STOP` (deletes everything stored for the number), "thanks"/"ok"/👍 (answered with a tapback, no text), "only big changes" (summary only), "text me every change", "text me anytime" (ignores quiet hours), "no texts at night".

## Two agents (Phase 2)

**Backend (branch `chat/gemini`):** both agents can run on Google Gemini through `src/llm/gemini.ts`, a small adapter that translates the agents' tool-calling loop to Gemini's `generateContent` REST API (plain `fetch`, no new package; thought signatures are passed back unchanged). Comparable stable tiers: the concierge on `gemini-3.5-flash-lite` (fast, low cost, like Haiku) and Insights on `gemini-3.8-flash` (Google's strongest stable agentic tier; the only current Pro is a preview). `CHAT_LLM=anthropic` switches back to Claude. Everything below (tools, honesty guard, handoff log) is the same on both.


The **Concierge** (chatting) runs on **Claude Haiku 4.5** (`claude-haiku-4-5`) to keep spend low. **Insights** (reading the data and the model) runs on **Claude Sonnet 5.5** (`claude-sonnet-5-5`) at `effort: "low"`, with server-side refusal fallbacks on (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`). Every call logs its tokens and cost (`[usage]`).

- **Concierge** (`src/concierge/agent.ts`) owns the conversation: tone, 1–3 bubbles, empathy, preferences, and what to remember about the person. It never computes numbers. For anything with numbers or reasons it calls its `ask_insights` tool with one standalone question (it resolves "the second one" from the thread first).
- **Insights** (`src/insights/agent.ts`) answers that one question with deterministic tools over the live mirror and `packages/model`: `household_now`, `explain_decision` (the "why": which gas day, demand vs the delivery rate and how far above it, depth vs the maximum and the floor, and what a 4-hour morning setback, no program, or the plan this home is on would leave above it. Answers say "delivery rate", matching the pressure overhaul; the companion does not quote pressure numbers), `plan_window`, `weather`, `gas_day`, `compare_strategies`, `constant`, `what_if`. Every number in a tool output carries a unit and a label.
- **Honesty guard** (`src/insights/honesty.ts`): every number in a draft must match, at its written precision, a number in that turn's tool outputs (or the person's own question). On failure Insights rewrites once with the offending numbers named, then falls back to a template built from `explain_decision`'s reasons. The concierge's own reply is checked the same way; if it adds a number, the Insights answer is sent instead.
- **Handoff log**: each question prints `[handoff] concierge → insights: "…" → N tool call(s) [...] → honesty pass`, and appends a JSON line to `data/handoff.jsonl` (the demo's multi-agent evidence).
- Control words never reach a model: `Link`, `NO`, `STOP`, "thanks"/👍 (tapback) and the preference phrases are handled by rules. If the API fails or there is no key, the reply is a deterministic, honest message (with the 62°F floor and Override for "too cold").
- Typing indicator while the agents work; after 8 s a "Checking the numbers…" bubble.

`npm run qa -- <LINKCODE>` pipes the brief's 10 scripted questions through the terminal provider against `thermal-reserve-dev` (needs a working key and a dev run).

Prompt caching: the stable prefix (tools, then the system prompt) is marked for caching. Sonnet 5.5 caches prefixes from 512 tokens, so Insights' ~1,200-token prefix caches; Haiku 4.5 needs 4,096, so the concierge's doesn't.

## Social and persistent context (Phase 3)

- **Memory, limited to the mission.** The concierge's `remember` tool accepts only three categories plus texting preferences: *household* (who needs steady heat or feels the cold, e.g. "infant in the back bedroom"; no diagnoses or other people's names), *comfort* (what feels too cold, cold rooms), *schedule* (when the home is empty or occupied), and a name to use and short or detailed answers. Code enforces it: unknown categories are dropped, at most 5 notes per category, 120 characters each, phone numbers, emails and markup stripped, unknown fields ignored on read.
- **Uses what it remembers.** Each turn gets a memory card (including "last talked 3 hours ago") and the last 16 texts; after a restart the hello says "Last time you asked: …".
- **Backs off when ignored.** After 2 update texts with no reply, the second one says "You haven't replied, so I'll only send the end-of-event summary unless you text me." and nothing else goes out until the summary (which lists everything held). Any text from them resets it.
- **Doesn't talk over itself.** Update texts wait while a reply to that person is being drafted, plus 5 s after it.
- **Contact card** once, after the first exchange (`shareContactCard`, cloud iMessage only).
- **Agent screen** at `http://127.0.0.1:8787/`: each handoff as concierge → insights → tools → honesty result, with the question and answer, beside the live log. Localhost only; log lines are already masked.
- **How savings are calculated** comes from the `savings_method` tool (twin-difference method, labeled efficiency and gas heat content), not from the model.

## What it stores

`apps/imessage/data/chat-<database>.sqlite` (gitignored): phone number ↔ household identity, preferences, last notified state, the queue of unsent changes, an outbox, the last 30 turns per conversation, and the limited person memory above (plus questions already answered and when you last talked). `data/handoff.jsonl` holds questions and answers, not phone numbers. STOP, or the household disappearing (`reset_households`), deletes all of it for that number. Logs mask numbers to the last 4 digits.

## Restart safety

The watcher state and the queue are written in one transaction. Spectrum has no idempotency key, so each proactive text is written to the outbox as `sending` before the network call, and the queue is cleared only once the send resolves. A row still marked `sending` after a crash counts as sent: a restart never repeats a text. In the worst case, one text that was in flight during a crash is lost. Changes that start and finish while the process is down are not reported; only the state it finds on return.

## Photon routing window (observed Oct 4, 01:00–01:10 Eastern)

On our shared-line plan, Photon routed a person's texts to our project only for a while after we had texted them. After about 35 minutes of silence, texts from the demo iPhone showed Delivered but never reached the companion or a bare listener. After one outbound text, replies arrived, including at a bare listener started 2 minutes later. The window's length isn't documented; it's somewhere between 2 and 35 minutes.

What we do about it: set `CHAT_HELLO_TO` to the demo phone so the companion texts it once at startup ("…assistant is on… text START"). During an event, our own updates keep the window open. Before the judged demo, restart the companion (or send any text to the phone) a few minutes ahead.

## Honest limitations

- Photon's shared line can't be texted first, so a person must text START before any update reaches them.
- Household rows update once per Spacetime tick (every 2 simulated hours at 2 h/s), so a short setback appears as one update.
- The terminal provider can't open a conversation first, so in `npm run dev` a restarted process can only text after you type something.
- No real thermostat is controlled; everything is the simulation.

## Layout

```
src/main.imessage.ts   cloud iMessage entrypoint      src/main.terminal.ts   terminal entrypoint
src/app.ts             wiring                          src/config.ts          env + constants
src/stdb/mirror.ts     read-only Spacetime mirror      src/link.ts            household short codes (Photon placeholder email)
src/watcher/           detect, compose, notifier       src/concierge/         inbound rules + concierge agent
src/insights/          Insights agent, tools, honesty   scripts/qa-terminal.sh  10-question acceptance run
src/memory/store.ts    SQLite (node:sqlite)            spike/                 Phase 0 experiments + dev-run driver
```
