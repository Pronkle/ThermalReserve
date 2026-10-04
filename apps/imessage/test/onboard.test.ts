import { describe, expect, it } from 'vitest';
import { handleInbound } from '../src/concierge/inbound';
import { Store } from '../src/memory/store';
import { onboard, opener, type ContactRequest } from '../src/onboard/onboard';
import { photonUsers, validateUser, type PhotonUser } from '../src/onboard/photon';
import { Notifier } from '../src/watcher/notifier';
import { config, consts, home, IDENTITY, NOON_ET, PHONE, sim } from './fixtures';

const req: ContactRequest = { identity: IDENTITY, firstName: 'Sam', lastName: 'Lee', email: 'sam@example.com', phone: PHONE };

function fakePhoton(existing: string[] = []) {
  const added: PhotonUser[] = [];
  return { added, photon: { phones: async () => new Set([...existing, ...added.map(a => a.phone)]), add: async (u: PhotonUser) => { added.push(u); } } };
}

describe('photon CLI wrapper', () => {
  it('validates before calling Photon', () => {
    expect(validateUser(req)).toBeUndefined();
    expect(validateUser({ ...req, phone: '9075551234' })).toMatch(/E\.164/);
    expect(validateUser({ ...req, email: 'not-an-email' })).toMatch(/email/);
    expect(validateUser({ ...req, firstName: '<script>' })).toMatch(/names/);
  });
  it('builds the non-interactive users add / ls commands and parses the list', async () => {
    const calls: string[][] = [];
    const users = photonUsers(async args => { calls.push(args); return args[2] === 'ls' ? JSON.stringify([{ phoneNumber: PHONE }, { phoneNumber: null }]) : '{}'; });
    expect([...(await users.phones())]).toEqual([PHONE]);
    await users.add(req);
    expect(calls[1]).toEqual(['spectrum', 'users', 'add', '--first-name', 'Sam', '--last-name', 'Lee', '--email', 'sam@example.com', '--phone', PHONE]);
    await expect(users.add({ ...req, phone: 'x' })).rejects.toThrow(/E\.164/);
  });
});

describe('auto-onboarding', () => {
  const deps = (store: Store, photon = fakePhoton().photon, sent: string[] = []) => ({
    store, consts, photon, household: (id: string) => (id === IDENTITY ? home() : undefined), sim: () => sim(0, { status: 'idle' }),
    sendText: async (_a: string, b: string) => { sent.push(b); }, now: () => NOON_ET, log: () => undefined,
  });

  it('adds the number to Photon, sends one text-only opener, and waits for YES', async () => {
    const store = new Store(':memory:');
    const p = fakePhoton();
    const sent: string[] = [];
    expect(await onboard(deps(store, p.photon, sent), req)).toBe('onboarded');
    expect(p.added).toHaveLength(1);
    expect(sent).toEqual([opener('Test iPhone')]);
    expect(sent[0]).not.toMatch(/https?:|!/);
    expect(store.contact(PHONE)?.consented).toBe(false);
  });

  it('skips Photon when the number is already a project user, and never onboards twice', async () => {
    const store = new Store(':memory:');
    const p = fakePhoton([PHONE]);
    expect(await onboard(deps(store, p.photon), req)).toBe('onboarded');
    expect(p.added).toHaveLength(0);
    expect(await onboard(deps(store, p.photon), req)).toBe('already linked');
  });

  it('nothing proactive goes out before YES; YES turns updates on; STOP works before YES', async () => {
    const store = new Store(':memory:');
    await onboard(deps(store), req);
    const sent: string[] = [];
    let s = sim(0, { status: 'idle' });
    let h = home();
    const notifier = new Notifier({ store, consts, config, household: () => h, sim: () => s, sendText: async (_a, b) => { sent.push(b); }, now: () => NOON_ET + 60_000, log: () => undefined });
    s = sim(30); h = home({ targetF: 66, taF: 67 });
    notifier.observe(); await notifier.flush();
    expect(sent).toEqual([]);
    expect(store.pending(PHONE)).toEqual([]);

    const inbound = (t: string) => handleInbound({ store, consts, households: () => [h], sim: () => s, now: () => NOON_ET, log: () => undefined }, PHONE, t);
    expect((await inbound('what is this')).texts[0]).toMatch(/^Reply YES/);
    expect((await inbound('yes')).texts[0]).toMatch(/^Thanks. You're set for Test iPhone/);
    expect(store.contact(PHONE)?.consented).toBe(true);

    const store2 = new Store(':memory:');
    await onboard(deps(store2), req);
    await handleInbound({ store: store2, consts, households: () => [h], sim: () => s, now: () => NOON_ET, log: () => undefined }, PHONE, 'STOP');
    expect(store2.contact(PHONE)).toBeUndefined();
  });

  it('invalid requests and unknown households are refused', async () => {
    const store = new Store(':memory:');
    expect(await onboard(deps(store), { ...req, phone: '555' })).toBe('invalid');
    expect(await onboard(deps(store), { ...req, identity: 'nobody' })).toBe('no household');
  });

  it('a Photon failure is reported and nothing is stored', async () => {
    const store = new Store(':memory:');
    const failing = { phones: async () => new Set<string>(), add: async () => { throw new Error('401'); } };
    expect(await onboard(deps(store, failing), req)).toBe('failed');
    expect(store.contact(PHONE)).toBeUndefined();
  });
});
