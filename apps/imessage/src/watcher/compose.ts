// Proactive message text from structured facts (CHAT brief §6.1–6.2). Templates only: every number
// comes from the household row or data/constants.json. Phase 2 lets the concierge reword, not refact.
import type { ChatConstants } from '../config';
import type { HouseholdView, SimView, Transition, TransitionKind } from '../types';
import { heatMode } from './detect';

const tempFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
const cfFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
export const degF = (value: number) => `${tempFmt.format(value)}°F`;

// Same clock as /home (lib/ops.ts clockLabel): Anchorage time from the scenario start.
export function clockLabel(startIso: string, hour: number, short = false): string {
  const options: Intl.DateTimeFormatOptions = short
    ? { timeZone: 'America/Anchorage', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }
    : { timeZone: 'America/Anchorage', weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
  return new Intl.DateTimeFormat('en-US', options).format(new Date(Date.parse(startIso) + hour * 3600000)).replace(/,/g, '');
}

const floorOf = (h: HouseholdView, consts: ChatConstants) => Math.max(h.floorF, consts.floorDefaultF);

export function statusWords(h: HouseholdView, consts: ChatConstants): string {
  const mode = heatMode(h, consts.setpointDayF);
  if (mode === 'holding') return `holding at ${degF(h.targetF)}`;
  if (mode === 'recovering') return `recovering toward ${degF(consts.setpointDayF)}`;
  if (mode === 'overridden') return 'overridden, normal heat';
  if (mode === 'exempt') return 'steady heat (exempt)';
  return 'normal heat';
}

function savedSentence(savedCf: number): string {
  if (savedCf > 0.5) return `a net ${cfFmt.format(savedCf)} cubic feet of gas saved, including the reheat`;
  if (savedCf < -0.5) return `a net ${cfFmt.format(-savedCf)} cubic feet more gas than normal, mostly from reheating`;
  return 'no net change in gas use';
}

// One-line form used inside a catch-up list.
function bullet(t: Transition, startIso: string, consts: ChatConstants): string {
  const at = clockLabel(startIso, t.simHour, true);
  switch (t.kind) {
    case 'setback_start': return `${at} heat lowered to ${degF(t.targetF)}`;
    case 'depth_change': return `${at} ${t.targetF < (t.previousTargetF ?? t.targetF) ? 'lowered further' : 'eased'} to ${degF(t.targetF)}`;
    case 'recovery_start': return `${at} heat raised back toward ${degF(consts.setpointDayF)}`;
    case 'override': return `${at} you overrode; normal heat restored`;
    case 'rejoin': return `${at} you rejoined the event`;
    case 'event_end': return `${at} event ended: ${savedSentence(t.savedCf)}`;
    case 'exempt_start': return `${at} event started; your heat stays steady`;
  }
}

// Full sentence used when a message carries one transition.
function single(t: Transition, h: HouseholdView, sim: SimView, consts: ChatConstants): string {
  const head = `BoreaFlux demo, ${clockLabel(sim.startIso, t.simHour)} (simulated): `;
  const floor = degF(floorOf(h, consts));
  switch (t.kind) {
    case 'setback_start':
      return `${head}we lowered ${h.nickname}'s heat to ${degF(t.targetF)}. Indoor is ${degF(t.taF)} and will stay above ${floor}. Want to know why now?`;
    case 'depth_change':
      return `${head}${h.nickname}'s heat target is now ${degF(t.targetF)}, from ${degF(t.previousTargetF ?? t.targetF)}. Indoor is ${degF(t.taF)}; it won't go below ${floor}. Want to know why?`;
    case 'recovery_start':
      return `${head}heat is coming back up to ${degF(consts.setpointDayF)}. Indoor is ${degF(t.taF)}. Ask me anything about it.`;
    case 'override':
      return `${head}override received. ${h.nickname} is back on normal heat, ${degF(consts.setpointDayF)}. Tap Rejoin event on the household page when you're ready.`;
    case 'rejoin':
      return `${head}you're back in the event. Your heat may be lowered again, never below ${floor}.`;
    case 'event_end':
      return `${head}the cold-snap event is over. ${h.nickname} ended with ${savedSentence(t.savedCf)}. Thanks for taking part.`;
    case 'exempt_start':
      return `${head}a cold-snap event started. ${h.nickname} is marked as needing steady heat, so it stays at its normal setting. I won't text again about this event.`;
  }
}

const IMPORTANCE: TransitionKind[] = ['event_end', 'setback_start', 'recovery_start', 'override', 'rejoin', 'exempt_start', 'depth_change'];

// Keep at most 6 lines; past that, the 5 most important (the deepest depth change counts as
// important) in time order, plus "plus N smaller changes".
export function pickForList(ts: Transition[]): { shown: Transition[]; hidden: number } {
  if (ts.length <= 6) return { shown: ts, hidden: 0 };
  const deepest = ts.filter(t => t.kind === 'depth_change').sort((a, b) => a.targetF - b.targetF)[0];
  const ranked = [...ts].sort((a, b) => {
    const rank = (t: Transition) => (t === deepest ? 1.5 : IMPORTANCE.indexOf(t.kind));
    return rank(a) - rank(b) || a.simHour - b.simHour;
  });
  const keep = new Set(ranked.slice(0, 5));
  return { shown: ts.filter(t => keep.has(t)), hidden: ts.length - 5 };
}

export function composeMessage(ts: Transition[], h: HouseholdView, sim: SimView, consts: ChatConstants): string {
  if (ts.length === 0) throw new Error('nothing to compose');
  const ordered = [...ts].sort((a, b) => a.simHour - b.simHour);
  if (ordered.length === 1) return single(ordered[0], h, sim, consts);
  const { shown, hidden } = pickForList(ordered);
  const lines = shown.map(t => `• ${bullet(t, sim.startIso, consts)}`);
  if (hidden > 0) lines.push(`• plus ${hidden} smaller changes`);
  const now = `Now: indoor ${degF(h.taF)}, ${statusWords(h, consts)}.`;
  return [`BoreaFlux demo, since my last text (simulated):`, ...lines, `${now} Want the reasons behind any of these?`].join('\n');
}
