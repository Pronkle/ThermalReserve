// Inbound texts (CHAT brief §5.1, §6.3). No link codes (H3, Oct 4): a household opts in on /home
// with its phone number, then texts START; STOP ends it. Control words are handled by rules;
// everything else goes to the concierge agent.
import type { ChatConstants } from '../config';
import { maskAddress } from '../config';
import type { Store } from '../memory/store';
import type { HouseholdView, SimView } from '../types';
import { degF, statusWords } from '../watcher/compose';
import { initialState } from '../watcher/detect';

export type Intent = 'stop' | 'start' | 'ack' | 'anytime' | 'quiet' | 'summary_only' | 'all_updates' | 'other';

const STOP_WORDS = /^(stop|stopall|unsubscribe|cancel|end|quit|stop texting( me)?|leave me alone)[.!]?$/i;
const START_WORDS = /^(start|unstop|subscribe|join|yes|y|yeah|yep)[.!]?$/i;
const ACK = /^(ok(ay)?|k|kk|thanks?|thank you|thx|ty|got it|cool|great|nice|sounds good|perfect|👍|🙏|❤️|👌)[.!]*$/iu;

export function classify(text: string): Intent {
  const t = text.trim();
  if (STOP_WORDS.test(t)) return 'stop';
  if (START_WORDS.test(t)) return 'start';
  if (ACK.test(t)) return 'ack';
  if (/\b(text|message) me any ?time\b|\bnight texts? (are )?(ok|fine)\b/i.test(t)) return 'anytime';
  if (/\b(not|no|don'?t) (text|message)( me)? at night\b|\bquiet hours\b/i.test(t)) return 'quiet';
  if (/\bonly (the )?(big|major|important) (changes|ones)\b|\bjust (the )?summary\b|\bfewer (texts|messages)\b/i.test(t)) return 'summary_only';
  if (/\b(all|every) (the )?(updates|changes)\b|\btext me every change\b/i.test(t)) return 'all_updates';
  return 'other';
}

export interface InboundDeps {
  store: Store;
  consts: ChatConstants;
  households: () => HouseholdView[];
  sim: () => SimView | undefined;
  now?: () => number;
  log?: (line: string) => void;
  // The household that opted in on /home with this phone number (contact_feed), if any.
  optedInHousehold?: (address: string) => string | undefined;
  // STOP also deletes the household's private contact row in the database, if it has one.
  onStop?: (address: string, identity: string) => Promise<void>;
  // Everything that isn't a control word goes to the concierge agent. Returns the reply bubbles.
  converse?: (address: string, identity: string, text: string) => Promise<string[]>;
}

export interface InboundReply { react?: 'like' | 'love'; texts: string[]; }

export const NOT_OPTED_IN = 'This is the BoreaFlux demo assistant (automated; simulated heat only). To get heat updates, join on the household page, tick "Text me updates by iMessage" and enter this phone number, then text START here.';
const welcome = (home: HouseholdView, sim: SimView | undefined, consts: ChatConstants) => {
  const live = sim && sim.status !== 'idle' && sim.simHour < sim.eventEndHour
    ? ` Right now (simulated): indoor ${degF(home.taF)}, ${statusWords(home, consts)}.` : '';
  return `Thank you. You're set for ${home.nickname}: I'll text you when a cold-snap event changes its heat (a simulation; no real thermostat).${live} Ask me anything, or reply STOP at any time.`;
};

export async function handleInbound(deps: InboundDeps, address: string, text: string): Promise<InboundReply> {
  const now = (deps.now ?? Date.now)();
  const log = deps.log ?? (line => console.log(line));
  const { store } = deps;
  const contact = store.contact(address);
  const intent = classify(text);

  if (intent === 'stop') {
    if (contact && deps.onStop) {
      try { await deps.onStop(address, contact.identity); }
      catch (e) { log(`[link] ${maskAddress(address)} STOP: database contact not removed: ${String(e).slice(0, 120)}`); }
    }
    store.forget(address);
    log(`[link] ${maskAddress(address)} stopped; contact and memory deleted`);
    return { texts: ['You\'re unsubscribed and I\'ve deleted what I stored for this number. I won\'t text again unless you text me first.'] };
  }

  // Not linked yet: link to the household that opted in on /home with this number. Their text
  // (START, or anything else) is the consent; it also opts them in with Photon.
  if (!contact) {
    const identity = deps.optedInHousehold?.(address);
    const home = identity ? deps.households().find(h => h.identity === identity) : undefined;
    if (!home) return { texts: [NOT_OPTED_IN] };
    const sim = deps.sim();
    store.link(address, home.identity, home.nickname, sim ? initialState(home, sim, deps.consts) : emptyState(home), now);
    store.addHistory(address, 'in', text, now);
    log(`[link] ${maskAddress(address)} texted ${intent === 'start' ? 'START' : 'first'}; linked to ${home.nickname} from the /home opt-in`);
    const reply = welcome(home, sim, deps.consts);
    store.addHistory(address, 'out', reply, now);
    return { texts: [reply] };
  }
  store.noteInbound(address, text, now);

  // We texted first (opener): only START moves things forward.
  if (!contact.consented) {
    if (intent !== 'start') return { texts: ['Reply START to get heat updates for your home, or STOP and I won\'t text again.'] };
    store.setConsented(address);
    log(`[link] ${maskAddress(address)} replied START`);
    const home = deps.households().find(h => h.identity === contact.identity);
    const reply = home ? welcome(home, deps.sim(), deps.consts) : `Thank you. You're set for ${contact.nickname}. Reply STOP at any time.`;
    store.addHistory(address, 'out', reply, now);
    return { texts: [reply] };
  }

  if (intent === 'start') {
    const reply = `You're already set for ${contact.nickname}. Reply STOP at any time to end updates.`;
    store.addHistory(address, 'out', reply, now);
    return { texts: [reply] };
  }
  // A person answers "thanks" with a tapback, not another text.
  if (intent === 'ack') return { react: 'like', texts: [] };

  const reply = (texts: string[]) => {
    for (const t of texts) store.addHistory(address, 'out', t, now);
    return { texts };
  };

  switch (intent) {
    case 'anytime':
      store.setPreference(address, { anytime: true });
      return reply(['Got it, I\'ll text you any time of day, including at night.']);
    case 'quiet':
      store.setPreference(address, { anytime: false });
      return reply(['Got it, no texts between 22:00 and 08:00. Anything that happens then waits until morning.']);
    case 'summary_only':
      store.setPreference(address, { notifyLevel: 'summary' });
      return reply(['Got it, I\'ll only send a summary when the event ends.']);
    case 'all_updates':
      store.setPreference(address, { notifyLevel: 'all' });
      return reply(['Got it, I\'ll text you each time your heat changes.']);
    default:
      if (deps.converse) return reply(await deps.converse(address, contact.identity, text));
      return reply(['Thanks. I can\'t answer questions yet in this demo; I\'ll keep you posted when your heat changes. STOP ends updates.']);
  }
}

// Before any scenario is loaded there is no run to compare against.
function emptyState(h: HouseholdView) {
  return { runKey: '', lastSimHour: 0, mode: 'normal' as const, overridden: h.overridden, notifiedTargetF: h.targetF, exemptNotified: false, endNotified: false };
}
