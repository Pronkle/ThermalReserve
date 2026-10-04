// One small call per model through the adapter: plain text on the concierge tier, a tool call on
// the Insights tier. Run: node --env-file=.env --import tsx spike/gemini-check.ts
import { geminiCall } from '../src/llm/gemini';
const call = geminiCall({ apiKey: process.env.GEMINI_API_KEY!, timeoutMs: 30_000 });
const a = await call({ model: 'claude-haiku-4-5', max_tokens: 200, system: 'Reply in one short professional sentence.', messages: [{ role: 'user', content: 'Say hello to a household in a heating demo.' }] });
console.log('concierge tier:', a.model, '|', a.stop_reason, '|', JSON.stringify(a.content.map(b => b.type === 'text' ? b.text : b.type)), '| usage', JSON.stringify(a.usage));
const b = await call({ model: 'claude-sonnet-5-5', max_tokens: 1024, output_config: { effort: 'low' },
  tools: [{ name: 'household_now', description: 'Current indoor temperature of the home.', input_schema: { type: 'object', properties: {}, additionalProperties: false } }],
  messages: [{ role: 'user', content: 'What is the indoor temperature right now? Use the tool.' }] } as never);
console.log('insights tier:', b.model, '|', b.stop_reason, '|', JSON.stringify(b.content));
// Round trip: send the tool result back (call id + thought signature must be accepted).
if (b.stop_reason === 'tool_use') {
  const use = b.content.find(x => x.type === 'tool_use')!;
  const c = await call({ model: 'claude-sonnet-5-5', max_tokens: 1024, output_config: { effort: 'low' },
    tools: [{ name: 'household_now', description: 'Current indoor temperature of the home.', input_schema: { type: 'object', properties: {}, additionalProperties: false } }],
    messages: [
      { role: 'user', content: 'What is the indoor temperature right now? Use the tool.' },
      { role: 'assistant', content: b.content },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: (use as { id: string }).id, content: '{"indoorF":{"value":65.4,"unit":"°F"}}' }] },
    ] } as never);
  console.log('round trip:', c.stop_reason, '|', JSON.stringify(c.content.map(x => x.type === 'text' ? x.text : x.type)));
}
