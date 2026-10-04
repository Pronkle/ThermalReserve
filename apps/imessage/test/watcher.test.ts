import { describe, expect, it } from 'vitest';
import { base32, linkCode } from '../src/link';
import { detect, initialState, type NotifiedState } from '../src/watcher/detect';
import { clockLabel, composeMessage, pickForList } from '../src/watcher/compose';
import type { Transition } from '../src/types';
import { consts, home, IDENTITY, sim } from './fixtures';

describe('link codes', () => {
  it('base32 matches RFC 4648 vectors', () => {
    expect(base32(new TextEncoder().encode('foobar'))).toBe('MZXW6YTBOI');
    expect(base32(new TextEncoder().encode('f'))).toBe('MY');
  });
  it('is 6 base32 characters, stable, case- and prefix-insensitive', () => {
    const code = linkCode(IDENTITY);
    expect(code).toMatch(/^[A-Z2-7]{6}$/);
    expect(linkCode(`0x${IDENTITY.toUpperCase()}`)).toBe(code);
    // Shared vector with apps/web (householdLinkCode in patches/web-home-link-code.patch).
    expect(code).toBe('LOWM3V');
  });
});

// Feeds a sequence of (hour, household patch) through detect, as the mirror would.
function run(steps: [number, Parameters<typeof home>[0]][], start?: NotifiedState) {
  let state = start ?? initialState(home(), sim(0, { status: 'idle' }), consts);
  const all: Transition[] = [];
  for (const [hour, patch] of steps) {
    const r = detect(state, home(patch), sim(hour), consts);
    state = r.next;
    all.push(...r.transitions);
  }
  return { state, all };
}

describe('detect', () => {
  it('reports setback start, depth change, recovery and event end once each', () => {
    const { all } = run([
      [10, {}],
      [12, { targetF: 66, taF: 68.4 }],
      [14, { targetF: 66.4, taF: 66.2 }],   // < 1°F: no message
      [20, { targetF: 65, taF: 65.1 }],     // ≥ 1°F deeper
      [30, { targetF: 70, taF: 66 }],       // recovery
      [40, { targetF: 70, taF: 70 }],
      [86, { targetF: 70, taF: 70, savedCf: 120 }],
      [90, { savedCf: 118 }],
    ]);
    expect(all.map(t => t.kind)).toEqual(['setback_start', 'depth_change', 'recovery_start', 'event_end']);
    expect(all[1].previousTargetF).toBe(66);
    expect(new Set(all.map(t => t.id)).size).toBe(4);
  });

  it('ignores tiny LP trims below 0.5°F', () => {
    expect(run([[12, { targetF: 69.7 }], [13, { targetF: 69.6 }]]).all).toEqual([]);
  });

  it('acknowledges override and rejoin', () => {
    const { all } = run([[12, { targetF: 66 }], [13, { overridden: true, targetF: 70 }], [20, { overridden: false, targetF: 66 }]]);
    expect(all.map(t => t.kind)).toEqual(['setback_start', 'override', 'rejoin']);
  });

  it('exempt homes get one message at event start and nothing more', () => {
    const { all } = run([[5, { exempt: true }], [12, { exempt: true }], [40, { exempt: true }], [90, { exempt: true }]]);
    expect(all.map(t => t.kind)).toEqual(['exempt_start']);
  });

  it('linking after the event ended stays silent', () => {
    const start = initialState(home({ savedCf: 50 }), sim(90), consts);
    expect(run([[91, { savedCf: 50 }]], start).all).toEqual([]);
  });

  it('a live re-plan (new plan id mid-run) is not a new run: the summary goes out once', () => {
    let state = initialState(home(), sim(0, { status: 'idle' }), consts);
    const kinds: string[] = [];
    for (const [hour, planId] of [[30, 'p-rp0'], [50, 'p-rp48'], [84, 'p-rp78'], [89, 'p-rp84'], [96, 'p-rp90']] as const) {
      const r = detect(state, home(hour === 30 ? { targetF: 66 } : {}), sim(hour, { planId }), consts);
      state = r.next;
      kinds.push(...r.transitions.map(t => t.kind));
    }
    expect(kinds.filter(k => k === 'event_end')).toHaveLength(1);
    expect(kinds.filter(k => k === 'setback_start')).toHaveLength(1);
  });

  it('a reset (sim hour going back) starts a fresh run', () => {
    const first = run([[12, { targetF: 66 }], [86, {}]]);
    const second = run([[1, {}], [12, { targetF: 66 }]], first.state);
    expect(second.all.map(t => t.kind)).toEqual(['setback_start']);
  });
});

describe('compose', () => {
  const t = (kind: Transition['kind'], simHour: number, extra: Partial<Transition> = {}): Transition =>
    ({ id: `${kind}${simHour}`, kind, simHour, targetF: 66, taF: 68.4, savedCf: 0, ...extra });

  it('labels the sim clock like /home (Anchorage time)', () => {
    expect(clockLabel('2024-01-31T00:00:00-09:00', 30)).toBe('Thu Feb 1 06:00');
    expect(clockLabel('2024-01-31T00:00:00-09:00', 30, true)).toBe('Thu 06:00');
  });

  it('single setback message carries the facts, a question, and no exclamation marks', () => {
    const body = composeMessage([t('setback_start', 30)], home({ targetF: 66, taF: 68.4 }), sim(30), consts);
    expect(body).toBe("Thermal Reserve demo, Thu Feb 1 06:00 (simulated): we lowered Test iPhone's heat to 66°F. Indoor is 68.4°F and will stay above 62°F. Want to know why now?");
  });

  it('catch-up list is one message, oldest first, ending with now and a question', () => {
    const body = composeMessage(
      [t('recovery_start', 50, { targetF: 70 }), t('setback_start', 30), t('depth_change', 38, { targetF: 65, previousTargetF: 66 })],
      home({ targetF: 70, taF: 67.1 }), sim(51), consts);
    expect(body.split('\n')).toEqual([
      'Thermal Reserve demo, since my last text (simulated):',
      '• Thu 06:00 heat lowered to 66°F',
      '• Thu 14:00 lowered further to 65°F',
      '• Fri 02:00 heat raised back toward 70°F',
      'Now: indoor 67.1°F, recovering toward 70°F. Want the reasons behind any of these?',
    ]);
  });

  it('more than 6 changes: the 5 most important plus a count', () => {
    const ts = [t('setback_start', 12), ...[13, 14, 15, 16, 17].map((h, i) => t('depth_change', h, { targetF: 65 - i * 0.1 })), t('recovery_start', 30), t('event_end', 84, { savedCf: 40 })];
    const { shown, hidden } = pickForList(ts);
    expect(hidden).toBe(3);
    expect(shown.map(x => x.kind)).toEqual(['setback_start', 'depth_change', 'depth_change', 'recovery_start', 'event_end']);
    expect(shown.find(x => x.kind === 'depth_change' && x.simHour === 17)).toBeDefined(); // deepest kept
    expect(composeMessage(ts, home(), sim(85), consts)).toContain('• plus 3 smaller changes');
  });

  it('event summary states net savings, labeled simulated', () => {
    expect(composeMessage([t('event_end', 84, { savedCf: 123.4 })], home(), sim(84), consts))
      .toContain('ended with a net 123 cubic feet of gas saved, including the reheat');
  });
});
