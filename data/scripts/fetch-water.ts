// Downloads OpenStreetMap water, bay, strait and wetland areas around the placement anchors
// from the Overpass API into data/raw/. ONLINE step, run by hand: npx tsx data/scripts/fetch-water.ts
// `npm run data` never calls this; build-water-mask.ts rebuilds the mask offline from the saved files.
// Data © OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright).

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir } from './lib.ts';

const writeJsonCompact = (rel: string, v: unknown) => writeFileSync(join(dataDir, rel), JSON.stringify(v) + '\n');

const ENDPOINT = 'https://overpass-api.de/api/interpreter';
// [south, west, north, east] per region; each covers its anchors ± about 3 km.
const regions: Record<string, [number, number, number, number]> = {
  anchorage: [61.07, -150.03, 61.36, -149.50],
  matsu: [61.55, -149.50, 61.63, -149.05],
  kenai: [60.50, -151.21, 60.56, -151.09],
};

for (const [name, [s, w, n, e]] of Object.entries(regions)) {
  const bbox = `${s},${w},${n},${e}`;
  const query =
    `[out:json][timeout:180];(` +
    `way["natural"~"^(water|bay|strait|wetland)$"](${bbox});` +
    `relation["natural"~"^(water|bay|strait|wetland)$"](${bbox});` +
    `);out geom;`;
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'ThermalReserve-MHacks2026-data (hackathon)' },
    body: new URLSearchParams({ data: query }),
  });
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  const json = (await res.json()) as { elements?: unknown[] };
  writeJsonCompact(`raw/osm_water_${name}.json`, {
    request: { endpoint: ENDPOINT, query },
    retrievedIso: new Date().toISOString(),
    attribution: '© OpenStreetMap contributors, ODbL 1.0',
    ...json,
  });
  console.log(`saved raw/osm_water_${name}.json: ${json.elements?.length ?? 0} elements`);
}
