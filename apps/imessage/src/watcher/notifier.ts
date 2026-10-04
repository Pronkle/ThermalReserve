// Watcher → outbox (CHAT brief §6.1): records transitions per linked contact, then sends at most
// one proactive message per contact per throttle window, listing everything queued since the last.
import { createHash } from 'node:crypto';
import type { ChatConfig, ChatConstants } from '../config';
import { maskAddress } from '../config';
import type { Contact, Store } from '../memory/store';
import type { HouseholdView, SimView } from '../types';
import { composeMessage } from './compose';
import { detect } from './detect';

export interface NotifierDeps {
  store: Store;
  config: ChatConfig;
  consts: ChatConstants;
  household: (identity: string) => HouseholdView | undefined;
  sim: () => SimView | undefined;
  sendText: (address: string, body: string) => Promise<void>;
  // True while a reply to this person is being drafted or was just sent: updates wait so they
  // never land in the middle of an answer (they're queued, not dropped).
  isBusy?: (address: string) => boolean;
  now?: () => number;
  log?: (line: string) => void;
}

// After this many proactive texts with no reply, only the end-of-event summary goes out until
// they text again (CHAT brief §6.1: social awareness and deliverability in one).
export const UNANSWERED_LIMIT = 2;
export const BACKOFF_NOTICE = "You haven't replied, so I'll only send the end-of-event summary unless you text me.";

export function inQuietHours(nowMs: number, cfg: Pick<ChatConfig, 'quietStartHour' | 'quietEndHour' | 'timeZone'>): boolean {
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: cfg.timeZone, hour: '2-digit', hourCycle: 'h23' }).format(nowMs));
  return cfg.quietStartHour > cfg.quietEndHour
    ? hour >= cfg.quietStartHour || hour < cfg.quietEndHour
    : hour >= cfg.quietStartHour && hour < cfg.quietEndHour;
}

export class Notifier {
  private readonly inFlight = new Set<string>();
  private readonly lastHoldReason = new Map<string, string>();
  private readonly now: () => number;
  private readonly log: (line: string) => void;

  constructor(private readonly deps: NotifierDeps) {
    this.now = deps.now ?? Date.now;
    this.log = deps.log ?? (line => console.log(line));
  }

  // Call on every mirror change: compares each linked household with its last notified state.
  observe() {
    const sim = this.deps.sim();
    if (!sim) return;
    for (const contact of this.deps.store.contacts()) {
      const h = this.deps.household(contact.identity);
      if (!h) continue;
      const { next, transitions } = detect(contact.lastState, h, sim, this.deps.consts);
      if (transitions.length > 0 || JSON.stringify(next) !== JSON.stringify(contact.lastState)) {
        this.deps.store.recordTransitions(contact.address, next, transitions, this.now());
        for (const t of transitions) this.log(`[watch] ${maskAddress(contact.address)} ${t.kind} at sim hour ${t.simHour.toFixed(1)} → queued`);
      }
    }
  }

  // Call on a timer: sends what the throttle, debounce and quiet hours allow.
  async flush() {
    await Promise.all(this.deps.store.contacts().map(c => this.flushContact(c)));
  }

  private hold(contact: Contact, reason: string) {
    // Demo mode logs every suppression (once per reason) so judges can see why it stayed silent.
    if (this.deps.config.demo && this.lastHoldReason.get(contact.address) !== reason) {
      this.log(`[hold] ${maskAddress(contact.address)}: ${reason}`);
    }
    this.lastHoldReason.set(contact.address, reason);
  }

  private async flushContact(contact: Contact) {
    if (this.inFlight.has(contact.address)) return;
    const { store, config, consts } = this.deps;
    const pending = store.pending(contact.address);
    if (pending.length === 0) return;
    const now = this.now();
    const transitions = pending.map(p => p.transition);
    const hasEnd = transitions.some(t => t.kind === 'event_end');
    if (contact.notifyLevel === 'summary' && !hasEnd) {
      return this.hold(contact, `summary-only preference; ${pending.length} change(s) saved for the event summary`);
    }
    if (contact.unanswered >= UNANSWERED_LIMIT && !hasEnd) {
      return this.hold(contact, `${contact.unanswered} texts unanswered; ${pending.length} change(s) saved for the event summary`);
    }
    if (now - pending[0].createdAt < config.debounceMs) return;
    if (this.deps.isBusy?.(contact.address)) {
      return this.hold(contact, `replying to them; ${pending.length} change(s) wait for the next catch-up`);
    }
    const wait = contact.lastSentAt + config.throttleMs - now;
    if (wait > 0) {
      const at = new Date(contact.lastSentAt + config.throttleMs).toISOString().slice(11, 19);
      return this.hold(contact, `throttled; ${pending.length} change(s) queued for one message at ${at} UTC`);
    }
    if (!config.demo && !contact.anytime && inQuietHours(now, config)) {
      return this.hold(contact, `quiet hours (${config.quietStartHour}:00–${config.quietEndHour}:00 ${config.timeZone}); ${pending.length} change(s) queued`);
    }
    const h = this.deps.household(contact.identity);
    const sim = this.deps.sim();
    if (!h || !sim) return;

    // The text that reaches the limit says, once, that we're backing off.
    const backingOff = contact.notifyLevel === 'all' && !hasEnd && contact.unanswered === UNANSWERED_LIMIT - 1;
    const body = composeMessage(transitions, h, sim, consts) + (backingOff ? `\n${BACKOFF_NOTICE}` : '');
    const ids = pending.map(p => p.id);
    const id = createHash('sha256').update(`${contact.address}\n${ids.join('\n')}`).digest('hex').slice(0, 24);
    if (!store.beginSend({ id, address: contact.address, body, transitionIds: ids }, now)) return;
    this.inFlight.add(contact.address);
    this.lastHoldReason.delete(contact.address);
    try {
      await this.deps.sendText(contact.address, body);
      store.finishSend(id, this.now());
      store.addHistory(contact.address, 'out', body, this.now());
      this.log(`[send] ${maskAddress(contact.address)}: ${transitions.length} change(s) in one message`);
    } catch (e) {
      store.failSend(id, contact.address, String(e), this.now());
      this.log(`[send] ${maskAddress(contact.address)} failed, will retry next window: ${String(e).slice(0, 160)}`);
    } finally {
      this.inFlight.delete(contact.address);
    }
  }
}
