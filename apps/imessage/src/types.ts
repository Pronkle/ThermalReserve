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
  cohortId: number;   // template cohort (plan targets are per cohort)
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
  capacityMMcfd: number;
  maxDepthF: number;
  floorF: number;
  enrolledHomes: number;
  exemptShare: number;
  overrideRate: number;
}

export interface WeatherHourView { hour: number; outdoorF: number; systemMMcfh: number; }
export interface AggregateHourView { hour: number; fleetGasMMcf: number; baselineGasMMcf: number; systemMMcf: number; capacityMMcf: number; reliefMMcf: number; strategy: string; }

// Everything the Insights tools read: the live mirror in production, a fixture in tests.
export interface World {
  sim(): SimView | undefined;
  household(identity: string): HouseholdView | undefined;
  weather(): WeatherHourView[];
  planTargetF(cohortId: number, hour: number): number | undefined; // undefined: follow normal setpoint
  aggregates(): AggregateHourView[];
  // The dispatched plan as targets[cohortId][hour] (NaN = normal), or undefined when none.
  dispatchedPlan(cohortCount: number, hours: number): { planId: string; strategy: string; targetsF: number[][] } | undefined;
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
