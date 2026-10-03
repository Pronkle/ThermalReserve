# Thermal Reserve web

W0 supplies Vite, React, strict TypeScript, Tailwind's Vite plugin, React Router,
the shared winter theme, and placeholder screens for `/ops`, `/home`, `/whatif`,
and `/validation`. `/` redirects to `/ops`.

From the monorepo root after STDB's scaffold, ENGINE's model exports, and DATA's
starter JSON have been merged:

```sh
npm install
npm run build -w apps/web
npm run test -w apps/web
npm run dev -w apps/web
```

The baseline chart calls `@thermal-reserve/model` and labels its W0 output as
assumed stub data. No savings or validation claims are made. Public placeholder
routes require no Spacetime connection. STDB owns deployment and the production
SPA rewrite configuration.

Acceptance: production build passes and all four routes render their headings;
the route smoke test renders the app at each URL without a Spacetime connection
and checks model chart data. Also verify direct navigation and navigation links
in a browser after deployment.

W1 adds the model strategy comparison, 1,000 Leaflet canvas markers with a
tiles-blocked SVG fallback, six formula-labeled metrics, and local preview
controls. The preview can play or scrub precomputed model results; it sends no
Spacetime commands. The system view measures shortfall per gas day and labels
the capacity line as a daily average. Scenario JSON files are discovered at build
time, so replay options appear when DATA's files merge.

Browser acceptance uses temporary Playwright tooling (no added app dependency):
start the dev server, then run `scripts/accept-w1.mjs` with
`PLAYWRIGHT_MODULE_PATH` pointing to Playwright's `index.mjs`. Chromium and its
Linux libraries must be installed. The check covers 1280×800 panel bounds, no
page scrolling, three chart lines, keyboard formula tooltips, local controls,
and a tiles-blocked fallback with all 1,000 dots. It writes a screenshot to `/tmp`.
