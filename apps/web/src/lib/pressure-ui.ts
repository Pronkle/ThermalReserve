import { pressureIndex, pressureSummary, discomfortSeries, curtailedSeriesMMcf, type PressureParams, type RunResult, type FleetConfig, type Strategy, type ConstantsJson } from '@thermal-reserve/model';
import { cohorts, constants } from './ops';

export interface PressureInputs { lostMMcfd: number; reserveIdx: number; bufferSigma: number; planningMode: 'OBSERVED' | 'SINGLE' | 'REPLAN'; strategy: Strategy; }
export interface Preset { id: 'nearmiss' | 'stress'; name: string; scenarioId: string; lostMMcfd: number; enrolledHomes: number; reserveIdx: number; provisional: boolean; }
export interface DeliveryTick { lostMMcfd: number; label: string; label_kind: string; source: string; }
const files = import.meta.glob<unknown>('../../../../data/{presets,deliverability_ticks,forecast_error}.json', { eager: true, import: 'default' });
export const presets = (files['../../../../data/presets.json'] ?? []) as Preset[];
export const deliveryTicks = (files['../../../../data/deliverability_ticks.json'] ?? []) as DeliveryTick[];
export function pressureReady(raw: ConstantsJson = constants.raw) {
  return ['deliverability_2024_mmcfd', 'linepack_usable_mmcf', 'reserve_default_idx'].every(key => typeof raw[key]?.value === 'number') && presets.length > 0;
}
export function pressureInputKey(scenarioId: string, config: FleetConfig, input: PressureInputs) {
  return JSON.stringify([scenarioId, config.enrolledHomes, config.exemptShare, config.floorF, config.maxDepthF, config.overrideRate, config.seed, input.lostMMcfd, input.reserveIdx, input.bufferSigma, input.planningMode, input.strategy]);
}
export function pressurePlanId(scenarioId: string, strategy: Strategy, hour: number, key: string) {
  let hash = 0xcbf29ce484222325n;
  for (const character of key) hash = BigInt.asUintN(64, (hash ^ BigInt(character.charCodeAt(0))) * 0x100000001b3n);
  return `${scenarioId.slice(0, 32)}-${strategy === 'MAX_RELIEF' ? 'MAX' : 'OPT'}-rp${hour}-${hash.toString(16).padStart(16, '0').slice(0, 10)}`;
}
export function pressureView(run: RunResult, baseline: RunResult, config: FleetConfig, p: PressureParams) {
  const index = pressureIndex(run.hours.map(row => row.systemMMcfh), p) as number[];
  const discomfort = discomfortSeries(run, baseline, cohorts, config);
  return { index, summary: pressureSummary(index, p), discomfort, curtailed: curtailedSeriesMMcf(index, p), holdingHours: run.hours.filter(hour => hour.cohorts.some(cohort => cohort.mode === 'holding')).length, degreeHours: discomfort.meanF.reduce((sum, x) => sum + x, 0), minIndoorF: Math.min(...run.hours.map(row => row.minTaF)) };
}
export function livePressure(demandByHour: Map<number, number>, hours: number, p: PressureParams) {
  return pressureIndex(Array.from({ length: hours }, (_, hour) => demandByHour.get(hour)), p);
}

export function livePressureReading(demandByHour: Map<number, number>, hours: number, deliveryMMcfd: number, reserveIdx: number) {
  if (!pressureReady()) return undefined;
  const p = { ...pressureParamsForHome(deliveryMMcfd, reserveIdx) };
  const series = livePressure(demandByHour, hours, p);
  const values = series.filter((value): value is number => value !== undefined);
  return values.length ? { index: values[values.length - 1], hour: values.length, reserveIdx } : undefined;
}
function pressureParamsForHome(deliveryMMcfd: number, reserveIdx: number): PressureParams {
  return { rMMcfd: deliveryMMcfd, wMMcf: Number(constants.raw.linepack_usable_mmcf.value), reserveIdx };
}
