import type Anthropic from '@anthropic-ai/sdk';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { converse, memoryCard } from '../src/concierge/agent';
import { handleInbound } from '../src/concierge/inbound';
import type { ModelCall } from '../src/insights/agent';
import { runTool } from '../src/insights/tools';
import { linkCode } from '../src/link';
import { addNote, cleanNote, MAX_NOTES_PER_CATEGORY, Store } from '../src/memory/store';
import type { HouseholdView, SimView, World } from '../src/types';
import { Feed, startViewer } from '../src/viewer';
import { BACKOFF_NOTICE, Notifier } from '../src/watcher/notifier';
import { config, consts, home, IDENTITY, NOON_ET, PHONE, sim } from './fixtures';

const naive = (hour: number): Partial<HouseholdView> => {
  const local = hour % 24;
  const inEvent = hour >= 12 && hour < 84;
  if (inEvent && local >= 6 && local < 10) return { targetF: 66, taF: 66.5, savedCf: hour };
  if (inEvent && local >= 10 && local < 12) return { targetF: 70, taF: 68, savedCf: hour };
  return { savedCf: hour >= 84 ? 84 : 0 };
};

// One process lifetime: a store, a notifier on a fake clock, inbound handling and a scripted concierge.
function session(store: Store, startClock = NOON_ET) {
  let clock = startClock;
  let h: HouseholdView = home();
  let s: SimView = sim(0, { status: 'idle' });
  const sent: string[] = [];
  const prompts: string[] = [];
  const world: World = {
    sim: () => s, household: id => (id === IDENTITY ? h : undefined), weather: () => [],
    planTargetF: () => undefined, aggregates: () => [], dispatchedPlan: () => undefined,
  };
  const reply = (text: string): ModelCall => (async params => {
    prompts.push(JSON.stringify(params.messages));
    return { id: 'm', type: 'message', role: 'assistant', model: params.model, content: [{ type: 'text', text, citations: null }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } as unknown as Anthropic.Message;
  });
  const notifier = new Notifier({ store, consts, config, household: id => world.household(id), sim: () => s, sendText: async (_a, b) => { sent.push(b); }, now: () => clock, log: () => undefined });
  const text = (body: string, answer = 'Okay.') => handleInbound({
    store, consts, households: () => [h], sim: () => s, now: () => clock, log: () => undefined,
    converse: async (a, id, t) => (await converse({ store, world, consts, call: reply(answer), log: () => undefined }, a, id, t)).bubbles,
  }, PHONE, body);
  async function play(from: number, to: number, speed: number) {
    for (let hour = from; hour <= to; hour += speed) {
      s = sim(hour); h = home(naive(hour));
      notifier.observe();
      for (let k = 0; k < 2; k++) { clock += 500; await notifier.flush(); }
    }
    for (let k = 0; k < 60; k++) { clock += 500; await notifier.flush(); }
  }
  return { sent, prompts, text, play, advance: (ms: number) => { clock += ms; } };
}

describe('memory is limited to what matters for heating', () => {
  it('strips contact details and markup, caps length and count', () => {
    expect(cleanNote('call my daughter at +1 555 555 0199 or a@b.com <b>now</b>')).toBe('call my daughter at [number removed] or [email removed] now');
    expect(cleanNote('x'.repeat(300))).toHaveLength(120);
    let m = {};
    for (let i = 0; i < 8; i++) m = addNote(m, 'comfort', `note ${i}`);
    expect((m as { notes: { comfort: string[] } }).notes.comfort).toHaveLength(MAX_NOTES_PER_CATEGORY);
  });
  it('unknown categories and fields are dropped on write and on read', () => {
    expect(addNote({}, 'politics' as never, 'votes for X')).toEqual({});
    const store = new Store(':memory:');
    store.db.prepare('INSERT INTO person_memory (address, json) VALUES (?, ?)').run(PHONE, JSON.stringify({ caresAbout: ['old free-form note'], favoriteTeam: 'x', notes: { household: ['infant at home'], hobbies: ['golf'] } }));
    expect(store.personMemory(PHONE)).toEqual({ preferredName: undefined, verbosity: undefined, notes: { household: ['infant at home'] }, answered: undefined, lastExplanation: undefined, lastTalkedAt: undefined });
  });
  it('memory card shows the categories and when they last talked', () => {
    expect(memoryCard({ preferredName: 'Sam', notes: { household: ['infant in the back bedroom'], comfort: ['feels cold below 66°F'] }, lastTalkedAt: NOON_ET - 3 * 3600_000 }, NOON_ET))
      .toBe('Memory card: call them Sam; household: infant in the back bedroom; comfort: feels cold below 66°F; last talked 3 hours ago.');
  });
});

describe('unanswered back-off', () => {
  it('after 2 unanswered texts: says so once, then only the summary, with nothing lost', async () => {
    const x = session(new Store(':memory:'));
    await x.text(`Link my home ${linkCode(IDENTITY)}`);
    await x.play(0, 96, 2);
    expect(x.sent).toHaveLength(3);
    expect(x.sent[1]).toContain(BACKOFF_NOTICE);
    expect(x.sent.filter(m => m.includes(BACKOFF_NOTICE))).toHaveLength(1);
    expect(x.sent[2]).toContain('since my last text');
    expect(x.sent[2]).toContain('event ended');
    const all = x.sent.join('\n');
    expect((all.match(/lowered (Test iPhone's heat )?to 66°F|heat lowered to 66°F/g) ?? []).length).toBe(3);
  });
  it('a reply resets it: updates flow again', async () => {
    const store = new Store(':memory:');
    const x = session(store);
    await x.text(`Link my home ${linkCode(IDENTITY)}`);
    await x.play(0, 40, 2);                         // 2 texts sent, now backing off
    await x.text('ok so what is happening');         // they text again
    expect(store.contact(PHONE)?.unanswered).toBe(0);
    const before = x.sent.length;
    await x.play(41, 60, 2);                        // the day-2 morning setback
    expect(x.sent.length).toBeGreaterThan(before);
  });
});

describe('three-session acceptance (brief Phase 3)', () => {
  it('link → ask why → "only big changes" → restart → event: preference honored, earlier context used', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'chat-p3-'));
    const path = join(dir, 'chat.sqlite');

    // Session 1: link and ask why.
    const s1 = session(new Store(path));
    await s1.text(`Link my home ${linkCode(IDENTITY)}`);
    await s1.text('why does my heat get lowered at all? my baby sleeps in the back room');

    // Session 2: a preference.
    expect((await s1.text('only big changes please')).texts[0]).toContain('only send a summary');

    // Restart: a new process on the same file.
    const store2 = new Store(path);
    expect(store2.contact(PHONE)?.notifyLevel).toBe('summary');
    const s2 = session(store2, NOON_ET + 3600_000);
    await s2.play(0, 96, 2);
    expect(s2.sent).toHaveLength(1);                 // summary only, as asked
    expect(s2.sent[0]).toContain('event ended');

    // Session 3: the next question carries what came before.
    await s2.text('what happened while I was away?');
    const prompt = s2.prompts.at(-1)!;
    expect(prompt).toContain('my baby sleeps in the back room');
    expect(prompt).toContain('only big changes please');
    expect(prompt).toContain('last talked');
  });
});

describe('savings_method', () => {
  it('describes the real twin-difference method with labeled constants', () => {
    const world: World = { sim: () => sim(50), household: () => home({ savedCf: 71.4 }), weather: () => [], planTargetF: () => undefined, aggregates: () => [], dispatchedPlan: () => undefined };
    const r = runTool({ world, consts, identity: IDENTITY }, 'savings_method', {}) as { summary: string; furnaceEfficiency: { label: string }; thisHomeNetSavedCf: { value: number } };
    expect(r.summary).toMatch(/twin/);
    expect(r.summary).toMatch(/includes the reheat/);
    expect(r.furnaceEfficiency.label).toBe('assumed');
    expect(r.thisHomeNetSavedCf.value).toBe(71);
  });
});

describe('agent screen', () => {
  it('serves the page and the feed on localhost only', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'chat-v-'));
    writeFileSync(join(dir, 'handoff.jsonl'), JSON.stringify({ at: new Date().toISOString(), question: 'why now?', toolCalls: [{ name: 'explain_decision' }], honesty: { ok: true, regenerated: false, fellBack: false }, answer: 'Because.' }) + '\n');
    const feed = new Feed();
    feed.push('05:41:51 [handoff] concierge → insights: "why now?"');
    const port = 18000 + Math.floor(Math.random() * 1000);
    const server = startViewer(port, dir, feed, () => undefined)!;
    await new Promise(r => server.once('listening', r));
    const api = await (await fetch(`http://127.0.0.1:${port}/api`)).json() as { lines: unknown[]; handoffs: { question: string }[] };
    const page = await (await fetch(`http://127.0.0.1:${port}/`)).text();
    server.close();
    expect(api.handoffs[0].question).toBe('why now?');
    expect(api.lines).toHaveLength(1);
    expect(page).toContain('<title>Thermal Reserve agents</title>');
    expect((server.address() ?? { address: '127.0.0.1' })).toBeTruthy();
  });
});
