# Running the BoreaFlux iMessage companion (Photon Spectrum) on a new computer

For an agent taking over CHAT. Follow the steps in order; each has a check. No secret values are in this file: H3 hands you the `.env` file separately (step 3). Written Oct 4, 2026; the companion was verified live on production with Gemini that afternoon.

## What it is, in one paragraph

A long-lived Node process (`apps/imessage`) that connects to the live SpacetimeDB database (read-mostly), texts opted-in households through **Photon Spectrum** cloud iMessage (`spectrum-ts`, no Mac needed), and answers their questions with two agents: a concierge (chat) and Insights (data and reasons, deterministic tools over the live data and `packages/model`). Models: `gemini-3.5-flash-lite` (concierge) and `gemini-3.8-flash` (Insights) by default on branch `chat/gemini`; `CHAT_LLM=anthropic` switches to Claude Haiku 4.5 / Sonnet 5.5. A local agent screen shows each handoff at `http://127.0.0.1:8787/`.

## 0. Only one companion may run at a time

Two companions double-reply to every text and steal the database's contact-reader role from each other. **Before you start yours, the one on H3's laptop must be stopped** (H3 runs `pkill -f demo-run.sh; pkill -f main.imessage.ts` there).

## 1. Prerequisites

- Linux or macOS. **Node 22.13 or newer** (`node --version`; the store uses the built-in `node:sqlite`). Tested on 22.23.3. npm 10. git.
- Internet access to `*.imsg.photon.codes:443` (gRPC), `maincloud.spacetimedb.com` (WebSocket), `generativelanguage.googleapis.com` (or `api.anthropic.com`).
- An iPhone whose number is (or will be) on the Photon project's user list, for testing.

## 2. Get the code

```sh
git clone https://github.com/Pronkle/ThermalReserve.git
cd ThermalReserve
git checkout chat/gemini        # until it is merged; after that, main
npm ci                          # never `npm install <pkg>`; see Gotchas
npm run test -w apps/imessage   # check: 82 passed, offline, no credentials needed
```

## 3. Create `apps/imessage/.env` (gitignored; never commit it)

H3 copies their file to `apps/imessage/.env` on your machine (USB, AirDrop, a password manager; not Git, not Agent Mail). It holds these variables:

| Variable | What it is | Where it comes from |
| --- | --- | --- |
| `SPECTRUM_PROJECT_ID`, `SPECTRUM_PROJECT_SECRET` | Photon Spectrum project credentials (the iMessage transport) | Photon dashboard, project "Thermal Reserve" (app.photon.codes) |
| `PHOTON_PROJECT_ID` | Photon **dashboard** project id, used by the Photon CLI to add users (not a secret, differs from the Spectrum id) | `npx -y @photon-ai/cli@2.2.0 projects ls --json` after step 4 |
| `GEMINI_API_KEY` | Google AI Studio key (free tier works for both models) | aistudio.google.com |
| `ANTHROPIC_API_KEY` | Only for `CHAT_LLM=anthropic` | console.anthropic.com |
| `CHAT_OPERATOR_PASSCODE` | Operator passcode of the database you run against, used only to claim the contact reader | H1 (production); `dev-passcode` on `thermal-reserve-dev` |
| `CHAT_TEST_PHONE` | H3's iPhone (E.164), used only by the spikes and the optional startup hello | H3 |

Optional, outside `.env` if you like: `CHAT_HELLO_TO=<E.164>` (texts that phone once at startup), `CHAT_GEMINI_PRICES=0.30,2.50,0.75,3.75` (cost in logs on a paid key), `CHAT_VIEWER_PORT` (default 8787), `CHAT_DEBUG=1` (log every raw Spectrum event).

Check (prints names only): `grep -oE '^[A-Z_]+=' apps/imessage/.env`

## 4. Log in to Photon's CLI on this computer (one time, 7 days)

The companion adds new households to the Photon project with Photon's own CLI, run pinned through `npx` (it is deliberately not in `package.json`; see Gotchas). The CLI keeps its login in `~/.config/photon/credentials/` on this machine.

```sh
npx -y @photon-ai/cli@2.2.0 login            # opens a browser; H3 approves with their Photon account
npx -y @photon-ai/cli@2.2.0 projects ls --json   # check: a project named "Thermal Reserve"
npx -y @photon-ai/cli@2.2.0 spectrum users ls --json --project "$PHOTON_PROJECT_ID"   # check: lists users
```

On a headless machine: `login --no-browser` prints a URL to approve elsewhere.

## 5. Start it for the demo

Linux (detached, survives closing the terminal or the agent session, auto-restarts, blocks sleep and lid-suspend):

```sh
cd apps/imessage
setsid nohup ./scripts/demo-run.sh >/dev/null 2>&1 &
tail -f data/companion.log
```

