# STDB handoff

Written Sat Oct 3, 16:40 Eastern by the STDB agent (Agent Mail name `CalmGlen`) for whoever
takes over the STDB brief (AGENTS.md Section 12). Read AGENTS.md first; this file only adds
state that is not in it.

## State

| Task | Status |
| --- | --- |
| S0 scaffold, publish, bindings, Vercel | Done |
| S1 simulation clock | Done; live run equals `runPlan(BASELINE)` on all 96 hours |
| S2 plans, overrides, reassignment, passcode | Done; live NAIVE_4H equals `runPlan` on all 96 hours |
| S3 households | Code done and CLI-tested. Not `[DONE]`: needs two phones through the web app (WEB's W4) |
| S4 integration duty | Ongoing, see "Merging" |
| S5 hardening | Not started |
| S6 freeze | Not started |

Everything above is on `main` and published to both databases.

## Live resources

- Maincloud databases: `thermal-reserve` (production) and `thermal-reserve-dev` (test), both owned
  by H1's Spacetime login. URI `wss://maincloud.spacetimedb.com`.
- Vercel: project `thermal-reserve` in H1's team, https://thermal-reserve.vercel.app, with
  `VITE_STDB_URI` and `VITE_STDB_DB` set for all environments. Not connected to GitHub: each
  deploy is manual (below).
- Operator passcode for `thermal-reserve`: H1 has it. For `thermal-reserve-dev` it is `dev-passcode`.

## Commands

```
npm run stdb:generate                       # regenerate packages/stdb-bindings/src, commit the result
spacetime publish thermal-reserve-dev --module-path stdb --server maincloud --yes
STDB_PASSCODE=dev-passcode node --import tsx stdb/scripts/accept.ts thermal-reserve-dev <mode> 4
#   modes: baseline | naive | overrides | household   (each prints PASS or FAIL)
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

Pending merges: ENGINE's computed test bands, then DATA's revert to `avg_home_mcf_year` = 149
(Agent Mail message 42). `data/d0` must not be merged before that revert: it fails a model test.

## Decisions that differ from AGENTS.md Section 8

- `sim_config` has two extra columns, `start_iso` and `hhv_btu_per_cf` (H1-approved).
- A private table `operator_secret` holds the passcode. The first `claim_operator` sets it; a
  later claim with the same passcode takes over the operator role.
- Operator reducers reject everyone until an operator has claimed.
- `set_plan` keeps one plan: it deletes every `plan_hour` row before inserting.
- `event_log` is cleared by `load_scenario` and `reset`.
- Households are placed near a random sample home (anchors are not in the database).
- Capacity is a daily limit (H1-approved, message 32): `aggregate_hour.capacity_mmcf` stays
  capacity ÷ 24, and `tick` logs a `system` event when a gas day closes over capacity.
- Reducer arguments are JSON strings with the camelCase keys of the Contract B types;
  `load_scenario`'s config also needs `hhvBtuPerCf`. See the comments in `stdb/src/index.ts`.

## Not yet done or verified

- S5: input ranges (max depth ≤ 10, enrolled 1,000–50,000, speed 0.5–4) are not enforced; only
  finiteness, floor ≥ 60 and nickname cleaning are. No backup database yet; WEB has no `?db=`
  override yet.
- Household `online` flag and reload persistence are untested from a real browser.
- No change-passcode reducer; changing it means a data wipe.
- The initial mass temperature formula is duplicated from ENGINE's `runPlan`
  (`initStates` in `index.ts`); if ENGINE changes it, the 1% match breaks.
