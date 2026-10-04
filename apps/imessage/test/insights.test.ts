import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { converse, fallbackReply, toBubbles } from '../src/concierge/agent';
import { handleInbound } from '../src/concierge/inbound';
import { ask, type ModelCall } from '../src/insights/agent';
import { checkHonesty, extractNumbers } from '../src/insights/honesty';
import { scenario } from '../src/insights/model';
import { explainDecision, householdNow, runTool } from '../src/insights/tools';
import { Store } from '../src/memory/store';
import type { HouseholdView, SimView, World } from '../src/types';
import { consts, home, IDENTITY, NOON_ET, PHONE, sim } from './fixtures';

// feb2024 as loaded on dev: day 2 (from hour 48) is the one short day; the plan holds 65°F there.
const sc = scenario('feb2024')!;
const feb = (simHour: number, patch: Partial<SimView> = {}): SimView =>
  sim(simHour, { startIso: sc.startIso, capacityMMcfd: sc.capacityMMcfd, ...patch });
function world(opts: { sim?: SimView; home?: Partial<HouseholdView> } = {}): World {
  const s = opts.sim ?? feb(50);
  const h = home({ targetF: 65, taF: 65.4, ...opts.home });
  return {
    sim: () => s,
    household: id => (id === IDENTITY ? h : undefined),
    weather: () => sc.outdoorF.map((outdoorF, hour) => ({ hour, outdoorF, systemMMcfh: sc.systemMMcfh[hour] })),
    planTargetF: (_c, hour) => (hour >= 50 && hour < 74 ? 65 : undefined),
    aggregates: () => [],
    dispatchedPlan: (n, hours) => s.strategy === 'BASELINE' ? undefined
      : { planId: s.planId, strategy: s.strategy, targetsF: Array.from({ length: n }, () => Array.from({ length: hours }, (_, hr) => (hr >= 50 && hr < 74 ? 65 : NaN))) },
  };
}
const ctx = (w = world()) => ({ world: w, consts, identity: IDENTITY });

describe('honesty check', () => {
  const tools = [{ indoorF: { value: 68.4 }, targetF: { value: 66 }, clock: 'Thu Feb 1 06:00', reasons: ['a shortfall of 3.00 MMcf'] }];
  it('extracts prose numbers, thousands, percents, times and unicode minus', () => {
    expect(extractNumbers('−20°F, 25,000 homes, 7%, 06:00, 0.56').map(t => t.text)).toEqual(['−20', '25,000', '7', '06:00', '0.56']);
  });
  it('accepts tool numbers at the precision written', () => {
    expect(checkHonesty('Lowered to 66°F at 06:00; indoor 68°F; the day is 3 MMcf short.', tools).ok).toBe(true);
  });
  it('rejects a number or time no tool produced', () => {
    expect(checkHonesty('It will drop to 61°F by 07:00 and save 5.5 MMcf.', tools)).toEqual({ ok: false, unsupported: ['61', '07:00', '5.5'] });
  });
  it('allows numbers the person used in their question', () => {
    expect(checkHonesty('With 50,000 homes the tool says 0.56.', [{ x: 0.56 }], 'what if 50,000 homes?').ok).toBe(true);
  });
  it('does not treat 68 as supported by 68.4 written as 68.5', () => {
    expect(checkHonesty('Indoor is 68.5°F.', tools).ok).toBe(false);
  });
});

