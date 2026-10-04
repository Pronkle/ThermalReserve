// Plain views of the Spacetime rows the companion reads (decoupled from the generated bindings
// so the watcher and composer are pure and testable).

export interface HouseholdView {
  identity: string;   // hex
  nickname: string;
  taF: number;
  targetF: number;
  floorF: number;
  overridden: boolean;
  exempt: boolean;
  savedCf: number;
}

export interface SimView {
  scenarioId: string;
  planId: string;
  strategy: string;
  status: string;     // idle | running | paused | finished
  simHour: number;
  hours: number;
  eventStartHour: number;
  eventEndHour: number;
  startIso: string;
}

export type HeatMode = 'normal' | 'holding' | 'recovering' | 'overridden' | 'exempt';

export type TransitionKind =
  | 'setback_start'
  | 'depth_change'
  | 'recovery_start'
  | 'override'
  | 'rejoin'
  | 'event_end'
  | 'exempt_start';

// One notable change for one household; the composer turns a list of these into one message.
export interface Transition {
  id: string;          // stable across restarts: run key + kind + sim hour
  kind: TransitionKind;
  simHour: number;
  targetF: number;
  previousTargetF?: number;
  taF: number;
  savedCf: number;
}
