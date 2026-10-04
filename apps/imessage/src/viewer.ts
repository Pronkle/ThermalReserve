// Local demo screen (CHAT brief §8 Phase 3): shows the two agents at work while someone texts.
// Serves one page on 127.0.0.1 only. Log lines are already masked; handoffs hold no numbers.
import { existsSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';

export class Feed {
  private readonly lines: { at: string; line: string }[] = [];
  push(line: string) {
    this.lines.push({ at: new Date().toISOString(), line });
    if (this.lines.length > 300) this.lines.splice(0, this.lines.length - 300);
  }
  recent() { return this.lines.slice(-150); }
}

function recentHandoffs(dataDir: string) {
  const file = join(dataDir, 'handoff.jsonl');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').trim().split('\n').slice(-12).reverse().map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Thermal Reserve agents</title><style>
:root{--bg:#0B1220;--surface:#111A2E;--text:#E6EDF7;--muted:#9AA8BF;--blue:#5BC0EB;--amber:#F2A541;--green:#30A46C;--red:#E5484D;--line:#22304d}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 Inter,system-ui,sans-serif}
header{padding:16px 24px;border-bottom:1px solid var(--line)}h1{margin:0;font-size:18px}header p{margin:4px 0 0;color:var(--muted)}
main{display:grid;grid-template-columns:3fr 2fr;gap:16px;padding:16px 24px}@media(max-width:900px){main{grid-template-columns:1fr}}
section{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:16px;min-width:0}h2{margin:0 0 12px;font-size:14px;color:var(--muted);font-weight:600}
.h{border-left:3px solid var(--blue);padding:8px 12px;margin:0 0 12px;background:#0e1628;border-radius:8px}
.flow{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:4px 0}.chip{border:1px solid var(--line);border-radius:999px;padding:2px 8px;font-size:12px}
.c{color:var(--amber)}.i{color:var(--blue)}.t{color:var(--muted)}.ok{color:var(--green);border-color:var(--green)}.bad{color:var(--red);border-color:var(--red)}
.q{font-weight:600}.a{color:var(--muted);margin-top:6px}
pre{margin:0;white-space:pre-wrap;word-break:break-word;font:12px/1.5 ui-monospace,monospace;color:var(--muted);max-height:70vh;overflow:auto}
.ln-handoff{color:var(--blue)}.ln-send{color:var(--text)}.ln-hold{color:var(--amber)}.ln-honesty{color:var(--red)}.ln-usage{color:#6f7d96}
</style></head><body><header><h1>Thermal Reserve iMessage companion</h1><p>The concierge agent hands data questions to the Insights agent, which answers only from tool results. Simulation only.</p></header>
<main><section><h2>Handoffs, newest first</h2><div id="h"></div></section><section><h2>Live log</h2><pre id="log"></pre></section></main>
<script>
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
async function tick(){try{const r=await fetch('api');const d=await r.json();
document.getElementById('h').innerHTML=d.handoffs.map(h=>{const ok=h.honesty&&!h.honesty.fellBack;const tools=(h.toolCalls||[]).map(t=>'<span class="chip t">'+esc(t.name)+'</span>').join('');
return '<div class="h"><div class="flow"><span class="chip c">concierge</span>→<span class="chip i">insights</span>→'+(tools||'<span class="chip t">no tools</span>')+'→<span class="chip '+(ok?'ok':'bad')+'">honesty '+(ok?(h.honesty.regenerated?'pass after rewrite':'pass'):'fell back')+'</span><span class="t">'+esc(new Date(h.at).toLocaleTimeString())+'</span></div><div class="q">'+esc(h.question)+'</div><div class="a">'+esc(h.answer)+'</div></div>'}).join('')||'<p class="t">No questions yet.</p>';
const log=document.getElementById('log');const atEnd=log.scrollTop+log.clientHeight>=log.scrollHeight-8;
log.innerHTML=d.lines.map(l=>{const k=(l.line.match(/\\[(\\w+)\\]/)||[])[1]||'';return '<span class="ln-'+esc(k)+'">'+esc(l.line)+'</span>'}).join('\\n');if(atEnd)log.scrollTop=log.scrollHeight;}catch(e){}}
tick();setInterval(tick,1000);
</script></body></html>`;

export function startViewer(port: number, dataDir: string, feed: Feed, log: (line: string) => void): Server | undefined {
  if (!port) return undefined;
  const server = createServer((req, res) => {
    if (req.url === '/api') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ lines: feed.recent(), handoffs: recentHandoffs(dataDir) }));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(PAGE);
  });
  server.on('error', e => log(`[viewer] not started: ${String(e)}`));
  server.listen(port, '127.0.0.1', () => log(`[viewer] agent screen at http://127.0.0.1:${port}/`));
  return server;
}