describe('explain_decision (feb2024)', () => {
  it('setback on the tight day: cites demand vs the delivery rate, how far above it, depth, floor and the naive counterfactual', () => {
    const r = explainDecision(ctx(), { hour: 50 });
    expect(r.action).toBe('setback');
    expect(r.gasDay?.demandAboveDeliveryRateWithoutProgram.value).toBe(3);
    expect(r.plannedTargetF.value).toBe(65);
    expect(r.setbackDepthF.value).toBe(5);
    expect(r.reasons.join(' ')).toMatch(/demand is 3\.00 MMcf above the delivery rate/);
    expect(r.reasons.join(' ')).toMatch(/4-hour morning setback would leave 2\.80 MMcf uncovered/);
    expect(r.reasons.join(' ')).toContain('never below 62°F');
  });
  it('compare_strategies includes the plan this home is on, named plainly and flagged', () => {
    const r = runTool(ctx(), 'compare_strategies', {}) as { thisHomeIsOn: string; strategies: { strategy: string; thisHomeIsOn: boolean; uncoveredByDayMMcf: { uncovered: number }[] }[] };
    expect(r.thisHomeIsOn).toMatch(/^optimized plan/);
    expect(r.strategies.map(x => x.strategy.split(' (')[0])).toEqual(['no program', 'simple 4-hour morning setback', 'rule-based stagger', 'optimized plan']);
    expect(r.strategies.filter(x => x.thisHomeIsOn)).toHaveLength(1);
    expect(r.strategies[3].thisHomeIsOn).toBe(true);
    expect(r.strategies[3].uncoveredByDayMMcf).toHaveLength(4);
  });
  it('explain_decision names the plan this home is on and its own uncovered value', () => {
    const r = explainDecision(ctx(), { hour: 50 });
    expect(r.thisHomeIsOn).toMatch(/^optimized plan/);
    expect(r.gasDay?.uncoveredWithThisHomesPlan).not.toBeNull();
    expect(r.reasons.join(' ')).toContain('The optimized plan this home is on leaves');
  });
  it('recovery on a day within the delivery rate says so', () => {
    const r = explainDecision(ctx(world({ sim: feb(74), home: { targetF: 70, taF: 66 } })), { hour: 74 });
    expect(r.action).toBe('recovery');
    expect(r.reasons.join(' ')).toContain('within the delivery rate');
  });
  it('no plan dispatched: says there is no setback instead of inventing one', () => {
    const r = explainDecision(ctx(world({ sim: feb(50, { strategy: 'BASELINE', planId: '' }) })), {});
    expect(r.action).toBe('no_plan');
  });
  it('exempt homes are explained as steady heat', () => {
    expect(explainDecision(ctx(world({ home: { exempt: true } })), {}).action).toBe('exempt');
  });
  it('household_now labels simulated numbers and never takes another identity', () => {
    const r = householdNow(ctx());
    expect(r.indoorF).toEqual({ value: 65.4, unit: '°F', label: 'derived · simulated' });
    expect(() => runTool({ ...ctx(), identity: 'someone-else' }, 'household_now', {})).toThrow(/not in the current simulation/);
  });
  it('what_if reproduces the steady-state headline (25,000 homes at 5°F ≈ 1.40 MMcf/day)', () => {
    const r = runTool(ctx(), 'what_if', { participationPct: 16.7, setbackF: 5 }) as { mmcfPerDay: { value: number } };
    expect(r.mmcfPerDay.value).toBeGreaterThan(1.35);
    expect(r.mmcfPerDay.value).toBeLessThan(1.45);
  });
});

// A scripted model: each call returns the next response; tool_use blocks get ids automatically.
function scripted(...steps: (Anthropic.ContentBlock[] | string)[]): ModelCall & { calls: Anthropic.MessageCreateParamsNonStreaming[] } {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  let i = 0;
  const fn = (async (params: Anthropic.MessageCreateParamsNonStreaming) => {
    calls.push(structuredClone(params));
    const step = steps[Math.min(i++, steps.length - 1)];
    const content = typeof step === 'string' ? [{ type: 'text', text: step, citations: null }] : step;
    return { id: `m${i}`, type: 'message', role: 'assistant', model: params.model, content, stop_reason: content.some(b => b.type === 'tool_use') ? 'tool_use' : 'end_turn', stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } as unknown as Anthropic.Message;
  }) as ModelCall & { calls: typeof calls };
  fn.calls = calls;
  return fn;
}
const use = (name: string, input: object = {}) => ({ type: 'tool_use', id: `t-${name}`, name, input }) as Anthropic.ContentBlock;

