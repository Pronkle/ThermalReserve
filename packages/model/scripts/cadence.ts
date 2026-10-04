// E-C2 cadence comparison (AGENTS.md Section 10): Near-miss on DATA's forecasts, 1σ buffer, FIXED 6/3/1 h vs
// SCHEDULED_PLUS_DRIFT, then buffers 0 and 2σ for the drift policy. Run: npx tsx packages/model/scripts/cadence.ts [scenarioId]
import { readFileSync } from 'node:fs';
import { buildCohorts, loadConstants, pressureIndex, pressureParams, pressureSummary, replanRun } from '../src/index';
import type { CohortSpec, ConstantsJson, ReplanPolicy, ScenarioWithForecasts } from '../src/index';

const root = new URL('../../../data/', import.meta.url);
const read = (p: string) => JSON.parse(readFileSync(new URL(p, root), 'utf8'));
const raw = read('constants.json') as ConstantsJson;
const consts = loadConstants(raw);
const cohorts = buildCohorts(read('cohort_spec.json') as CohortSpec, consts.uaMeanBtuHPerF);
const shape = read('demand_shape.json') as number[];
const preset = (read('presets.json') as { id: string; scenarioId: string; lostMMcfd: number; enrolledHomes: number; reserveIdx: number }[]).find((p) => p.id === 'nearmiss')!;
const sc = read(`scenarios/${process.argv[2] ?? preset.scenarioId}.json`) as ScenarioWithForecasts;
if (!sc.forecastRuns?.length) { console.error(`${sc.id} has no forecastRuns; nothing to compare.`); process.exit(1); }

const v = (k: string) => raw[k].value as number;
const p = pressureParams(consts, raw, preset.lostMMcfd, preset.reserveIdx);
const cfg = { enrolledHomes: preset.enrolledHomes, exemptShare: consts.exemptShare, floorF: consts.floorDefaultF, maxDepthF: consts.maxDepthDefaultF, overrideRate: consts.overrideRate, capacityMMcfd: p.rMMcfd, seed: 42 };
const drift: ReplanPolicy = { kind: 'SCHEDULED_PLUS_DRIFT', driftTempF: v('drift_temp_f'), driftHours: v('drift_hours'), driftPressureIdx: v('drift_pressure_idx'), driftFadeH: v('drift_fade_h') };

const cases: { name: string; policy: ReplanPolicy; buffer: number }[] = [
  { name: 'FIXED 6 h', policy: { kind: 'FIXED', intervalH: 6 }, buffer: 1 },
  { name: 'FIXED 3 h', policy: { kind: 'FIXED', intervalH: 3 }, buffer: 1 },
  { name: 'FIXED 1 h', policy: { kind: 'FIXED', intervalH: 1 }, buffer: 1 },
  { name: 'SCHEDULED_PLUS_DRIFT', policy: drift, buffer: 1 },
  { name: 'SCHEDULED_PLUS_DRIFT, 0σ', policy: drift, buffer: 0 },
  { name: 'SCHEDULED_PLUS_DRIFT, 2σ', policy: drift, buffer: 2 },
  // Buffer sweep for both policies (real NBS spread is 2–7°F, so 1σ plans several degrees cold).
  ...[0, 0.25, 0.5, 0.75].map((b) => ({ name: `FIXED 6 h, ${b}σ`, policy: { kind: 'FIXED', intervalH: 6 } as ReplanPolicy, buffer: b })),
  ...[0.25, 0.5, 0.75].map((b) => ({ name: `SCHEDULED_PLUS_DRIFT, ${b}σ`, policy: drift, buffer: b })),
];

console.log(`| ${sc.id}, lost ${preset.lostMMcfd}, ${preset.enrolledHomes} homes | min P | hours in reserve | hours below 0 | °F·h/home | re-plans (reasons) | precompute s | fallbacks |`);
console.log('|---|---|---|---|---|---|---|---|');
for (const c of cases) {
  const t0 = Date.now();
  const r = await replanRun(sc, cohorts, cfg, consts, p, { mode: 'REPLAN', bufferSigma: c.buffer, policy: c.policy, strategy: 'OPTIMIZED' }, shape);
  const s = (Date.now() - t0) / 1000;
  const sum = pressureSummary(pressureIndex(r.run.hours.map((h) => h.systemMMcfh), p) as number[], p);
  const reasons: Record<string, number> = {};
  for (const g of r.segments.slice(1)) reasons[g.reason] = (reasons[g.reason] ?? 0) + 1;
  const fb = r.segments.filter((g) => g.plan.note).length;
  console.log(`| ${c.name} | ${sum.minIndex.toFixed(1)} | ${sum.hoursInReserve} | ${sum.hoursBelowZero} | ${r.run.totals.degreeHoursBelowNormal.toFixed(0)} | ${r.segments.length - 1} (${Object.entries(reasons).map(([k, n]) => `${k} ${n}`).join(', ')}) | ${s.toFixed(1)} | ${fb} |`);
}
