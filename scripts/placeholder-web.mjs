// Writes a static placeholder to apps/web/dist so the first Vercel deploy has
// something to serve. Unused once WEB's Vite build replaces the stub build script.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = join(dirname(fileURLToPath(import.meta.url)), '../apps/web/dist');
mkdirSync(dist, { recursive: true });
writeFileSync(
  join(dist, 'index.html'),
  `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Thermal Reserve</title>
  </head>
  <body style="font-family: system-ui, sans-serif; background: #0B1220; color: #E6EDF7; padding: 32px">
    <h1>Thermal Reserve</h1>
    <p>Placeholder. The app is being built.</p>
  </body>
</html>
`
);
console.log('wrote apps/web/dist/index.html (placeholder)');
