import type { ChatConfig, ChatConstants } from '../src/config';
import type { HouseholdView, SimView } from '../src/types';

export const consts: ChatConstants = { setpointDayF: 70, floorDefaultF: 62 };

export const config: ChatConfig = {
  stdbUri: 'wss://example.invalid', stdbDb: 'test', demo: false, throttleMs: 20_000, debounceMs: 1_500,
  quietStartHour: 22, quietEndHour: 8, timeZone: 'America/New_York', dataDir: '/nonexistent', helloTo: undefined,
};

export const PHONE = '+15555550123';
export const IDENTITY = 'c200abe32fb6aa00112233445566778899aabbccddeeff00112233445566778899';

export const home = (patch: Partial<HouseholdView> = {}): HouseholdView => ({
  identity: IDENTITY, nickname: 'Test iPhone', taF: 70, targetF: 70, floorF: 62,
  overridden: false, exempt: false, savedCf: 0, ...patch,
});

export const sim = (simHour: number, patch: Partial<SimView> = {}): SimView => ({
  scenarioId: 'feb2024', planId: 'feb2024-OPTIMIZED', strategy: 'OPTIMIZED', status: 'running',
  simHour, hours: 96, eventStartHour: 12, eventEndHour: 84, startIso: '2024-01-31T00:00:00-09:00', ...patch,
});

// Noon Eastern on a fixed day: outside quiet hours.
export const NOON_ET = Date.parse('2026-10-04T12:00:00-04:00');
