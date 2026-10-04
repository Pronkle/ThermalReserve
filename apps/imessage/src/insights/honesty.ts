// Honesty guard (CHAT brief §7.3): every number in a draft answer must appear, at the precision the
// draft uses, in a tool output from this turn (or in the person's own question). Unit-tested.

export interface NumberToken { text: string; value: number; decimals: number; isTime: boolean; }

// Numbers as written in prose: 1,234.5 | 0.9 | 66 | 7% | 06:00 | −2.5 (unicode minus).
const NUMBER = /(?<![\w.])[-−]?\d{1,3}(?:,\d{3})+(?:\.\d+)?|(?<![\w.:])[-−]?\d+(?:\.\d+)?(?::\d{2})?/g;

export function extractNumbers(text: string): NumberToken[] {
  const out: NumberToken[] = [];
  for (const m of text.matchAll(NUMBER)) {
    const raw = m[0];
    if (/^\d{1,2}:\d{2}$/.test(raw)) {
      out.push({ text: raw, value: NaN, decimals: 0, isTime: true });
      continue;
    }
    const clean = raw.replace(/,/g, '').replace('−', '-');
    const decimals = clean.includes('.') ? clean.split('.')[1].length : 0;
    out.push({ text: raw, value: Number(clean), decimals, isTime: false });
  }
  return out;
}

// Every number found in a tool output: numeric JSON values plus numbers written inside strings.
export function collectEvidence(outputs: unknown[]): { values: number[]; times: Set<string> } {
  const values: number[] = [];
  const times = new Set<string>();
  const visit = (x: unknown) => {
    if (typeof x === 'number' && Number.isFinite(x)) values.push(x);
    else if (typeof x === 'string') {
      for (const t of extractNumbers(x)) (t.isTime ? times.add(t.text.padStart(5, '0')) : values.push(t.value));
    } else if (Array.isArray(x)) x.forEach(visit);
    else if (x && typeof x === 'object') Object.values(x).forEach(visit);
  };
  outputs.forEach(visit);
  return { values, times };
}

// A written number matches evidence when the evidence rounds to it at the written precision
// (66 matches 65.6 and 66.04; 0.56 matches 0.5612; 7% matches 7.04).
function matches(token: NumberToken, values: number[]): boolean {
  const tol = 0.5 * 10 ** -token.decimals + 1e-9;
  return values.some(v => Math.abs(v - token.value) <= tol);
}

export interface HonestyResult { ok: boolean; unsupported: string[]; }

// Small counting words written as digits ("1 more", "2 texts") aren't data claims; allow 0–3
// only when they have no decimal point, unit or percent sign right after them.
const COUNTING = /^[0-3]$/;

export function checkHonesty(draft: string, outputs: unknown[], extraText = ''): HonestyResult {
  const { values, times } = collectEvidence([...outputs, extraText]);
  const unsupported: string[] = [];
  const text = draft;
  for (const token of extractNumbers(text)) {
    if (token.isTime) {
      if (!times.has(token.text.padStart(5, '0'))) unsupported.push(token.text);
      continue;
    }
    const at = text.indexOf(token.text);
    const after = text.slice(at + token.text.length, at + token.text.length + 3);
    if (COUNTING.test(token.text) && !/^\s*(°|%|MMcf|cf|cubic|Mcf|\$)/i.test(after)) continue;
    if (!matches(token, values)) unsupported.push(token.text);
  }
  return { ok: unsupported.length === 0, unsupported: [...new Set(unsupported)] };
}
