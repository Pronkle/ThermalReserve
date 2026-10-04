import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { ask } from '../src/insights/agent';
import { scenario } from '../src/insights/model';
import { fromGeminiResponse, GeminiError, geminiCall, toGeminiRequest, toGeminiSchema } from '../src/llm/gemini';
import type { World } from '../src/types';
import { consts, home, IDENTITY, sim } from './fixtures';

const tools: Anthropic.Tool[] = [
  { name: 'household_now', description: 'now', input_schema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'explain_decision', description: 'why', input_schema: { type: 'object', properties: { hour: { type: 'number' } }, additionalProperties: false } },
];

describe('gemini request translation', () => {
  it('maps system, tools, tool_choice none, max_tokens and effort', () => {
    const req = toGeminiRequest({
      model: 'claude-sonnet-5-5', max_tokens: 4096, tools, tool_choice: { type: 'none' },
      system: [{ type: 'text', text: 'Be honest.', cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: 'why?' }], output_config: { effort: 'low' },
    } as Anthropic.MessageCreateParamsNonStreaming) as Record<string, any>;
    expect(req.systemInstruction).toEqual({ parts: [{ text: 'Be honest.' }] });
    expect(req.contents).toEqual([{ role: 'user', parts: [{ text: 'why?' }] }]);
    expect(req.tools[0].functionDeclarations).toEqual([
      { name: 'household_now', description: 'now' },                                           // no-arg tool: no parameters
      { name: 'explain_decision', description: 'why', parameters: { type: 'object', properties: { hour: { type: 'number' } } } },
    ]);
    expect(req.toolConfig).toEqual({ functionCallingConfig: { mode: 'NONE' } });
    expect(req.generationConfig).toEqual({ maxOutputTokens: 4096, thinkingConfig: { thinkingLevel: 'low' } });
  });

  it('drops JSON Schema keywords Gemini rejects, recursively', () => {
    expect(toGeminiSchema({ type: 'object', additionalProperties: false, properties: { a: { type: 'object', additionalProperties: false } } }))
      .toEqual({ type: 'object', properties: { a: { type: 'object' } } });
  });

  it('round trip: function calls keep their thought signatures; results go back as functionResponse with the tool name', () => {
    const raw = { candidates: [{ content: { parts: [{ thoughtSignature: 'sig-1', functionCall: { id: 'c1', name: 'explain_decision', args: { hour: 50 } } }] }, finishReason: 'STOP' }] };
    const msg = fromGeminiResponse(raw, 'gemini-3.8-flash');
    expect(msg.stop_reason).toBe('tool_use');
    expect(msg.content).toEqual([{ type: 'tool_use', id: 'c1', name: 'explain_decision', input: { hour: 50 } }]);
    const req = toGeminiRequest({
      model: 'x', max_tokens: 10, messages: [
        { role: 'user', content: 'why?' },
        { role: 'assistant', content: msg.content },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c1', content: '{"reasons":["r"]}' }] },
      ],
    }) as { contents: unknown[] };
    expect(req.contents[1]).toEqual({ role: 'model', parts: [{ thoughtSignature: 'sig-1', functionCall: { id: 'c1', name: 'explain_decision', args: { hour: 50 } } }] });
    expect(req.contents[2]).toEqual({ role: 'user', parts: [{ functionResponse: { id: 'c1', name: 'explain_decision', response: { result: '{"reasons":["r"]}' } } }] });
  });

  it('calls without a Gemini id get a local id that is never sent back', () => {
    const msg = fromGeminiResponse({ candidates: [{ content: { parts: [{ functionCall: { name: 'household_now' } }] } }] }, 'm');
    const id = (msg.content[0] as Anthropic.ToolUseBlock).id;
    const req = toGeminiRequest({ model: 'x', max_tokens: 10, messages: [
      { role: 'user', content: 'q' }, { role: 'assistant', content: msg.content },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok', is_error: true }] },
    ] }) as { contents: { parts: unknown[] }[] };
    expect(req.contents[2].parts[0]).toEqual({ functionResponse: { name: 'household_now', response: { error: 'ok' } } });
  });

  it('skips thought parts, maps finish reasons and usage', () => {
    const msg = fromGeminiResponse({
      candidates: [{ content: { parts: [{ text: 'thinking…', thought: true }, { text: 'Answer.' }] }, finishReason: 'MAX_TOKENS' }],
      usageMetadata: { promptTokenCount: 1200, cachedContentTokenCount: 200, candidatesTokenCount: 50, thoughtsTokenCount: 30 }, modelVersion: 'gemini-3.5-flash-lite',
    }, 'x');
    expect(msg.content).toEqual([{ type: 'text', text: 'Answer.', citations: null }]);
    expect(msg.stop_reason).toBe('max_tokens');
    expect(msg.usage).toMatchObject({ input_tokens: 1000, output_tokens: 80, cache_read_input_tokens: 200 });
    expect(msg.model).toBe('gemini-3.5-flash-lite');
    expect(fromGeminiResponse({ candidates: [{ content: { parts: [] }, finishReason: 'SAFETY' }] }, 'x').stop_reason).toBe('refusal');
  });
});

