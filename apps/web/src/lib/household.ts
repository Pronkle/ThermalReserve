import type { DbConnection } from '@thermal-reserve/stdb-bindings';
import { constants } from './ops';

type Household = ReturnType<DbConnection['db']['household']['iter']> extends IterableIterator<infer Row> ? Row : never;
export function householdDayStart(simHour: number, hours: number) {
  const displayHour = hours > 0 ? Math.min(simHour, Math.max(0, hours - 1)) : simHour;
  return Math.floor(Math.max(0, displayHour) / 24) * 24;
}
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

// Matches the companion: first six base32 characters of SHA-256 of normalized identity hex.
export async function householdLinkCode(identityHex: string) {
  const bytes = new TextEncoder().encode(identityHex.toLowerCase().replace(/^0x/, ''));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let code = '', buffer = 0, bits = 0;
  for (const byte of digest) {
    buffer = (buffer << 8) | byte; bits += 8;
    while (bits >= 5 && code.length < 6) { code += alphabet[(buffer >>> (bits - 5)) & 31]; bits -= 5; }
    if (code.length === 6) break;
  }
  return code;
}
