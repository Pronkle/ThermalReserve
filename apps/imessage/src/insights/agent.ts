// Insights agent (CHAT brief §7): answers one standalone data question with tools. In-process
// behind ask(), so it could later become its own service or back an "Ask why" box on /home.
import type Anthropic from '@anthropic-ai/sdk';
import { checkHonesty } from './honesty';
import { runTool, ToolError, TOOLS, type ToolContext } from './tools';
import { clockLabel } from '../watcher/compose';

// The analyst reads the data and the model: Sonnet 5.5 at low effort (thinking stays adaptive;
// low effort keeps it short). The concierge, which only chats, stays on Haiku 4.5.
export const INSIGHTS_MODEL = 'claude-sonnet-5-5';
const MAX_TOOL_ROUNDS = 5;

export type ModelCall = (params: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message>;

export interface ToolCallRecord { name: string; input: unknown; output: unknown; error?: string; }

export interface InsightsAnswer {
  answer: string;
  toolCalls: ToolCallRecord[];
  honesty: { ok: boolean; unsupported: string[]; regenerated: boolean; fellBack: boolean };
}

// Stable prefix (tools, then this) so it can be cached when long enough; per-turn facts go in messages.
const SYSTEM = `You are the analyst behind the BoreaFlux demo, a simulation of smart-thermostat setbacks across Anchorage homes during a natural-gas cold snap. You answer one question about one household, for a text message.

Rules:
- Every number you write must come from a tool result in this conversation. If no tool gives it, don't state it. Copy numbers as the tools give them, or rounded.
- For any "why", call explain_decision first (for the hour asked about; omit hour for now). Use other tools only when the question needs them.
- Say "simulated" when you talk about this home's heat or savings. Nothing here controls a real thermostat.
- Mention a label (assumed, derived) when a number is assumed or derived, briefly, e.g. "the delivery rate (an operator setting)".
- When you compare strategies, name each one as the tools name it, and say which one this home is on (thisHomeIsOn). Never attach a number to a strategy other than the one the tool gave it for.
- Supply is described as the delivery rate: the most gas per day the pipelines can bring in. Say "demand above the delivery rate", not "capacity" or "shortfall". Don't talk about pipeline pressure; the tools don't give you pressure numbers.
- If the data doesn't answer the question, say so plainly. Never guess.
- If the question is off-topic, answer in one friendly line without numbers.
- Explain the hour you were asked about: name its day and time as explain_decision gives them, and if another day's numbers matter, say which day they belong to.
- Professional and measured: plain words, complete sentences, no slang, emoji, exclamation marks, hype or certainty the data doesn't support (say "keeps demand closer to the delivery rate", not "exactly the right amount"). Don't say "AI". 2 to 4 short sentences, no lists, no markdown.`;

export interface AskInput {
  question: string;            // standalone (the concierge resolves "the second one" before asking)
  ctx: ToolContext;
  call: ModelCall;
  log?: (line: string) => void;
}

function textOf(message: Anthropic.Message): string {
  return message.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map(b => b.text).join('\n').trim();
}

// Built only from tool outputs: used when the model fails the honesty check twice or is unreachable.
export function templateAnswer(toolCalls: ToolCallRecord[]): string {
  const explain = toolCalls.find(t => t.name === 'explain_decision' && !t.error)?.output as { reasons?: string[] } | undefined;
  if (explain?.reasons?.length) return `${explain.reasons.slice(0, 3).join(' ')} (Simulated.)`;
  return 'I couldn\'t confirm that from the simulation data, so I won\'t guess.';
}

export async function ask({ question, ctx, call, log = () => undefined }: AskInput): Promise<InsightsAnswer> {
  const sim = ctx.world.sim();
  const home = ctx.world.household(ctx.identity);
  const now = sim ? `Simulated time now: ${clockLabel(sim.startIso, sim.simHour)} (sim hour ${sim.simHour.toFixed(1)}), run ${sim.status}, strategy ${sim.strategy}.` : 'No scenario is loaded.';
  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: `${now}\nHousehold: ${home?.nickname ?? 'unknown'}.\nQuestion: ${question}` },
  ];
  const toolCalls: ToolCallRecord[] = [];
  const request = (): Anthropic.MessageCreateParamsNonStreaming => ({
    model: INSIGHTS_MODEL,
    max_tokens: 4096, // room for adaptive thinking before the short answer
    output_config: { effort: 'low' },
    tools: TOOLS,
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages,
  });

  let final: Anthropic.Message | undefined;
  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const response = await call(request());
    if (response.stop_reason !== 'tool_use') { final = response; break; }
    messages.push({ role: 'assistant', content: response.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== 'tool_use') continue;
      try {
        const output = runTool(ctx, block.name, (block.input ?? {}) as Record<string, unknown>);
        toolCalls.push({ name: block.name, input: block.input, output });
        results.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(output) });
      } catch (e) {
        const error = e instanceof ToolError ? e.message : `Tool failed: ${String(e)}`;
        toolCalls.push({ name: block.name, input: block.input, output: null, error });
        results.push({ type: 'tool_result', tool_use_id: block.id, content: error, is_error: true });
      }
    }
    messages.push({ role: 'user', content: results });
  }

  const outputs = toolCalls.map(t => t.output);
  let draft = final ? textOf(final) : '';
  let check = checkHonesty(draft, outputs, question);
  let regenerated = false;
  if (draft && !check.ok && final) {
    // One regeneration with the offending numbers named.
    regenerated = true;
    log(`[honesty] unsupported numbers ${check.unsupported.join(', ')}; regenerating once`);
    messages.push({ role: 'assistant', content: final.content });
    messages.push({ role: 'user', content: `These numbers don't appear in any tool result: ${check.unsupported.join(', ')}. Rewrite the answer using only numbers from the tool results, or leave them out.` });
    const retry = await call({ ...request(), tools: TOOLS, tool_choice: { type: 'none' } });
    draft = textOf(retry);
    check = checkHonesty(draft, outputs, question);
  }
  const fellBack = !draft || !check.ok;
  if (fellBack) log(`[honesty] ${draft ? 'still failing' : 'no answer'}; using the template built from tool outputs`);
  return {
    answer: fellBack ? templateAnswer(toolCalls) : draft,
    toolCalls,
    honesty: { ok: !fellBack, unsupported: check.unsupported, regenerated, fellBack },
  };
}
