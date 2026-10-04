import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { handleInbound } from '../src/concierge/inbound';
import { Store } from '../src/memory/store';
import { inQuietHours, Notifier } from '../src/watcher/notifier';
import type { HouseholdView, SimView } from '../src/types';
import { config, consts, home, IDENTITY, NOON_ET, PHONE, sim } from './fixtures';

// A simulated run: a mutable household + sim, a fake clock, and a fake transport that records sends.
function harness(opts: { store?: Store; failSends?: boolean; cfg?: Partial<typeof config>; isBusy?: (a: string) => boolean } = {}) {
  const store = opts.store ?? new Store(':memory:');
  let clock = NOON_ET;
  let h: HouseholdView = home();
  let s: SimView = sim(0, { status: 'idle' });
  const sent: { at: number; body: string }[] = [];
  const notifier = new Notifier({
    store, consts, config: { ...config, ...opts.cfg },
    household: id => (id === h.identity ? h : undefined),
    sim: () => s,
    sendText: async (_address, body) => {
      if (opts.failSends) throw new Error('network down');
      sent.push({ at: clock, body });
    },
    isBusy: opts.isBusy,
    now: () => clock,
    log: () => undefined,
  });
  const linkNow = () => handleInbound({ store, consts, households: () => [h], sim: () => s, now: () => clock, log: () => undefined, optedInHousehold: (a: string) => (a === PHONE ? IDENTITY : undefined) }, PHONE, 'START');
  // One real second per tick at `speed` sim hours per second, flushing every 0.5 s like the app.
  async function play(fromHour: number, toHour: number, speed: number, shape: (hour: number) => Partial<HouseholdView>) {
    for (let hour = fromHour; hour <= toHour; hour += speed) {
      s = sim(hour);
      h = home(shape(hour));
      notifier.observe();
      for (let k = 0; k < 2; k++) { clock += 500; await notifier.flush(); }
    }
  }
  return { store, notifier, sent, linkNow, play, advance: (ms: number) => { clock += ms; }, setSim: (x: SimView) => { s = x; } };
}

// NAIVE-like shape: a 4 h morning setback each event day, recovering after.
const naive = (hour: number): Partial<HouseholdView> => {
  const local = hour % 24;
  const inEvent = hour >= 12 && hour < 84;
  if (inEvent && local >= 6 && local < 10) return { targetF: 66, taF: 66.5, savedCf: hour };
  if (inEvent && local >= 10 && local < 12) return { targetF: 70, taF: 68, savedCf: hour };
  return { savedCf: hour >= 84 ? 84 : 0 };
};

