// Auto-onboarding (H3, Oct 4): a household that opted in on /home with name and phone is
// added to Photon's user list, then gets one text-only opener asking for START. Nothing else is
// sent until they reply (Photon's guidance for conversations we start). The contact source is
// STDB's private household_contact table (H1 approved Oct 4; read path pending STDB's post).
import { maskAddress, type ChatConstants } from '../config';
import type { Store } from '../memory/store';
import type { HouseholdView, SimView } from '../types';
import { initialState } from '../watcher/detect';
import { linkCode } from '../link';
import type { PhotonUser, PhotonUsers } from './photon';
import { validateUser } from './photon';

// What /home collects (H1, Oct 4: no email anywhere).
export interface ContactRequest { identity: string; firstName: string; lastName: string; phone: string; }

// Photon's CLI insists on an email. We never ask for one: this placeholder is built from the
// public link code, and .invalid is a reserved domain that can never receive mail.
export const placeholderEmail = (identity: string) => `household-${linkCode(identity).toLowerCase()}@users.invalid`;
const toPhotonUser = (r: ContactRequest): PhotonUser => ({ firstName: r.firstName, lastName: r.lastName, phone: r.phone, email: placeholderEmail(r.identity) });

export interface OnboardDeps {
  store: Store;
  consts: ChatConstants;
  photon: PhotonUsers;
  household: (identity: string) => HouseholdView | undefined;
  sim: () => SimView | undefined;
  sendText: (address: string, body: string) => Promise<void>;
  // Hands the person's assigned Photon line to /home (set_contact_line, once STDB ships it).
  publishLine?: (identity: string, line: string) => Promise<void>;
  retryDelaysMs?: number[];
  now?: () => number;
  log?: (line: string) => void;
}

export const opener = (nickname: string) =>
  `BoreaFlux demo here for ${nickname}. You asked on the household page for heat updates by text during a simulated cold snap. Reply START to begin, or STOP and I won't text again.`;

export type OnboardResult = 'onboarded' | 'already linked' | 'invalid' | 'no household' | 'failed';

export async function onboard(deps: OnboardDeps, req: ContactRequest): Promise<OnboardResult> {
  const log = deps.log ?? console.log;
  const now = (deps.now ?? Date.now)();
  const user = toPhotonUser(req);
  const problem = validateUser(user);
  if (problem) { log(`[onboard] skipped: ${problem}`); return 'invalid'; }
  if (deps.store.contact(req.phone)) {
    // Already linked: just make sure /home still has their line to show (idempotent).
    const line = await deps.photon.assignedLine(req.phone).catch(() => undefined);
    if (line && deps.publishLine) await deps.publishLine(req.identity, line).catch(() => undefined);
    return 'already linked';
  }
  const home = deps.household(req.identity);
  if (!home) return 'no household';
  try {
    const known = await deps.photon.phones();
    if (!known.has(req.phone)) {
      await deps.photon.add(user);
      log(`[onboard] added ${maskAddress(req.phone)} to the Photon project`);
    }
    // /home shows "Text START to {line}": Photon won't let us text first until they do.
    const line = await deps.photon.assignedLine(req.phone).catch(() => undefined);
    if (line && deps.publishLine) {
      try { await deps.publishLine(req.identity, line); log(`[onboard] ${maskAddress(req.phone)}: assigned line ${line} sent to /home`); }
      catch (e) { log(`[onboard] ${maskAddress(req.phone)}: line not published: ${String(e).slice(0, 120)}`); }
    } else if (line) {
      log(`[onboard] ${maskAddress(req.phone)}: assigned line ${line} (tell them to text it once)`);
    }
    const sim = deps.sim();
    const state = sim ? initialState(home, sim, deps.consts) : { runKey: '', lastSimHour: 0, mode: 'normal' as const, overridden: home.overridden, notifiedTargetF: home.targetF, exemptNotified: false, endNotified: false };
    // Linked but not consented: the watcher queues nothing for them until they reply START.
    deps.store.link(req.phone, req.identity, home.nickname, state, now, { consented: false });
    const body = opener(home.nickname);
    // A number Photon has just added can be refused for a short while ("Target not allowed"), so
    // the opener is retried; if it never goes out, nothing stays stored and a restart tries again.
    let sent = false;
    for (const waitMs of deps.retryDelaysMs ?? [0, 20_000, 60_000]) {
      if (waitMs) await new Promise(r => setTimeout(r, waitMs));
      if (deps.store.contact(req.phone)?.consented) break; // they texted START: no opener needed
      try { await deps.sendText(req.phone, body); sent = true; break; }
      catch (e) { log(`[onboard] opener to ${maskAddress(req.phone)} not delivered yet: ${String(e).slice(0, 120)}`); }
    }
    if (!sent) {
      // They may have texted START meanwhile (that links them with consent): keep that link.
      if (deps.store.contact(req.phone)?.consented) { log(`[onboard] ${maskAddress(req.phone)}: opener not needed, they already texted START`); return 'onboarded'; }
      deps.store.forget(req.phone);
      log(`[onboard] ${maskAddress(req.phone)}: opener failed after retries; nothing stored`);
      return 'failed';
    }
    deps.store.addHistory(req.phone, 'out', body, now);
    log(`[onboard] opener sent to ${maskAddress(req.phone)} for ${home.nickname}; waiting for START`);
    return 'onboarded';
  } catch (e) {
    log(`[onboard] ${maskAddress(req.phone)} failed: ${String(e).slice(0, 200)}`);
    return 'failed';
  }
}
