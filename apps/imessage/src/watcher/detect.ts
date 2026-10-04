// Per-household change detector (CHAT brief §6.1). Pure: given the last notified state and the
// current rows, returns the new state and the transitions worth telling the household about.
import type { ChatConstants } from '../config';
import type { HeatMode, HouseholdView, SimView, Transition, TransitionKind } from '../types';

// Enter "holding" at 0.5°F below normal (ignores tiny LP trims); report depth changes of 1°F or more.
export const SETBACK_ENTER_F = 0.5;
export const DEPTH_STEP_F = 1;

export interface NotifiedState {
  runKey: string;
  lastSimHour: number;
  mode: HeatMode;
  overridden: boolean;
  notifiedTargetF: number;
  exemptNotified: boolean;
  endNotified: boolean;
}

export const runKey = (sim: SimView) => `${sim.scenarioId}|${sim.startIso}|${sim.planId}`;

export function heatMode(h: HouseholdView, normalF: number): HeatMode {
  if (h.exempt) return 'exempt';
  if (h.overridden) return 'overridden';
  if (normalF - h.targetF >= SETBACK_ENTER_F) return 'holding';
  if (h.taF < normalF - 0.25) return 'recovering';
  return 'normal';
}

// Fresh state for a household we start watching (a new link, a new run, or a restart with no
// stored state): nothing that already happened is reported.
export function initialState(h: HouseholdView, sim: SimView, consts: ChatConstants): NotifiedState {
  return {
    runKey: runKey(sim),
    lastSimHour: sim.simHour,
    mode: heatMode(h, consts.setpointDayF),
    overridden: h.overridden,
    notifiedTargetF: h.targetF,
    exemptNotified: h.exempt && sim.simHour >= sim.eventStartHour,
    endNotified: sim.simHour >= sim.eventEndHour,
  };
}

export function detect(
  prev: NotifiedState | undefined,
  h: HouseholdView,
  sim: SimView,
  consts: ChatConstants,
): { next: NotifiedState; transitions: Transition[] } {
  // A load or reset starts a new run: forget the old run's state (the contact stays linked).
  if (!prev || prev.runKey !== runKey(sim) || sim.simHour < prev.lastSimHour - 0.01) {
    if (!prev) return { next: initialState(h, sim, consts), transitions: [] };
    prev = { ...initialState(h, { ...sim, simHour: 0 }, consts), lastSimHour: sim.simHour };
  }
  const normalF = consts.setpointDayF;
  const mode = heatMode(h, normalF);
  const key = runKey(sim);
  const transitions: Transition[] = [];
  const add = (kind: TransitionKind, extra: Partial<Transition> = {}) =>
    transitions.push({
      id: `${key}:${kind}:${sim.simHour.toFixed(2)}`,
      kind,
      simHour: sim.simHour,
      targetF: h.targetF,
      taF: h.taF,
      savedCf: h.savedCf,
      ...extra,
    });
  const next: NotifiedState = { ...prev, lastSimHour: sim.simHour, mode };
  const inEvent = sim.simHour >= sim.eventStartHour && sim.simHour < sim.eventEndHour;

  if (h.exempt) {
    if (inEvent && !prev.exemptNotified) {
      add('exempt_start');
      next.exemptNotified = true;
    }
    // Exempt homes get one message at event start and nothing more.
    next.endNotified = prev.endNotified || sim.simHour >= sim.eventEndHour;
    return { next, transitions };
  }

  if (h.overridden !== prev.overridden) {
    add(h.overridden ? 'override' : 'rejoin');
    next.overridden = h.overridden;
    next.notifiedTargetF = h.targetF;
  } else if (mode === 'holding' && prev.mode !== 'holding') {
    add('setback_start');
    next.notifiedTargetF = h.targetF;
  } else if (mode === 'holding' && Math.abs(h.targetF - prev.notifiedTargetF) >= DEPTH_STEP_F) {
    add('depth_change', { previousTargetF: prev.notifiedTargetF });
    next.notifiedTargetF = h.targetF;
  } else if (prev.mode === 'holding' && mode !== 'holding' && mode !== 'overridden') {
    add('recovery_start');
    next.notifiedTargetF = h.targetF;
  }

  // Linking after the end stays silent: initialState marks the end as already notified.
  if (sim.simHour >= sim.eventEndHour && !prev.endNotified) {
    add('event_end');
    next.endNotified = true;
  }
  return { next, transitions };
}
