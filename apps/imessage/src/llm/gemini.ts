// Gemini backend (H3, Oct 4): runs the same concierge and Insights loops on Google's Gemini API.
// It implements the agents' ModelCall interface by translating Anthropic-shaped requests and
// responses to Gemini's generateContent REST API, so the agents, tools and honesty guard are
// unchanged. Plain fetch, no new package. Docs: ai.google.dev/api/generate-content.
import type Anthropic from '@anthropic-ai/sdk';
import type { ModelCall } from '../insights/agent';

// Comparable tiers (ai.google.dev/gemini-api/docs/models, Oct 4 2026; stable models only):
// the concierge's fast chat tier and Insights' stronger agentic tier.
export const GEMINI_MODELS: Record<string, string> = {
  'claude-haiku-4-5': 'gemini-3.5-flash-lite',
  'claude-sonnet-5-5': 'gemini-3.8-flash',
};

type Part = {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  functionCall?: { id?: string; name: string; args?: Record<string, unknown> };
  functionResponse?: { id?: string; name: string; response: Record<string, unknown> };
};
type Content = { role: 'user' | 'model'; parts: Part[] };

interface GeminiResponse {
  candidates?: { content?: { parts?: Part[] }; finishReason?: string }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number; cachedContentTokenCount?: number };
  modelVersion?: string;
  error?: { code?: number; message?: string; status?: string };
}

// Gemini returns thought signatures that must go back unchanged in later turns. Our loops push
// the response's content array back as the assistant turn, so the original parts ride on it.
const RAW = Symbol('geminiParts');
const LOCAL_ID = 'local-call-';
type WithRaw = Anthropic.ContentBlock[] & { [RAW]?: Part[] };

// Gemini's function schemas are an OpenAPI subset: drop JSON Schema keywords it rejects.
export function toGeminiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema)) {
    if (k === 'additionalProperties' || k === '$schema') continue;
    out[k] = toGeminiSchema(v);
  }
  return out;
}

function textOf(content: string | Anthropic.TextBlockParam[] | Anthropic.ToolResultBlockParam['content']): string {
  if (typeof content === 'string') return content;
  if (!content) return '';
  return content.map(c => ('text' in c ? c.text : '')).join('\n');
}

export function toGeminiRequest(params: Anthropic.MessageCreateParamsNonStreaming) {
  const names = new Map<string, string>(); // tool_use id → tool name, for functionResponse
  const contents: Content[] = [];
  for (const m of params.messages) {
    if (typeof m.content === 'string') {
      contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] });
      continue;
    }
    if (m.role === 'assistant') {
      const raw = (m.content as WithRaw)[RAW];
      for (const b of m.content) if (b.type === 'tool_use') names.set(b.id, b.name);
      if (raw) { contents.push({ role: 'model', parts: raw }); continue; }
      const parts: Part[] = [];
      for (const b of m.content) {
        if (b.type === 'text' && b.text) parts.push({ text: b.text });
        else if (b.type === 'tool_use') parts.push({ functionCall: { ...(b.id.startsWith(LOCAL_ID) ? {} : { id: b.id }), name: b.name, args: (b.input ?? {}) as Record<string, unknown> } });
      }
      if (parts.length) contents.push({ role: 'model', parts });
      continue;
    }
    const parts: Part[] = [];
    for (const b of m.content) {
      if (b.type === 'text') parts.push({ text: b.text });
      else if (b.type === 'tool_result') {
        const output = textOf(b.content);
        const id = b.tool_use_id.startsWith(LOCAL_ID) ? {} : { id: b.tool_use_id };
        parts.push({ functionResponse: { ...id, name: names.get(b.tool_use_id) ?? 'tool', response: b.is_error ? { error: output } : { result: output } } });
      }
    }
    if (parts.length) contents.push({ role: 'user', parts });
  }

  const system = typeof params.system === 'string' ? params.system : (params.system ?? []).map(s => s.text).join('\n\n');
  const tools = (params.tools ?? []).filter((t): t is Anthropic.Tool => 'input_schema' in t);
  const declarations = tools.map(t => {
    const schema = toGeminiSchema(t.input_schema) as { properties?: Record<string, unknown> };
    return { name: t.name, description: t.description ?? '', ...(schema.properties && Object.keys(schema.properties).length ? { parameters: schema } : {}) };
  });
  const effort = (params as { output_config?: { effort?: string } }).output_config?.effort;
  return {
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    contents,
    ...(declarations.length ? { tools: [{ functionDeclarations: declarations }] } : {}),
    ...(declarations.length ? { toolConfig: { functionCallingConfig: { mode: params.tool_choice?.type === 'none' ? 'NONE' : 'AUTO' } } } : {}),
    generationConfig: {
      maxOutputTokens: params.max_tokens,
      thinkingConfig: { thinkingLevel: effort === 'high' ? 'high' : 'low' },
    },
  };
}

