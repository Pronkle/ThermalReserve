# TODO: text notifications for households

Status: **not planned for the hackathon build.** This is the work list if the team decides to add notifications (for example "A cold-snap event starts in 30 minutes" or "Your home is back to normal heat"). Items marked **verify** are assumptions that must be checked against current docs before anyone builds on them (AGENTS.md rule 7). Nothing here is implemented.

Today, households already see live status in the open `/home` tab through Spacetime subscriptions. Notifications would reach them when the tab is closed or the phone is locked.

## 1. Decide the channel (humans: H1 + H3)

- [ ] **In-tab only (smallest):** browser Notification API while `/home` is open; no server, no account, no stored contact info. Doesn't reach a closed tab.
- [ ] **Web Push:** works with the tab closed, no phone number needed. Needs a service worker, VAPID keys, a push subscription per household, and something that sends pushes. **Verify:** iOS support (believed to require the site to be added to the Home Screen as a web app, iOS 16.4+), and Android Chrome behavior.
- [ ] **SMS:** reaches any phone. Needs a provider account (for example Twilio or AWS SNS), a paid number, and storing phone numbers. **Escalation:** account, credential, or payment → stop and ask the human (AGENTS.md Section 4). **Verify:** US carrier registration rules for application-to-person texting before relying on it.
- [ ] Record the choice and why in `docs/COORDINATION.md` or a `[CONTRACT]` message.

## 2. Contract and schema changes (STDB/H1 approval required)

- [ ] New table, e.g. `notification_subscription` (identity, channel, endpoint or phone, opted_in_at, last_sent_at). A schema change on the production database may require `--delete-data=on-conflict` (wipes data, including the operator passcode; see `stdb/HANDOFF.md`). Plan the publish for a quiet moment.
- [ ] New reducers: `subscribe_notifications`, `unsubscribe_notifications`; validate inputs like S5 (length limits, format, one subscription per identity).
- [ ] `reset_households` must also delete subscriptions; deleting a household deletes its contact data.
- [ ] Post `[CONTRACT]` with the table and reducer names; update AGENTS.md Section 8 (H1).

## 3. Sending (the hard part)

- [ ] **Verify** whether a SpacetimeDB module can make outbound HTTP calls (procedures / HTTP support in the current TypeScript server API). If it can't, sending needs a separate service.
- [ ] If a separate sender is needed, decide where it runs. The project rule is "no laptop process during judging", so it can't be a laptop script. Options to **verify**: a hosted worker that subscribes to `event_log`, or a scheduled serverless function polling via `spacetime sql` / the client SDK.
- [ ] Secrets (VAPID private key or SMS API key) live only in the sender's environment, never in the repo (AGENTS.md rule 4); add them to `.gitignore` patterns if files are involved.
- [ ] New npm dependencies (e.g. `web-push`, an SMS SDK) are not on the Section 5 list → ask H1 before adding.

## 4. What triggers a message

- [ ] Event dispatched (plan sent): "A cold-snap event starts at {clock}. Your heat may be lowered up to {N}°F, never below 62°F."
- [ ] Setback begins for this household's cohort (from `cohort_state.mode` → `holding`).
- [ ] Override acknowledged: "Normal heat restored. You can rejoin any time."
- [ ] Event ends: "Event over. Your home saved about {cf} cubic feet (simulated)."
- [ ] Rate limit: at most one message per household per simulated hour, and none between 22:00 and 07:00 real time unless the household opts in. At 2 sim-hours per second the demo would otherwise send a burst; consider sending only real-time-relevant messages in the demo.

## 5. Consent, privacy, and honesty

- [ ] Opt-in screen after the consent screen, unchecked by default; plain words; no exclamation marks (copy rules).
- [ ] Every message says it's a simulation while we only simulate ("Thermal Reserve demo: …"). Never imply we control a real thermostat.
- [ ] Store the minimum: no names or addresses; phone numbers only if SMS is chosen; delete on unsubscribe and on `reset_households`.
- [ ] Update Q&A #18 (privacy) and `docs/devpost.md` to say what is stored and for how long.
- [ ] One-tap unsubscribe in `/home` and in every message ("Reply STOP" for SMS).

## 6. Tests and acceptance

- [ ] Unit tests for message text (labels, units, 62°F wording) and for the rate limiter.
- [ ] Add rows to `docs/test-plan.md`: subscribe, receive on iPhone and Android with the tab closed, unsubscribe, reset deletes the subscription.
- [ ] Failure mode: sender down → the app still works; `/home` shows status as today.

## 7. Timing

- [ ] Code freeze is Sun 10:00. A new table plus an external sender is risky before then; recommend after the hackathon, or only the in-tab option (section 1, first item) as a stretch if WEB has time after W4 and the 02:00 test passes.
