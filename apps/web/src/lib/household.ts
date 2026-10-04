import type { DbConnection } from '@thermal-reserve/stdb-bindings';
import { constants } from './ops';

type Household = ReturnType<DbConnection['db']['household']['iter']> extends IterableIterator<infer Row> ? Row : never;
export function heatStatus(home: Pick<Household, 'exempt' | 'overridden' | 'targetF' | 'taF'>) {
  if (home.exempt) return { name: 'Exempt', mode: 'exempt', targetF: constants.setpointDayF };
  if (home.overridden) return { name: 'Overridden', mode: 'overridden', targetF: constants.setpointDayF };
  const setbackF = Math.max(0, constants.setpointDayF - home.targetF);
  if (setbackF > 0.1) return { name: `Holding −${setbackF.toFixed(1)}°F`, mode: 'holding', targetF: home.targetF };
  if (home.taF < constants.setpointDayF - 0.25) return { name: 'Recovering', mode: 'recovering', targetF: home.targetF };
  return { name: 'Normal', mode: 'normal', targetF: home.targetF };
}
export function eventCountdown(hour: number, startHour: number, endHour: number) {
  if (hour >= endHour) return 'Event ended';
  const remaining = Math.max(0, (hour < startHour ? startHour : endHour) - hour);
  const minutes = Math.ceil(remaining * 60);
  return `${hour < startHour ? 'Starts in' : 'Ends in'} ${Math.floor(minutes / 60)}h ${minutes % 60}m of simulation time`;
}