describe('gemini call', () => {
  const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  it('maps the Claude tier to the comparable Gemini model, sends the key in a header, retries once on 429', async () => {
    const urls: string[] = [];
    const keys: string[] = [];
    let n = 0;
    const call = geminiCall({ apiKey: 'test-key', fetchFn: (async (url: string, init: RequestInit) => {
      urls.push(url); keys.push((init.headers as Record<string, string>)['x-goog-api-key']);
      return n++ === 0 ? ok({ error: { message: 'slow down' } }, 429) : ok({ candidates: [{ content: { parts: [{ text: 'Hello.' }] }, finishReason: 'STOP' }] });
    }) as typeof fetch });
    const msg = await call({ model: 'claude-haiku-4-5', max_tokens: 100, messages: [{ role: 'user', content: 'hi' }] });
    expect(urls[0]).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent');
    expect(keys).toEqual(['test-key', 'test-key']);
    expect(urls).toHaveLength(2);
    expect(msg.content).toEqual([{ type: 'text', text: 'Hello.', citations: null }]);
  });

  it('errors become GeminiError (the concierge then sends its honest fallback)', async () => {
    const call = geminiCall({ apiKey: 'k', fetchFn: (async () => ok({ error: { message: 'API key not valid' } }, 400)) as unknown as typeof fetch });
    await expect(call({ model: 'claude-sonnet-5-5', max_tokens: 10, messages: [{ role: 'user', content: 'q' }] })).rejects.toBeInstanceOf(GeminiError);
  });

  it('Insights runs end to end on Gemini: tool call, tool result, grounded answer passing the honesty check', async () => {
    const sc = scenario('feb2024')!;
    const s = sim(50, { startIso: sc.startIso, capacityMMcfd: sc.capacityMMcfd });
    const world: World = {
      sim: () => s, household: () => home({ targetF: 65, taF: 65.4 }), weather: () => [], aggregates: () => [],
      planTargetF: (_c, h) => (h >= 50 && h < 74 ? 65 : undefined), dispatchedPlan: () => undefined,
    };
    const bodies: any[] = [];
    let n = 0;
    const call = geminiCall({ apiKey: 'k', fetchFn: (async (url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      expect(url).toContain('gemini-3.8-flash');
      return n++ === 0
        ? ok({ candidates: [{ content: { parts: [{ thoughtSignature: 's', functionCall: { id: 'f1', name: 'explain_decision', args: { hour: 50 } } }] }, finishReason: 'STOP' }] })
        : ok({ candidates: [{ content: { parts: [{ text: 'At Fri Feb 2 02:00 the simulated plan holds your home at 65°F, never below 62°F.' }] }, finishReason: 'STOP' }] });
    }) as typeof fetch });
    const r = await ask({ question: 'why now?', ctx: { world, consts, identity: IDENTITY }, call });
    expect(r.toolCalls.map(t => t.name)).toEqual(['explain_decision']);
    expect(r.honesty.ok).toBe(true);
    expect(bodies[1].contents[2].parts[0].functionResponse.name).toBe('explain_decision');
    expect(bodies[1].contents[1].parts[0].thoughtSignature).toBe('s');
  });
});
