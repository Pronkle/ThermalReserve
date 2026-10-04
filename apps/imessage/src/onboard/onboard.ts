// Auto-onboarding (H3, Oct 4): a household that opted in on /home with name, email and phone is
// added to Photon's user list, then gets one text-only opener asking for YES. Nothing else is
// sent until they reply (Photon's guidance for conversations we start). The contact source is
// STDB's private table once H1 approves it; until then nothing calls this.
import { maskAddress, type ChatConstants } from '../config';
import type { Store } from '../memory/store';
import type { HouseholdView, SimView } from '../types';
import { initialState } from '../watcher/detect';
import type { PhotonUser, PhotonUsers } from './photon';
import { validateUser } from './photon';

export interface ContactRequest extends PhotonUser { identity: string; }

export interface OnboardDeps {
  store: Store;
  consts: ChatConstants;
  photon: PhotonUsers;
  household: (identity: string) => HouseholdView | undefined;
  sim: () => SimView | undefined;
  sendText: (address: string, body: string) => Promise<void>;
  now?: () => number;
  log?: (line: string) => void;
}

export const opener = (nickname: string) =>
  `Thermal Reserve demo here for ${nickname}. You asked on the household page for heat updates by text during a simulated cold snap. Reply YES to start, or STOP and I won't text again.`;

export type OnboardResult = 'onboarded' | 'already linked' | 'invalid' | 'no household' | 'failed';

export async function onboard(deps: OnboardDeps, req: ContactRequest): Promise<OnboardResult> {
  const log = deps.log ?? console.log;
  const now = (deps.now ?? Date.now)();
  const problem = validateUser(req);
  if (problem) { log(`[onboard] skipped: ${problem}`); return 'invalid'; }
  if (deps.store.contact(req.phone)) return 'already linked';
  const home = deps.household(req.identity);
  if (!home) return 'no household';
  try {
    const known = await deps.photon.phones();
    if (!known.has(req.phone)) {
      await deps.photon.add(req);
      log(`[onboard] added ${maskAddress(req.phone)} to the Photon project`);
    }
    const sim = deps.sim();
    const state = sim ? initialState(home, sim, deps.consts) : { runKey: '', lastSimHour: 0, mode: 'normal' as const, overridden: home.overridden, notifiedTargetF: home.targetF, exemptNotified: false, endNotified: false };
    // Linked but not consented: the watcher queues nothing for them until they reply YES.
    deps.store.link(req.phone, req.identity, home.nickname, state, now, { consented: false });
    const body = opener(home.nickname);
    await deps.sendText(req.phone, body);
    deps.store.addHistory(req.phone, 'out', body, now);
    log(`[onboard] opener sent to ${maskAddress(req.phone)} for ${home.nickname}; waiting for YES`);
    return 'onboarded';
  } catch (e) {
    log(`[onboard] ${maskAddress(req.phone)} failed: ${String(e).slice(0, 200)}`);
    return 'failed';
  }
}
