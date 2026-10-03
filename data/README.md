# data/ (owner: DATA)

Every number the UI shows comes from `constants.json` with its label (`sourced`, `derived`, `assumed`) and source.
Files whose contract shape is a bare array carry their labels here:

| File | Label | Notes |
| --- | --- | --- |
| `constants.json` | per entry | `hdd_annual` = 10,000 is a placeholder until task D1 (ACIS); `ua_mean_btuh_per_f` is derived from it |
| `cohort_spec.json` | assumed | All shares and parameters (master plan §9); ENGINE may tune `caBtuPerF`, `hamMult`, `tauMassH` after CP1 |
| `demand_shape.json` | assumed | Illustrative 24-hour shape of daily demand; **not Enstar data** |
| `anchors.json` | assumed | 12 placement anchors; coordinates approximate (from the master plan, not yet checked on a map); weights are assumed customer shares |
| `scenarios/design.json` | synthetic | Built by `scripts/make-design.ts`; `systemMMcfh` is a placeholder (`"placeholder": true`) until the system fit (task D2) |

Sources marked † in the master plan have no retained URLs yet; task D5 records them in `docs/sources.md`. No URL is ever constructed from memory.

Test: `npm test` in `data/` (type-checks every JSON file against the contract types, then checks values).
Regenerate: `npm run data`.
