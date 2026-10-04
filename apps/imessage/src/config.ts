// Runtime settings from the environment. Secrets (Spectrum, Anthropic) are read by their SDKs,
// never here, so this object is safe to log.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
export const REPO_DIR = join(APP_DIR, '..', '..');

export interface ChatConfig {
  stdbUri: string;
  stdbDb: string;
  demo: boolean;
  throttleMs: number;     // at most one proactive message per contact per window
  debounceMs: number;     // wait this long after a first transition so same-tick changes share a message
  quietStartHour: number; // real clock, recipient time zone
  quietEndHour: number;
  timeZone: string;
  dataDir: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ChatConfig {
  const demo = env.CHAT_DEMO === '1';
  return {
    stdbUri: env.STDB_URI ?? 'wss://maincloud.spacetimedb.com',
    stdbDb: env.STDB_DB ?? 'thermal-reserve-dev',
    demo,
    throttleMs: Number(env.CHAT_THROTTLE_S ?? 20) * 1000,
    debounceMs: Number(env.CHAT_DEBOUNCE_S ?? 1.5) * 1000,
    quietStartHour: 22,
    quietEndHour: 8,
    timeZone: env.CHAT_TZ ?? 'America/New_York',
    dataDir: env.CHAT_DATA_DIR ?? join(APP_DIR, 'data'),
  };
}

// The constants the messages quote, read from data/constants.json (never retyped).
export interface ChatConstants {
  setpointDayF: number;   // household templates use the steady schedule, so this is their normal setpoint
  floorDefaultF: number;
}

export function loadChatConstants(path = join(REPO_DIR, 'data', 'constants.json')): ChatConstants {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, { value: number }>;
  return { setpointDayF: raw.setpoint_day_f.value, floorDefaultF: raw.floor_default_f.value };
}

// Phone numbers never reach info-level logs whole.
export const maskAddress = (address: string) => address.replace(/\d(?=\d{4})/g, '•');