macOS (no `systemd-inhibit`; use `caffeinate`):

```sh
cd apps/imessage
nohup caffeinate -dimsu env STDB_DB=thermal-reserve CHAT_DEMO=1 CHAT_ONBOARD=1 CHAT_LLM=gemini \
  node --env-file="$PWD/.env" --import tsx "$PWD/src/main.imessage.ts" >> data/companion.log 2>&1 &
```

Always pass **absolute** paths to `--env-file` and the entry file when launching from a background shell; a relative path failed once with `node: .env: not found`.

**Check: within 3 seconds the log shows**

```
[chat] database thermal-reserve; demo mode on; throttle 20 s; N linked contact(s)
[onboard] on: opted-in households from /home are added to Photon and sent an opener
[chat] model backend gemini (concierge gemini-3.5-flash-lite, insights gemini-3.8-flash)
[viewer] agent screen at http://127.0.0.1:8787/
[stdb] connected to thermal-reserve as c200…
[stdb] contact reader claimed
[stdb] subscribed: N households, status …
```

Then open `http://127.0.0.1:8787/`. A quick model check without texting anyone: `node --env-file="$PWD/.env" --import tsx spike/gemini-check.ts` (one call per model plus a tool round trip).

Stop: `pkill -f demo-run.sh; pkill -f main.imessage.ts`. Restarts are silent: the watcher starts from the current state and never re-sends an update.

## 6. How a person gets texts (the flow judges see)

1. They join on `https://thermal-reserve.vercel.app/home`, tick **Text me updates by iMessage**, enter first name, last name, phone (no email). `/home` calls `set_contact`; the row is private (only the companion's identity reads it, via `contact_feed`).
2. Within ~5 s the companion adds the number to the Photon project (`spectrum users add`, placeholder `household-<code>@users.invalid` email because Photon requires one) and publishes their assigned Photon line (`set_contact_line`); `/home` shows **"Text START to {line}"** with a button.
3. They text **START** (any first text works). That links them to their household and opts them in with Photon. Reply: "Thank you. You're set for {home}…".
4. From then on: update texts when the operator runs a cold snap (merged, at most one per 20 s, never on top of a reply), answers to questions, a tapback for "thanks". **STOP** deletes everything for the number, here and in the database.

## Gotchas (each one bit us once)

- **Photon only texts numbers on its project user list, and only after that person has texted their assigned line once** (user `meta.opt_in: true`). You cannot text a new person first; that is why the flow is "text START".
- For a few seconds after someone's first text, Photon refuses sends **and the typing indicator** with `Target not allowed for this project`. The companion retries replies for up to 13 s and drops the typing indicator if refused; don't "fix" this by removing the retry.
- **Removing a user in the Photon dashboard resets their opt-in.** The companion re-adds them on their next opt-in, and they must text START again.
- **Reset demo / Reset households on `/ops` deletes every contact** (as the privacy copy promises). People must opt in again on `/home`.
- After long silence, Photon may stop routing a person's texts to us; any outbound text to them reopens it. `CHAT_HELLO_TO` sends one at startup.
- **Do not add `@photon-ai/cli` to `package.json`.** `npm install` of it hits an npm 10 bug (`edgesOut`), and `--legacy-peer-deps` drops `react-is` (needed by the web charts) from the lockfile. It runs via `npx` only.
- `npm install` sometimes rewrites `package-lock.json` with harmless `"peer": true` markers. If no dependency changed, restore it: `git checkout -- package-lock.json`.
- Gemini free tier: Google may use the prompts (home nickname, the person's texts, memory notes; never phone numbers or last names) to improve its products. A paid key avoids that.
- Port 8787 must be free for the agent screen (`CHAT_VIEWER_PORT=0` turns it off).
- The website, not the companion, shows the number to text. If `thermal-reserve.vercel.app` is down, nobody can opt in; that deploy is H1's.

## Where things are

- Entry points: `src/main.imessage.ts` (cloud iMessage), `src/main.terminal.ts` (offline terminal chat, `npm run dev`).
- `src/app.ts` wiring, model backend switch, reply retries · `src/concierge/` inbound rules (START/STOP) and the concierge agent · `src/insights/` the Insights agent, tools, honesty guard · `src/llm/gemini.ts` Gemini adapter · `src/onboard/` Photon CLI wrapper and onboarding · `src/stdb/mirror.ts` database mirror and contact reducers · `src/watcher/` change detection and texts · `src/memory/store.ts` SQLite (`data/chat-<db>.sqlite`) · `scripts/demo-run.sh` presentation launcher.
- Full behaviour and settings: `README.md` in this folder. Project rules: `AGENTS.md` at the repo root (CHAT owns `apps/imessage/**` only).
