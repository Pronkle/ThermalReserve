// Inbound texts (CHAT brief §5.1, §6.3). Phase 1 handles the control words with rules; Phase 2
// routes questions to the Insights agent through `answerQuestion`.
import type { ChatConstants } from '../config';
import { maskAddress } from '../config';
import { linkCode, parseLinkCode } from '../link';
import type { Store } from '../memory/store';
import type { HouseholdView, SimView } from '../types';
import { degF, statusWords } from '../watcher/compose';
import { initialState } from '../watcher/detect';

export type Intent = 'stop' | 'link' | 'unlink' | 'ack' | 'anytime' | 'quiet' | 'summary_only' | 'all_updates' | 'other';

const STOP_WORDS = /^(stop|stopall|unsubscribe|cancel|end|quit|stop texting( me)?|leave me alone)[.!]?$/i;
const ACK = /^(ok(ay)?|k|kk|thanks?|thank you|thx|ty|got it|cool|great|nice|sounds good|perfect|👍|🙏|❤️|👌)[.!]*$/iu;

export function classify(text: string): Intent {
  const t = text.trim();
  if (STOP_WORDS.test(t)) return 'stop';
  if (parseLinkCode(t)) return 'link';
  if (/^(no|nope|not my home|that'?s not (my|our) home)[.!]?$/i.test(t)) return 'unlink';
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
  // STOP also deletes the household's private contact row in the database, if it has one.
  onStop?: (address: string, identity: string) => Promise<void>;
  // Everything that isn't a control word goes to the concierge agent. Returns the reply bubbles.
  converse?: (address: string, identity: string, text: string) => Promise<string[]>;
}

export interface InboundReply { react?: 'like' | 'love'; texts: string[]; }

const UNLINKED_HELP = 'This is the Thermal Reserve demo assistant (automated; simulated heat only). To get heat updates, text Link and your home\'s code from the household page.';

export async function handleInbound(deps: InboundDeps, address: string, text: string): Promise<InboundReply> {
  const now = (deps.now ?? Date.now)();
  const log = deps.log ?? (line => console.log(line));
  const { store } = deps;
  const contact = store.contact(address);
  const intent = classify(text);
  if (contact) store.noteInbound(address, text, now);

  // Auto-onboarded contacts: we texted first, so only YES (or STOP) moves things forward.
  if (contact && !contact.consented && intent !== 'stop') {
    if (/^(yes|y|yeah|yep|sure|ok(ay)?|start|go ahead)[.!]?$/i.test(text.trim())) {
      store.setConsented(address);
      log(`[onboard] ${maskAddress(address)} replied YES`);
      const reply = `Thanks. You're set for ${contact.nickname}: I'll text you when a cold-snap event changes its heat (a simulation; no real thermostat). Ask me anything, or reply STOP any time.`;
      store.addHistory(address, 'out', reply, now);
      return { texts: [reply] };
    }
    return { texts: ['Reply YES to get heat updates for your home, or STOP and I won\'t text again.'] };
  }

  switch (intent) {
    case 'stop':
      if (contact && deps.onStop) {
        try { await deps.onStop(address, contact.identity); }
        catch (e) { log(`[link] ${maskAddress(address)} STOP: database contact not removed: ${String(e).slice(0, 120)}`); }
      }
      store.forget(address);
      log(`[link] ${maskAddress(address)} stopped; contact and memory deleted`);
      return { texts: ['You\'re unsubscribed and I\'ve deleted what I stored for this number. I won\'t text again unless you text me first.'] };

    case 'link': {
      const code = parseLinkCode(text)!;
      const home = deps.households().find(h => linkCode(h.identity) === code);
      if (!home) return { texts: [`I couldn't find a home with code ${code}. Check the code on the household page and try again.`] };
      const sim = deps.sim();
      const state = sim ? initialState(home, sim, deps.consts) : undefined;
      store.link(address, home.identity, home.nickname, state ?? emptyState(home), now);
      store.addHistory(address, 'in', text, now);
      log(`[link] ${maskAddress(address)} → ${home.nickname}`);
      const live = sim && sim.status !== 'idle' && sim.simHour < sim.eventEndHour
        ? ` Right now (simulated): indoor ${degF(home.taF)}, ${statusWords(home, deps.consts)}.` : '';
      const reply = `Linked to ${home.nickname}. I'll text you when a cold-snap event changes its heat (a simulation; no real thermostat).${live} Reply NO if that isn't your home, or STOP to end updates.`;
      store.addHistory(address, 'out', reply, now);
      return { texts: [reply] };
    }

    case 'unlink':
      if (!contact || now - contact.linkedAt > 10 * 60 * 1000) break;
      store.forget(address);
      log(`[link] ${maskAddress(address)} said NO; unlinked`);
      return { texts: ['Unlinked. Text Link and your code from the household page to try again.'] };

    case 'ack':
      // A person answers "thanks" with a tapback, not another text.
      return { react: 'like', texts: [] };

    default:
      break;
  }

  if (!contact) return { texts: [UNLINKED_HELP] };
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