describe('insights agent', () => {
  it('uses explain_decision and returns a grounded answer on Sonnet 5.5 at low effort', async () => {
    const call = scripted([use('explain_decision', { hour: 50 })], 'Friday is the short day: demand 268.00 MMcf against capacity of 265.00 MMcf, so your home holds at 65°F (simulated), never below 62°F.');
    const r = await ask({ question: 'why now?', ctx: ctx(), call });
    expect(r.honesty).toEqual({ ok: true, unsupported: [], regenerated: false, fellBack: false });
    expect(r.toolCalls.map(t => t.name)).toEqual(['explain_decision']);
    expect(call.calls[0].model).toBe('claude-sonnet-5-5');
    expect(call.calls[0].output_config).toEqual({ effort: 'low' });
  });
  it('a made-up number triggers one rewrite, then the template from tool output', async () => {
    const call = scripted([use('explain_decision', { hour: 50 })], 'It saves 9.9 MMcf.', 'Still 9.9 MMcf.');
    const r = await ask({ question: 'why now?', ctx: ctx(), call });
    expect(r.honesty.regenerated).toBe(true);
    expect(r.honesty.fellBack).toBe(true);
    expect(r.answer).toContain('3.00 MMcf above the delivery rate');
    expect(r.answer).toContain('Simulated');
  });
  it('a rewrite that drops the made-up number passes', async () => {
    const call = scripted([use('household_now')], 'Indoor is 99°F.', 'Indoor is 65.4°F (simulated).');
    const r = await ask({ question: 'how warm is it?', ctx: ctx(), call });
    expect(r.honesty).toMatchObject({ ok: true, regenerated: true, fellBack: false });
  });
  it('no tools and no numbers (off-topic) is fine', async () => {
    const r = await ask({ question: 'whats your favorite color', ctx: ctx(), call: scripted('I stick to heat and gas questions, but blue is a good one for ice.') });
    expect(r.honesty.ok).toBe(true);
  });
});

