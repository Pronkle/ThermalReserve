// Builds data/water_mask.json from the saved OpenStreetMap responses (data/raw/osm_water_*.json):
// open water, lakes, bays, straits and tidal wetland (see isWater).
// OFFLINE. Output shape (ENGINE's WaterMask): a bare array of rings, each ring [[lat, lon], ...].
// A point is water if it is inside any ring (packages/model/src/fleet.ts inWater); holes are not
// represented, so only outer rings are kept. Each ring is clipped to the box around each anchor
// that it overlaps (anchor ± CLIP_KM, wider than sampleHomes' 1–2 km jitter), then simplified.
// Data © OpenStreetMap contributors, ODbL 1.0.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir, readJson, round } from './lib.ts';

type Pt = [number, number]; // [lat, lon]
interface OsmGeomPt { lat: number; lon: number }
interface OsmEl {
  type: 'way' | 'relation';
  id: number;
  tags?: Record<string, string>;
  geometry?: OsmGeomPt[];
  members?: { type: string; role: string; geometry?: OsmGeomPt[] }[];
}
interface Anchor { name: string; lat: number; lon: number; weight: number }

const RAW = ['raw/osm_water_anchorage.json', 'raw/osm_water_matsu.json', 'raw/osm_water_kenai.json'];
const CLIP_KM = 3;
const SIMPLIFY_DEG = 0.00015; // ~10–17 m: far below the map's dot size
const KM_PER_DEG_LAT = 111.0;

const toPts = (g: OsmGeomPt[]): Pt[] => g.map((p) => [p.lat, p.lon]);
const samePt = (a: Pt, b: Pt) => a[0] === b[0] && a[1] === b[1];

/** Joins open member ways that share endpoints into closed rings. */
function stitch(ways: Pt[][]): Pt[][] {
  const rings: Pt[][] = [];
  const open = ways.filter((w) => w.length >= 2).map((w) => [...w]);
  while (open.length > 0) {
    let ring = open.shift()!;
    let grew = true;
    while (!samePt(ring[0], ring[ring.length - 1]) && grew) {
      grew = false;
      for (let i = 0; i < open.length; i++) {
        const w = open[i];
        const end = ring[ring.length - 1];
        if (samePt(w[0], end)) ring = ring.concat(w.slice(1));
        else if (samePt(w[w.length - 1], end)) ring = ring.concat([...w].reverse().slice(1));
        else if (samePt(w[w.length - 1], ring[0])) ring = w.concat(ring.slice(1));
        else if (samePt(w[0], ring[0])) ring = [...w].reverse().concat(ring.slice(1));
        else continue;
        open.splice(i, 1);
        grew = true;
        break;
      }
    }
    if (samePt(ring[0], ring[ring.length - 1]) && ring.length >= 4) rings.push(ring);
  }
  return rings;
}

/** Sutherland–Hodgman clip of a ring to an axis-aligned box. */
function clip(ring: Pt[], s: number, w: number, n: number, e: number): Pt[] {
  const edges: [(p: Pt) => boolean, (a: Pt, b: Pt) => Pt][] = [
    [(p) => p[0] >= s, (a, b) => [s, a[1] + ((b[1] - a[1]) * (s - a[0])) / (b[0] - a[0])]],
    [(p) => p[0] <= n, (a, b) => [n, a[1] + ((b[1] - a[1]) * (n - a[0])) / (b[0] - a[0])]],
    [(p) => p[1] >= w, (a, b) => [a[0] + ((b[0] - a[0]) * (w - a[1])) / (b[1] - a[1]), w]],
    [(p) => p[1] <= e, (a, b) => [a[0] + ((b[0] - a[0]) * (e - a[1])) / (b[1] - a[1]), e]],
  ];
  let out = ring.slice(0, -1); // drop the closing duplicate
  for (const [inside, cross] of edges) {
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const cur = input[i];
      const prev = input[(i + input.length - 1) % input.length];
      if (inside(cur)) {
        if (!inside(prev)) out.push(cross(prev, cur));
        out.push(cur);
      } else if (inside(prev)) out.push(cross(prev, cur));
    }
    if (out.length === 0) return [];
  }
  return out.length >= 3 ? [...out, out[0]] : [];
}