export function fromGeminiResponse(res: GeminiResponse, model: string): Anthropic.Message {
  const cand = res.candidates?.[0];
  const parts = cand?.content?.parts ?? [];
  const content: WithRaw = [];
  let n = 0;
  for (const p of parts) {
    if (p.thought) continue;
    if (p.functionCall) {
      // Gemini may omit ids; ours are local only and never sent back (see functionResponse).
      const id = p.functionCall.id ?? `${LOCAL_ID}${Date.now().toString(36)}-${n++}`;
      content.push({ type: 'tool_use', id, name: p.functionCall.name, input: p.functionCall.args ?? {} } as Anthropic.ToolUseBlock);
    } else if (p.text) {
      content.push({ type: 'text', text: p.text, citations: null } as Anthropic.TextBlock);
    }
  }
  Object.defineProperty(content, RAW, { value: parts, enumerable: false });
  const finish = cand?.finishReason;
  const stop_reason = content.some(b => b.type === 'tool_use') ? 'tool_use'
    : finish === 'MAX_TOKENS' ? 'max_tokens'
    : finish === 'SAFETY' || finish === 'RECITATION' || finish === 'PROHIBITED_CONTENT' ? 'refusal'
    : 'end_turn';
  const u = res.usageMetadata ?? {};
  return {
    id: `gemini-${Date.now().toString(36)}`, type: 'message', role: 'assistant', model: res.modelVersion ?? model,
    content, stop_reason, stop_sequence: null,
    usage: {
      input_tokens: (u.promptTokenCount ?? 0) - (u.cachedContentTokenCount ?? 0),
      output_tokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0),
      cache_read_input_tokens: u.cachedContentTokenCount ?? 0,
      cache_creation_input_tokens: 0,
    },
  } as unknown as Anthropic.Message;
}

export class GeminiError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export function geminiCall(opts: { apiKey: string; timeoutMs?: number; models?: Record<string, string>; fetchFn?: typeof fetch }): ModelCall {
  const models = { ...GEMINI_MODELS, ...opts.models };
  const doFetch = opts.fetchFn ?? fetch;
  return async params => {
    const model = models[params.model] ?? params.model;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    for (let attempt = 0; ; attempt++) {
      const res = await doFetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': opts.apiKey },
        body: JSON.stringify(toGeminiRequest(params)),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
      });
      const body = await res.json().catch(() => ({})) as GeminiResponse;
      // One retry for rate limits and server errors, like the Anthropic client's maxRetries: 1.
      if ((res.status === 429 || res.status >= 500) && attempt === 0) { await new Promise(r => setTimeout(r, 1000)); continue; }
      if (!res.ok || body.error) throw new GeminiError(res.status, `Gemini ${res.status}: ${(body.error?.message ?? res.statusText).slice(0, 200)}`);
      return fromGeminiResponse(body, model);
    }
  };
}
