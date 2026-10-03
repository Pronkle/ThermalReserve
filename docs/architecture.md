# Architecture

Two hosted pieces make up the product: a **SpacetimeDB module on Maincloud** that holds all shared state and runs the simulation clock, and a **static React app on Vercel** that every screen loads. No laptop process runs during judging; the operator console is a browser tab.

The browser computes whole-horizon comparisons and the LP (deterministic, needed instantly for charts). The server owns the live run that every phone and the map watch. One physics source file (`packages/model/src/physics.ts`) runs in both places, and a test asserts the two agree on a fixed scenario.

## System diagram

```mermaid
flowchart LR
  subgraph repo["Repo (bundled into the web build)"]
    data["data/*.json<br/>constants, cohort spec,<br/>scenarios, system fit"]
    model["packages/model<br/>physics, fleet, strategies,<br/>LP (HiGHS WASM), validation, what-if"]
  end

  subgraph vercel["Vercel: thermal-reserve.vercel.app (static)"]
    ops["/ops<br/>operator console"]
    home["/home<br/>household phone app"]
    whatif["/whatif<br/>calculator"]
    validation["/validation<br/>proof page"]
  end

  subgraph stdb["SpacetimeDB Maincloud: database thermal-reserve"]
    reducers["Reducers<br/>claim_operator, load_scenario, load_homes,<br/>set_params, set_plan, start, pause, reset,<br/>join_household, override, cancel_override,<br/>reset_households"]
    tick["tick<br/>(scheduled, 1 s; scheduler-only)"]
    tables["Public tables<br/>sim_config, weather_hour, cohort, cohort_state,<br/>sample_home, household, plan_hour,<br/>aggregate_hour, event_log"]
    physics["physics.ts<br/>(synced copy)"]
  end

  data --> ops & whatif & validation
  model --> ops & whatif & validation
  ops -- "reducer calls (WebSocket)" --> reducers
  home -- "join, override (WebSocket)" --> reducers
  reducers --> tables
  tick --> physics
  tick --> tables
  tables -- "subscriptions (live)" --> ops & home
  model -. "npm run sync-physics" .-> physics
```

`/whatif` and `/validation` read only `data/` and `packages/model`; they work with no Spacetime connection.

## Live run, step by step

```mermaid
sequenceDiagram
  participant Op as /ops (browser)
  participant M as packages/model (in browser)
  participant S as Spacetime module
  participant P as /home (phone)

  Op->>M: compareStrategies (BASELINE, NAIVE_4H, SUSTAIN_STAGGER)
  Op->>S: load_scenario, load_homes ×4, set_params
  Op->>M: solvePlan (LP in a Web Worker, falls back to rule-based)
  Op->>S: set_plan (targets per cohort per hour)
  Op->>S: start
  loop every real second while running
    S->>S: tick: 5-minute sub-steps, cohorts + baseline twin + households,<br/>overrides, reassignment, write aggregate_hour per hour
  end
  S-->>Op: table updates (map colors, LIVE line, KPIs, event log)
  P->>S: join_household
  S-->>Op: household dot appears
  P->>S: override
  S-->>Op: event_log: override, reassign
```

## Components

| Component | Tech | Runs where | Owner |
| --- | --- | --- | --- |
| Spacetime module | SpacetimeDB TypeScript server module (`stdb/`) | Maincloud: `thermal-reserve` (production), `thermal-reserve-dev` (test) | STDB |
| Client bindings | `spacetime generate --lang typescript` → `packages/stdb-bindings` (committed) | Browser | STDB |
| Physics, strategies, LP, validation, what-if | Pure TypeScript, `packages/model` | Browser; `physics.ts` and `types.ts` also inside the module | ENGINE |
| LP solver | `highs` (HiGHS compiled to WebAssembly), CPLEX LP text | Browser Web Worker | ENGINE |
| Web app | React, Vite, TypeScript, Tailwind, React Router (`apps/web`) | Vercel static build | WEB |
| Charts, map, QR | Recharts; Leaflet with OpenStreetMap tiles (SVG fallback); qrcode.react | Browser | WEB |
| Data and scenarios | JSON in `data/`, rebuilt offline by `npm run data` from saved ACIS responses | Repo, bundled into the web build | DATA |
| Tests | Vitest in each workspace | Developer machines; merge gate | Each owner |

## Data pipeline (offline)

```mermaid
flowchart LR
  acis["ACIS StnData<br/>(fetch-acis.ts, run by hand)"] --> raw["data/raw/*.json"]
  raw --> cal["calibrate.ts<br/>HDD 1996–2025 → UA"]
  cal --> consts["constants.json<br/>hdd_annual, ua_mean_btuh_per_f"]
  raw --> fit["fit-system.ts<br/>fitSystemDemand: D = a + b × HDD"]
  consts --> fit
  fit --> sf["system_fit.json"]
  sf --> scen["make-design.ts, make-replays.ts"]
  raw --> scen
  shape["demand_shape.json (assumed)"] --> scen
  scen --> files["scenarios/design.json,<br/>feb2024.json, lastwinter.json"]
```

## Decisions worth knowing

- **Capacity is a daily limit** per gas day (calendar day from scenario start). Within-day swings are assumed covered by linepack and storage; `aggregate_hour.capacity_mmcf` shows capacity ÷ 24 as an average.
- **Operator passcode** lives in a private table; the first `claim_operator` sets it.
- **Reducer arguments** are JSON strings with the camelCase keys of the `packages/model` types.
- **Households** are placed near a random sample home and use a cohort template matching their heating type.

Full contracts: `AGENTS.md` Sections 6–9. Current STDB state and deviations: `stdb/HANDOFF.md`.