/** Douglas–Peucker simplification (in degrees), keeping the ring closed. */
function simplify(pts: Pt[], tol: number): Pt[] {
  if (pts.length <= 4) return pts;
  const keep = new Array(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let maxD = 0;
    let idx = -1;
    const [ax, ay] = pts[a];
    const [bx, by] = pts[b];
    const len = Math.hypot(bx - ax, by - ay);
    for (let i = a + 1; i < b; i++) {
      const [px, py] = pts[i];
      const d = len === 0 ? Math.hypot(px - ax, py - ay) : Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / len;
      if (d > maxD) [maxD, idx] = [d, i];
    }
    if (maxD > tol && idx > 0) {
      keep[idx] = true;
      stack.push([a, idx], [idx, b]);
    }
  }
  const out = pts.filter((_, i) => keep[i]);
  return out.length >= 4 ? out : [];
}

// Open water, lakes, bays and straits, plus tidal wetland (tidal flats, mud, salt marsh). Inland bogs,
// marshes and swamps are left out: in OSM they often overlap residential streets (one covers the
// Sand Lake anchor), and homes there are plausible.
const TIDAL_WETLAND = new Set(['tidalflat', 'mud', 'saltmarsh']);
function isWater(tags: Record<string, string>): boolean {
  if (tags.natural === 'water' || tags.natural === 'bay' || tags.natural === 'strait') return true;
  return tags.natural === 'wetland' && (TIDAL_WETLAND.has(tags.wetland ?? '') || tags.tidal === 'yes');
}

const anchors = readJson<Anchor[]>('anchors.json');
const boxes = anchors.map((a) => {
  const dLat = CLIP_KM / KM_PER_DEG_LAT;
  const dLon = CLIP_KM / (KM_PER_DEG_LAT * Math.cos((a.lat * Math.PI) / 180));
  return { name: a.name, s: a.lat - dLat, n: a.lat + dLat, w: a.lon - dLon, e: a.lon + dLon };
});

const counts: Record<string, number> = {};
const mask: Pt[][] = [];
const seen = new Set<string>();
for (const file of RAW) {
  for (const el of readJson<{ elements: OsmEl[] }>(file).elements) {
    const key = `${el.type}/${el.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    let rings: Pt[][] = [];
    if (el.type === 'way' && el.geometry) {
      const pts = toPts(el.geometry);
      if (pts.length >= 4 && samePt(pts[0], pts[pts.length - 1])) rings = [pts];
    } else if (el.type === 'relation' && el.members) {
      rings = stitch(el.members.filter((m) => m.type === 'way' && m.role !== 'inner' && m.geometry).map((m) => toPts(m.geometry!)));
    }
    const kind = el.tags?.natural ?? '?';
    if (!isWater(el.tags ?? {})) continue;
    for (const ring of rings) {
      for (const b of boxes) {
        const c = simplify(clip(ring, b.s, b.w, b.n, b.e), SIMPLIFY_DEG);
        if (c.length === 0) continue;
        mask.push(c.map(([lat, lon]) => [round(lat, 5), round(lon, 5)] as Pt));
        counts[kind] = (counts[kind] ?? 0) + 1;
      }
    }
  }
}

// Safety: an anchor itself must be on land, or sampleHomes' fallback would land in water.
const inRing = (lat: number, lon: number, ring: Pt[]) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i];
    const [yj, xj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
for (const a of anchors) {
  if (mask.some((r) => inRing(a.lat, a.lon, r))) throw new Error(`anchor ${a.name} is inside the water mask`);
}

// Compact (one ring per line): the web app bundles this file.
writeFileSync(join(dataDir, 'water_mask.json'), '[\n' + mask.map((r) => JSON.stringify(r)).join(',\n') + '\n]\n');
console.log(`water mask: ${mask.length} rings, ${mask.reduce((s, r) => s + r.length, 0)} points (${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ')})`);
