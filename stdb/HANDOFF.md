# STDB handoff

Written Sat Oct 3, 16:40 Eastern and updated Sun Oct 4, 00:05 by the STDB agent (Agent Mail name `CalmGlen`) for whoever
takes over the STDB brief (AGENTS.md Section 12). Read AGENTS.md first; this file only adds
state that is not in it.

## State

| Task | Status |
| --- | --- |
| S0 scaffold, publish, bindings, Vercel | Done |
| S1 simulation clock | Done; live run equals `runPlan(BASELINE)` on all 96 hours |
| S2 plans, overrides, reassignment, passcode | Done; live NAIVE_4H equals `runPlan` on all 96 hours |
| S3 households | Done; two real phones (one Android, one iPhone) joined, ticked and finished a run on production |
| S4 integration duty | Ongoing, see "Merging" |
| S5 hardening | Done (written by DATA, verified live by STDB); backup database published |
| S6 freeze | Not started: final publish of both databases, final Vercel deploy, tag `v1.0`, `[CP] code freeze` |

Everything above is on `main` and published to both databases.

## Live resources

- Maincloud databases: `thermal-reserve` (production), `thermal-reserve-backup` (failover, reached
  with `?db=thermal-reserve-backup`) and `thermal-reserve-dev` (test), all owned by H1's Spacetime login. URI `wss://maincloud.spacetimedb.com`.
- Vercel: project `thermal-reserve` in H1's team, https://thermal-reserve.vercel.app, with
  `VITE_STDB_URI` and `VITE_STDB_DB` set for all environments. Not connected to GitHub: each
  deploy is manual (below).
- Operator passcode for `thermal-reserve` and `thermal-reserve-backup`: H1 has it. For `thermal-reserve-dev` it is `dev-passcode`.

## Commands

```
npm run stdb:generate                       # regenerate packages/stdb-bindings/src, commit the result
spacetime publish thermal-reserve-dev --module-path stdb --server maincloud --yes
STDB_PASSCODE=dev-passcode node --import tsx stdb/scripts/accept.ts thermal-reserve-dev <mode> 4
#   modes: validation | baseline | naive | overrides | household   (each prints PASS or FAIL)
npm run stdb:publish                        # production; add --delete-data=on-conflict if the schema changed
npm run sync-physics && npm run check-physics   # after ENGINE changes physics.ts or types.ts
```

Deploy: from a clean clone of `main`, copy `.vercel/project.json` in (or `vercel link --project
thermal-reserve`), then `npx vercel deploy --prod --yes`.

A schema change that adds a column needs `--delete-data=on-conflict`, which wipes the database
(including the operator passcode; H1 must claim again). Adding a table does not.

## Merging (H1's standing authorization to STDB)

H1 lets STDB merge branches into `main` and push, under these rules: one branch at a time; run
`npm install`, `npm test`, `npm run build -w apps/web` after each; push only if all three pass;
never resolve conflicts in files STDB doesn't own (abort and message the owner); post a `[CP]`
message after each merge listing what landed. `scripts/merge-gate.sh <branch>` does the merge
and the checks on a detached checkout and commits only on a pass; then
`git push origin HEAD:main`. No force-pushes or branch deletion without H1.

Current split (since Sat 21:48): STDB merges `engine/*`, `web/*`, `stdb/*`, `chat/*` and anything
touching root files or the lockfile; DATA merges only its own `data/*` branches under the same rules.
STDB deploys whenever `apps/web`, `packages/model` or `data/*.json` change on `main`, whoever merged
it, and publishes all three databases whenever `stdb/` changes.

## Decisions that differ from AGENTS.md Section 8

- `sim_config` has two extra columns, `start_iso` and `hhv_btu_per_cf` (H1-approved).
- A private table `operator_secret` holds the passcode. The first `claim_operator` sets it; a
  later claim with the same passcode takes over the operator role.
- Operator reducers reject everyone until an operator has claimed.
- `set_plan` keeps one plan: it deletes every `plan_hour` row before inserting.
- `event_log` is cleared by `load_scenario` and `reset`.
- Households are placed near a random sample home (anchors are not in the database).
- Real households are never held below 62°F, whatever the operator's floor is (`HOUSEHOLD_FLOOR_F`),
  so the consent text stays true. The simulated fleet follows the operator's floor (60–70°F).
- With no setback in the dispatched plan there are no simulated overrides, and `share_at_floor`
  counts only cohorts in `holding` (both match ENGINE's `runPlan`).
- Capacity is a daily limit (H1-approved, message 32): `aggregate_hour.capacity_mmcf` stays
  capacity ÷ 24, and `tick` logs a `system` event when a gas day closes over capacity.
- Contact details for the iMessage companion (H1-approved Oct 4, CHAT msg 271, no email): private
  tables `household_contact` and `contact_reader`; reducers `set_contact(first_name, last_name,
  phone)`, `clear_contact()`, `claim_contact_reader(passcode)` (operator passcode), `remove_contact(identity)` (reader only); public view
  `contact_feed`, which returns rows only to the identity that claimed reader. `reset_households`
  also clears the contacts. Verified on dev with the CLI (14 checks); not yet through an SDK subscription.
- Reducer arguments are JSON strings with the camelCase keys of the Contract B types;
  `load_scenario`'s config also needs `hhvBtuPerCf`. See the comments in `stdb/src/index.ts`.

## Not yet done or verified

- S6 freeze steps (above).
- No change-passcode reducer; changing a passcode means a data wipe of that database.
- The initial mass temperature formula is duplicated from ENGINE's `runPlan`
  (`initStates` in `index.ts`); if ENGINE changes it, the 1% match breaks.
- AGENTS.md Section 8 still describes the original contract; the deviations are only listed here.
