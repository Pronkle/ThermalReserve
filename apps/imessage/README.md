# Thermal Reserve iMessage companion

A long-lived Node process that texts linked households through **Photon Spectrum** (`spectrum-ts`) when the simulated dispatch changes their heat. It reads the live SpacetimeDB tables (read-only) and keeps its own memory in local SQLite. Owner: CHAT. Brief: `docs/agents/CHAT_BRIEF.md`.

Status: Phase 1 (proactive notifications, linking, STOP) verified on a real iPhone. Phase 2 (two cooperating agents answering questions) is built and unit-tested with a scripted model; the live 10-question run waits for a working `ANTHROPIC_API_KEY`.

## Run it

```sh
npm install                                   # from the repo root
cd apps/imessage
npm test                                      # offline, no credentials
npm run dev                                   # terminal provider: chat in this terminal
npm start                                     # cloud iMessage; needs .env (below)
npm run codes                                 # list each household's link code (nickname → code)
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

During judging the process runs on a team laptop (H1-approved exception to "no laptop process"). If it stops, the website is unaffected; texts just stop.

## How linking works (design A, inbound-first)

1. A household joins on `/home`. Its link code is the first 6 characters of base32(SHA-256(identity hex, lowercase, as UTF-8 text)).
2. The person texts `Link my home <CODE>` to the Thermal Reserve line. Their own text is the opt-in and gives us their number; we never store it in SpacetimeDB.
3. The companion replies `Linked to <nickname>…` and offers `NO` (wrong home) and `STOP`.

Photon's shared-line plan only delivers to numbers added as users of our Photon project, so a phone must be added in the Photon dashboard before it can link.

## What it sends

The watcher compares each linked household with the last state it told them about, and queues:

- setback start (target ≥ 0.5°F below the normal 70°F), a depth change of 1°F or more, recovery, override and rejoin, event end (net `saved_cf`), and one "your heat stays steady" text for exempt homes.

Changes are merged: at most one text per contact per 20 s. Anything that happens inside the window goes into a single catch-up list (oldest first, at most 5 lines plus "plus N smaller changes", ending with the current state and one question). Every text says "Thermal Reserve demo" and "(simulated)", uses the sim clock in Anchorage time like `/home`, and takes its numbers only from the household row and `data/constants.json`.

Replies it understands now: `Link <code>`, `NO`, `STOP` (deletes everything stored for the number), "thanks"/"ok"/👍 (answered with a tapback, no text), "only big changes" (summary only), "text me every change", "text me anytime" (ignores quiet hours), "no texts at night".

## Two agents (Phase 2)

Both run on **Claude Haiku 4.5** (`claude-haiku-4-5`), chosen to keep spend low.

- **Concierge** (`src/concierge/agent.ts`) owns the conversation: tone, 1–3 bubbles, empathy, preferences, and what to remember about the person. It never computes numbers. For anything with numbers or reasons it calls its `ask_insights` tool with one standalone question (it resolves "the second one" from the thread first).
- **Insights** (`src/insights/agent.ts`) answers that one question with deterministic tools over the live mirror and `packages/model`: `household_now`, `explain_decision` (the "why": which gas day, demand vs capacity, shortfall, depth vs the maximum and the floor, and what a 4-hour morning setback or no program would leave uncovered), `plan_window`, `weather`, `gas_day`, `compare_strategies`, `constant`, `what_if`. Every number in a tool output carries a unit and a label.
- **Honesty guard** (`src/insights/honesty.ts`): every number in a draft must match, at its written precision, a number in that turn's tool outputs (or the person's own question). On failure Insights rewrites once with the offending numbers named, then falls back to a template built from `explain_decision`'s reasons. The concierge's own reply is checked the same way; if it adds a number, the Insights answer is sent instead.
- **Handoff log**: each question prints `[handoff] concierge → insights: "…" → N tool call(s) [...] → honesty pass`, and appends a JSON line to `data/handoff.jsonl` (the demo's multi-agent evidence).
- Control words never reach a model: `Link`, `NO`, `STOP`, "thanks"/👍 (tapback) and the preference phrases are handled by rules. If the API fails or there is no key, the reply is a deterministic, honest message (with the 62°F floor and Override for "too cold").
- Typing indicator while the agents work; after 8 s a "Checking the numbers…" bubble.

`npm run qa -- <LINKCODE>` pipes the brief's 10 scripted questions through the terminal provider against `thermal-reserve-dev` (needs a working key and a dev run).

Prompt caching: the stable prefix (tools, then the system prompt) is marked for caching, but Haiku 4.5 only caches prefixes of 4,096 tokens or more and ours is shorter, so expect no cache hits at this size.

## What it stores

`apps/imessage/data/chat-<database>.sqlite` (gitignored): phone number ↔ household identity, preferences, last notified state, the queue of unsent changes, an outbox, the last 30 turns per conversation, and a small person memory (preferred name, verbosity, what they care about, questions already answered). `data/handoff.jsonl` holds questions and answers, not phone numbers. STOP, or the household disappearing (`reset_households`), deletes all of it for that number. Logs mask numbers to the last 4 digits.

## Restart safety

The watcher state and the queue are written in one transaction. Spectrum has no idempotency key, so each proactive text is written to the outbox as `sending` before the network call, and the queue is cleared only once the send resolves. A row still marked `sending` after a crash counts as sent: a restart never repeats a text. In the worst case, one text that was in flight during a crash is lost. Changes that start and finish while the process is down are not reported; only the state it finds on return.

## Photon routing window (observed Oct 4, 01:00–01:10 Eastern)

On our shared-line plan, Photon routed a person's texts to our project only for a while after we had texted them. After about 35 minutes of silence, texts from the demo iPhone showed Delivered but never reached the companion or a bare listener. After one outbound text, replies arrived, including at a bare listener started 2 minutes later. The window's length isn't documented; it's somewhere between 2 and 35 minutes.

What we do about it: set `CHAT_HELLO_TO` to the demo phone so the companion texts it once at startup ("…assistant is on…", with the link code when there is one household). During an event, our own updates keep the window open. Before the judged demo, restart the companion (or send any text to the phone) a few minutes ahead.

## Honest limitations

- Household identities are public, so anyone who knows the code could link a phone to someone else's home. Acceptable for a demo; `NO` undoes a wrong link.
- Household rows update once per Spacetime tick (every 2 simulated hours at 2 h/s), so a short setback appears as one update.
- The terminal provider can't open a conversation first, so in `npm run dev` a restarted process can only text after you type something.
- No real thermostat is controlled; everything is the simulation.

## Layout

```
src/main.imessage.ts   cloud iMessage entrypoint      src/main.terminal.ts   terminal entrypoint
src/app.ts             wiring                          src/config.ts          env + constants
src/stdb/mirror.ts     read-only Spacetime mirror      src/link.ts            link codes
src/watcher/           detect, compose, notifier       src/concierge/         inbound rules + concierge agent
src/insights/          Insights agent, tools, honesty   scripts/qa-terminal.sh  10-question acceptance run
src/memory/store.ts    SQLite (node:sqlite)            spike/                 Phase 0 experiments + dev-run driver
```
