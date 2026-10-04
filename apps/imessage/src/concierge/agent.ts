// Concierge agent (CHAT brief §6.3): owns the conversation. It never computes numbers; data
// questions go to the Insights agent through the ask_insights tool, and its own reply is checked
// so it can't add a number that Insights or the facts card didn't give it.
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type Anthropic from '@anthropic-ai/sdk';
import type { ChatConstants } from '../config';
import type { PersonMemory, Store } from '../memory/store';
import { checkHonesty } from '../insights/honesty';
import { ask, type InsightsAnswer, type ModelCall } from '../insights/agent';
import type { World } from '../types';
import { clockLabel, degF, statusWords } from '../watcher/compose';

export const CONCIERGE_MODEL = 'claude-haiku-4-5';

const SYSTEM = `You are the Thermal Reserve demo assistant, texting with one household over iMessage. Thermal Reserve is a simulation: during a natural-gas cold snap in Anchorage it lowers enrolled homes' (simulated) thermostats a few degrees so businesses aren't cut off. Nothing controls a real thermostat.

How you work:
- You don't compute or look up numbers. For any question about this home's heat, the plan, savings, gas supply, weather, or what-ifs, call ask_insights with one standalone question. Resolve references like "the second one" or "yesterday" from the conversation first, naming the time or event.
- Relay the analyst's answer in the person's style and length. You may shorten it; keep every number exactly as given, or drop it.
- If they feel cold or unhappy: one line of empathy, the floor from the facts card ("never below ..."), and how to get normal heat right away: the Override button on the household page. Don't argue.
- Preferences ("only big changes", "text me every change", "text me anytime", "no texts at night") go to set_preference; confirm in one line.
- Things worth remembering about the person (a name to use, who they worry about, whether they like numbers or short answers) go to remember.
- Small talk or off-topic: one friendly line, then steer back gently. If asked, say you're an automated assistant for a simulation; don't pretend to be a person.
- Use what you remember about them (the memory card) when it helps, briefly.

Style: like a considerate person texting. 1 to 3 short bubbles separated by a blank line. Plain words, °F, no exclamation marks, no markdown or lists, never "AI-powered".`;

const TOOLS: Anthropic.Tool[] = [
  { name: 'ask_insights', description: 'Hand a data question to the analyst agent. Returns its answer, grounded in the live simulation and model. Use for anything with numbers or reasons.', input_schema: { type: 'object', properties: { question: { type: 'string', description: 'One standalone question, with any time or event named explicitly.' } }, required: ['question'], additionalProperties: false } },
  { name: 'remember', description: 'Save something about this person for later conversations.', input_schema: { type: 'object', properties: { preferredName: { type: 'string' }, verbosity: { type: 'string', enum: ['short', 'normal', 'detailed'] }, caresAbout: { type: 'string', description: 'One short note, e.g. "worried about the baby\'s room"' } }, additionalProperties: false } },
  { name: 'set_preference', description: 'Change how often to text: notifyLevel "summary" (only the end-of-event summary) or "all"; anytime true to allow texts at night.', input_schema: { type: 'object', properties: { notifyLevel: { type: 'string', enum: ['summary', 'all'] }, anytime: { type: 'boolean' } }, additionalProperties: false } },
];

export interface ConciergeDeps {
  store: Store;
  world: World;
  consts: ChatConstants;
  call: ModelCall;
  dataDir?: string;
  log?: (line: string) => void;
}

export interface ConciergeReply { bubbles: string[]; insights: InsightsAnswer[]; }

function factsCard(deps: ConciergeDeps, identity: string): string {
  const sim = deps.world.sim();
  const h = deps.world.household(identity);
  if (!sim || !h) return 'Facts card: no live simulation data for this home right now.';
  const floor = Math.max(h.floorF, deps.consts.floorDefaultF);
  return [
    `Facts card (from the simulation, safe to quote):`,
    `home ${h.nickname}; simulated time ${clockLabel(sim.startIso, sim.simHour)}; run ${sim.status}`,
    `indoor ${degF(h.taF)}; status ${statusWords(h, deps.consts)}; normal ${degF(deps.consts.setpointDayF)}; floor ${degF(floor)} (assumed program setting)`,
    `net gas saved so far ${Math.round(h.savedCf)} cubic feet (simulated, includes reheat)`,
  ].join('\n');
}

function memoryCard(memory: PersonMemory): string {
  const parts = [
    memory.preferredName && `call them ${memory.preferredName}`,
    memory.verbosity && `prefers ${memory.verbosity} answers`,
    memory.caresAbout?.length && `cares about: ${memory.caresAbout.join('; ')}`,
    memory.answered?.length && `already answered: ${memory.answered.slice(-4).join(' | ')}`,
  ].filter(Boolean);
  return parts.length ? `Memory card: ${parts.join('; ')}.` : 'Memory card: nothing saved yet.';
}

function transcript(history: { direction: 'in' | 'out'; body: string }[]): string {
  const lines = history.slice(-16).map(h => `${h.direction === 'in' ? 'Them' : 'You'}: ${h.body.replace(/\n+/g, ' / ')}`);
  return lines.length ? `Recent conversation (oldest first):\n${lines.join('\n')}` : 'Recent conversation: none.';
}

