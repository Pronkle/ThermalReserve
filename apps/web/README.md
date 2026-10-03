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