describe('notifier', () => {
  it('a whole run at 2 h/s: 3–6 messages, ≥ 20 s apart, every transition in exactly one message', async () => {
    const x = harness();
    expect((await x.linkNow()).texts[0]).toContain("You're set for Test iPhone");
    await x.play(0, 96, 2, naive);
    for (let k = 0; k < 60; k++) { x.advance(500); await x.notifier.flush(); } // drain after the run
    expect(x.sent.length).toBeGreaterThanOrEqual(3);
    expect(x.sent.length).toBeLessThanOrEqual(6);
    for (let i = 1; i < x.sent.length; i++) expect(x.sent[i].at - x.sent[i - 1].at).toBeGreaterThanOrEqual(20_000);
    const all = x.sent.map(m => m.body).join('\n');
    // 3 setbacks + 3 recoveries + end = 7 transitions; each appears once (single or bullet form).
    expect((all.match(/lowered (Test iPhone's heat )?to 66°F|heat lowered to 66°F/g) ?? []).length).toBe(3);
    expect((all.match(/raised back|coming back up/g) ?? []).length).toBe(3);
    expect((all.match(/event (is over|ended)/g) ?? []).length).toBe(1);
    expect(x.store.pending(PHONE)).toEqual([]);
    expect(all).not.toContain('!');
  });

  it('restart mid-run sends no duplicates', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'chat-'));
    const path = join(dir, 'chat.sqlite');
    const a = harness({ store: new Store(path) });
    await a.linkNow();
    await a.play(0, 40, 2, naive);
    const before = a.sent.map(m => m.body);
    a.store.close();
    // Process restarts with the same database file and resumes watching at the same hour.
    const b = harness({ store: new Store(path) });
    b.store.settleInterruptedSends(NOON_ET);
    b.advance(60_000);
    await b.play(40, 96, 2, naive);
    for (let k = 0; k < 60; k++) { b.advance(500); await b.notifier.flush(); }
    const after = b.sent.map(m => m.body);
    const transitionsSeen = [...before, ...after].join('\n');
    expect((transitionsSeen.match(/lowered (Test iPhone's heat )?to 66°F|heat lowered to 66°F/g) ?? []).length).toBe(3);
    expect((transitionsSeen.match(/event (is over|ended)/g) ?? []).length).toBe(1);
  });

  it('a send interrupted by a crash is never re-sent', () => {
    const store = new Store(':memory:');
    store.link(PHONE, IDENTITY, 'Test iPhone', { runKey: 'r', lastSimHour: 0, mode: 'normal', overridden: false, notifiedTargetF: 70, exemptNotified: false, endNotified: false }, 0);
    store.recordTransitions(PHONE, { runKey: 'r', lastSimHour: 12, mode: 'holding', overridden: false, notifiedTargetF: 66, exemptNotified: false, endNotified: false },
      [{ id: 't1', kind: 'setback_start', simHour: 12, targetF: 66, taF: 68, savedCf: 0 }], 0);
    expect(store.beginSend({ id: 'm1', address: PHONE, body: 'x', transitionIds: ['t1'] }, 1)).toBe(true);
    // crash here; on restart:
    expect(store.settleInterruptedSends(2)).toEqual(['m1']);
    expect(store.pending(PHONE)).toEqual([]);
    expect(store.beginSend({ id: 'm1', address: PHONE, body: 'x', transitionIds: ['t1'] }, 3)).toBe(false);
  });

  it('a failed send keeps the queue and retries after the throttle window', async () => {
    const store = new Store(':memory:');
    const x = harness({ store, failSends: true });
    await x.linkNow();
    await x.play(28, 32, 2, naive);
    expect(store.pending(PHONE).map(p => p.transition.kind)).toEqual(['setback_start']);
    expect(x.sent).toEqual([]);
    // The network comes back: a fresh notifier on the same store delivers it once the window opens.
    const y = harness({ store });
    y.advance(1000);
    await y.notifier.flush();
    expect(y.sent).toEqual([]);           // still inside the window after the failure
    y.advance(25_000);
    await y.notifier.flush();
    expect(y.sent).toHaveLength(1);
    expect(store.pending(PHONE)).toEqual([]);
  });

  it('updates wait while a reply is being drafted, then go out as one catch-up', async () => {
    let busy = true;
    const x = harness({ isBusy: () => busy });
    await x.linkNow();
    await x.play(28, 36, 2, naive);       // setback at 30, recovery at 34, all while "replying"
    expect(x.sent).toEqual([]);
    busy = false;
    x.advance(1000);
    await x.notifier.flush();
    expect(x.sent).toHaveLength(1);
    expect(x.sent[0].body).toContain('since my last text');
  });

  it('quiet hours hold messages unless demo mode or "text me anytime"', async () => {
    const night = Date.parse('2026-10-04T23:30:00-04:00');
    expect(inQuietHours(night, config)).toBe(true);
    expect(inQuietHours(NOON_ET, config)).toBe(false);
    expect(inQuietHours(Date.parse('2026-10-04T08:00:00-04:00'), config)).toBe(false);
  });

  it('summary-only preference sends just the end-of-event summary, with the catch-up list', async () => {
    const x = harness();
    await x.linkNow();
    x.store.setPreference(PHONE, { notifyLevel: 'summary' });
    await x.play(0, 96, 2, naive);
    for (let k = 0; k < 60; k++) { x.advance(500); await x.notifier.flush(); }
    expect(x.sent.length).toBe(1);
    expect(x.sent[0].body).toContain('since my last text');
    expect(x.sent[0].body).toContain('event ended');
  });
});

describe('inbound', () => {
  const deps = (store: Store, households = [home()]) => ({ store, consts, households: () => households, sim: () => sim(0, { status: 'idle' }), now: () => NOON_ET, log: () => undefined, optedInHousehold: (a: string) => (a === PHONE ? IDENTITY : undefined) });

  it('START from the number that opted in on /home links it, confirms with the nickname, and offers STOP', async () => {
    const store = new Store(':memory:');
    const r = await handleInbound(deps(store), PHONE, 'START');
    expect(r.texts[0]).toMatch(/^Thank you. You're set for Test iPhone.*STOP/);
    expect(store.contact(PHONE)?.identity).toBe(IDENTITY);
    expect((await handleInbound(deps(store), PHONE, 'start')).texts[0]).toMatch(/^You're already set/);
  });

  it('a number that did not opt in on /home is told how to join; nothing stored', async () => {
    const store = new Store(':memory:');
    const r = await handleInbound(deps(store), '+15555550999', 'START');
    expect(r.texts[0]).toMatch(/household page.*START/);
    expect(store.contact('+15555550999')).toBeUndefined();
  });

  it('STOP deletes everything for the number and confirms once', async () => {
    const store = new Store(':memory:');
    await handleInbound(deps(store), PHONE, 'START');
    const r = await handleInbound(deps(store), PHONE, 'STOP');
    expect(r.texts).toHaveLength(1);
    expect(store.contact(PHONE)).toBeUndefined();
    expect(store.history(PHONE)).toEqual([]);
  });

  it('thanks gets a tapback and no text', async () => {
    const store = new Store(':memory:');
    await handleInbound(deps(store), PHONE, 'START');
    expect(await handleInbound(deps(store), PHONE, 'thanks')).toEqual({ react: 'like', texts: [] });
    expect(await handleInbound(deps(store), PHONE, '👍')).toEqual({ react: 'like', texts: [] });
  });

  it('preferences are saved and confirmed in one line', async () => {
    const store = new Store(':memory:');
    await handleInbound(deps(store), PHONE, 'START');
    expect((await handleInbound(deps(store), PHONE, 'only big changes please')).texts).toHaveLength(1);
    expect(store.contact(PHONE)?.notifyLevel).toBe('summary');
    await handleInbound(deps(store), PHONE, 'text me anytime');
    expect(store.contact(PHONE)?.anytime).toBe(true);
  });

  it('an unknown number gets one honest line on how to join', async () => {
    const r = await handleInbound(deps(new Store(':memory:')), '+15555550999', 'hello?');
    expect(r.texts[0]).toContain('automated');
  });
});