// The demo's evidence of the handoff: one line on screen and one JSON line on disk per question.
function logHandoff(deps: ConciergeDeps, question: string, result: InsightsAnswer) {
  const tools = result.toolCalls.map(t => t.name);
  const honesty = result.honesty.fellBack ? 'fell back to template' : result.honesty.regenerated ? 'pass after one rewrite' : 'pass';
  (deps.log ?? console.log)(`[handoff] concierge → insights: "${question}" → ${tools.length} tool call(s) [${tools.join(', ')}] → honesty ${honesty}`);
  if (!deps.dataDir) return;
  mkdirSync(deps.dataDir, { recursive: true });
  appendFileSync(join(deps.dataDir, 'handoff.jsonl'), JSON.stringify({
    at: new Date().toISOString(), from: 'concierge', to: 'insights', question,
    toolCalls: result.toolCalls.map(t => ({ name: t.name, input: t.input, error: t.error })),
    honesty: result.honesty, answer: result.answer,
  }) + '\n');
}

export async function converse(deps: ConciergeDeps, address: string, identity: string, text: string): Promise<ConciergeReply> {
  const { store } = deps;
  const memory = store.personMemory(address);
  const facts = factsCard(deps, identity);
  const history = store.history(address).slice(0, -1); // the current inbound text is already stored last
  const messages: Anthropic.MessageParam[] = [{
    role: 'user',
    content: `${facts}\n${memoryCard(memory)}\n${transcript(history)}\n\nTheir new text: ${text}`,
  }];
  const insights: InsightsAnswer[] = [];

  let final: Anthropic.Message | undefined;
  for (let round = 0; round < 4; round++) {
    const response = await deps.call({
      model: CONCIERGE_MODEL, max_tokens: 600, tools: TOOLS,
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages,
    });
    if (response.stop_reason !== 'tool_use') { final = response; break; }
    messages.push({ role: 'assistant', content: response.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== 'tool_use') continue;
      const input = (block.input ?? {}) as Record<string, unknown>;
      if (block.name === 'ask_insights') {
        const question = String(input.question ?? text).slice(0, 400);
        const result = await ask({ question, ctx: { world: deps.world, consts: deps.consts, identity }, call: deps.call, log: deps.log });
        insights.push(result);
        logHandoff(deps, question, result);
        store.updatePersonMemory(address, m => ({ ...m, answered: [...(m.answered ?? []), question].slice(-8), lastExplanation: result.answer }));
        results.push({ type: 'tool_result', tool_use_id: block.id, content: result.answer });
      } else if (block.name === 'remember') {
        store.updatePersonMemory(address, m => ({
          ...m,
          preferredName: typeof input.preferredName === 'string' ? input.preferredName.slice(0, 40) : m.preferredName,
          verbosity: typeof input.verbosity === 'string' ? input.verbosity as PersonMemory['verbosity'] : m.verbosity,
          caresAbout: typeof input.caresAbout === 'string' ? [...(m.caresAbout ?? []), input.caresAbout.slice(0, 120)].slice(-6) : m.caresAbout,
        }));
        results.push({ type: 'tool_result', tool_use_id: block.id, content: 'saved' });
      } else if (block.name === 'set_preference') {
        store.setPreference(address, {
          notifyLevel: input.notifyLevel === 'summary' || input.notifyLevel === 'all' ? input.notifyLevel : undefined,
          anytime: typeof input.anytime === 'boolean' ? input.anytime : undefined,
        });
        results.push({ type: 'tool_result', tool_use_id: block.id, content: 'saved' });
      } else {
        results.push({ type: 'tool_result', tool_use_id: block.id, content: `Unknown tool ${block.name}`, is_error: true });
      }
    }
    messages.push({ role: 'user', content: results });
  }

  const draft = final ? final.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map(b => b.text).join('\n').trim() : '';
  // The concierge may only repeat numbers that Insights, the facts card, or the person gave.
  const evidence = [...insights.flatMap(r => [r.answer, ...r.toolCalls.map(t => t.output)]), facts, text];
  const check = checkHonesty(draft, evidence);
  let reply = draft;
  if (!draft || !check.ok) {
    (deps.log ?? console.log)(`[honesty] concierge reply ${draft ? `added ${check.unsupported.join(', ')}` : 'empty'}; sending the analyst's answer instead`);
    reply = insights.at(-1)?.answer ?? fallbackReply(deps, identity, text);
  }
  return { bubbles: toBubbles(reply), insights };
}

export function toBubbles(reply: string): string[] {
  const parts = reply.split(/\n\s*\n/).map(p => p.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean);
  if (parts.length <= 3) return parts;
  return [...parts.slice(0, 2), parts.slice(2).join(' ')];
}

// When the model can't be reached: honest, deterministic, still useful.
export function fallbackReply(deps: Pick<ConciergeDeps, 'world' | 'consts'>, identity: string, text: string): string {
  const h = deps.world.household(identity);
  if (/\b(cold|freez|chilly|too cool|uncomfortable)/i.test(text) && h) {
    return `Sorry it feels cold. In this simulation your heat never goes below ${degF(Math.max(h.floorF, deps.consts.floorDefaultF))}, and the Override button on the household page brings normal heat back right away.`;
  }
  const status = h ? ` Right now (simulated): indoor ${degF(h.taF)}, ${statusWords(h, deps.consts)}.` : '';
  return `I can't reach my analysis tools at the moment, so I won't guess.${status} Try me again in a minute.`;
}