describe('concierge agent', () => {
  const linked = () => {
    const store = new Store(':memory:');
    store.link(PHONE, IDENTITY, 'Test iPhone', { runKey: '', lastSimHour: 0, mode: 'normal', overridden: false, notifiedTargetF: 70, exemptNotified: false, endNotified: false }, NOON_ET);
    return store;
  };

  it('hands a why question to insights and relays it; the handoff is visible', async () => {
    const store = linked();
    const lines: string[] = [];
    const call = scripted(
      [use('ask_insights', { question: 'Why was the heat lowered at Fri Feb 2 02:00?' })],
      [use('explain_decision', { hour: 50 })],
      'Friday is short on gas: 3.00 MMcf. Your home holds at 65°F (simulated).',
      'Friday is the short day, about 3 MMcf short.\n\nSo your home holds at 65°F for now, simulated, and never below 62°F.',
    );
    const r = await converse({ store, world: world(), consts, call, log: l => lines.push(l) }, PHONE, IDENTITY, 'why?');
    expect(call.calls.map(c => c.model)).toEqual(['claude-haiku-4-5', 'claude-sonnet-5-5', 'claude-sonnet-5-5', 'claude-haiku-4-5']);
    expect(r.bubbles).toHaveLength(2);
    expect(r.insights).toHaveLength(1);
    expect(lines.some(l => /^\[handoff\] concierge → insights: "Why was the heat lowered at Fri Feb 2 02:00\?" → 1 tool call\(s\) \[explain_decision\] → honesty pass$/.test(l))).toBe(true);
    expect(store.personMemory(PHONE).answered).toEqual(['Why was the heat lowered at Fri Feb 2 02:00?']);
  });

  it('if the concierge adds a number, the analyst answer is sent instead', async () => {
    const call = scripted(
      [use('ask_insights', { question: 'q' })], [use('household_now')], 'Indoor is 65.4°F (simulated).',
      'Indoor is 65.4°F and you saved $40.',
    );
    const r = await converse({ store: linked(), world: world(), consts, call, log: () => undefined }, PHONE, IDENTITY, 'how is it');
    expect(r.bubbles).toEqual(['Indoor is 65.4°F (simulated).']);
  });

  it('an empty concierge reply still gets the data: the text goes to insights directly', async () => {
    const lines: string[] = [];
    const call = scripted([use('remember', { category: 'comfort', note: 'feels cold below 66°F' })], '', [use('household_now')], 'Indoor is 65.4°F (simulated).');
    const r = await converse({ store: linked(), world: world(), consts, call, log: l => lines.push(l) }, PHONE, IDENTITY, 'how warm is it now?');
    expect(r.bubbles).toEqual(['Indoor is 65.4°F (simulated).']);
    expect(lines.some(l => l.startsWith('[handoff] concierge → insights: "how warm is it now?"'))).toBe(true);
  });

  it('remember and set_preference persist', async () => {
    const store = linked();
    const call = scripted([use('remember', { category: 'household', note: "infant in the back bedroom" }), use('set_preference', { notifyLevel: 'summary' })], 'Noted. I\'ll only send the summary.');
    await converse({ store, world: world(), consts, call, log: () => undefined }, PHONE, IDENTITY, 'only big changes, the baby room gets cold');
    expect(store.personMemory(PHONE).notes?.household).toEqual(['infant in the back bedroom']);
    expect(store.contact(PHONE)?.notifyLevel).toBe('summary');
  });

  it('the memory card and recent conversation reach the model (persistent context)', async () => {
    const store = linked();
    store.updatePersonMemory(PHONE, m => ({ ...m, preferredName: 'Sam' }));
    store.addHistory(PHONE, 'out', 'Thermal Reserve demo, since my last text (simulated):\n• Fri 02:00 heat lowered to 65°F', NOON_ET);
    store.addHistory(PHONE, 'in', 'why the first one?', NOON_ET);
    const call = scripted('Hi Sam.');
    await converse({ store, world: world(), consts, call, log: () => undefined }, PHONE, IDENTITY, 'why the first one?');
    const prompt = JSON.stringify(call.calls[0].messages);
    expect(prompt).toContain('call them Sam');
    expect(prompt).toContain('Fri 02:00 heat lowered to 65°F');
  });

  it('fallback when the model is unreachable is honest and uses the floor for "too cold"', () => {
    expect(fallbackReply({ world: world(), consts }, IDENTITY, "it's too cold")).toContain('never goes below 62°F');
    expect(fallbackReply({ world: world(), consts }, IDENTITY, 'why?')).toContain("won't guess");
  });

  it('professional filter: no emoji, exclamation marks or em dashes reach the person', () => {
    expect(toBubbles('Yo 😎 all set here — you\'re good!!')).toEqual(["Yo all set here, you're good."]);
  });

  it('bubbles: at most 3', () => {
    expect(toBubbles('a\n\nb\n\nc\n\nd')).toEqual(['a', 'b', 'c d']);
  });

  it('inbound routes non-control texts from linked contacts to the concierge', async () => {
    const store = new Store(':memory:');
    const deps = { store, consts, households: () => [home()], sim: () => sim(0, { status: 'idle' }), now: () => NOON_ET, log: () => undefined, optedInHousehold: (a: string) => (a === PHONE ? IDENTITY : undefined),
      converse: async (_a: string, identity: string, text: string) => [`concierge(${identity === IDENTITY}) ${text}`] };
    await handleInbound(deps, PHONE, 'START');
    expect((await handleInbound(deps, PHONE, 'why now?')).texts).toEqual(['concierge(true) why now?']);
    expect((await handleInbound(deps, PHONE, 'thanks')).react).toBe('like');
  });
});
