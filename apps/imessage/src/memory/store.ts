// Local SQLite memory (CHAT brief §6.4), via Node's built-in node:sqlite (no extra dependency).
// Holds phone numbers, so the file lives in apps/imessage/data/ (gitignored) and everything for an
// address is deleted on STOP and when its household disappears.
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { NotifiedState } from '../watcher/detect';
import type { Transition } from '../types';

export type NotifyLevel = 'all' | 'summary';

// Small per-person memory the concierge updates through its remember tool (brief §6.4).
export interface PersonMemory {
  preferredName?: string;
  verbosity?: 'short' | 'normal' | 'detailed';
  caresAbout?: string[];
  answered?: string[];          // questions already answered, so it doesn't repeat itself
  lastExplanation?: string;
}

export interface Contact {
  address: string;
  identity: string;
  nickname: string;
  linkedAt: number;
  notifyLevel: NotifyLevel;
  anytime: boolean;          // opted out of quiet hours ("text me anytime")
  unanswered: number;        // proactive messages since their last inbound text
  lastState: NotifiedState | undefined;
  lastSentAt: number;        // real ms of the last proactive send (throttle)
  lastInboundAt: number;
}

export interface Pending { id: string; address: string; transition: Transition; createdAt: number; }

export interface OutboxRow { id: string; address: string; body: string; status: 'sending' | 'sent' | 'failed'; transitionIds: string[]; }

interface ContactRow {
  address: string; identity: string; nickname: string; linked_at: number; notify_level: string;
  anytime: number; unanswered: number; last_state: string | null; last_sent_at: number; last_inbound_at: number;
}

export class Store {
  readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS contact (
        address TEXT PRIMARY KEY, identity TEXT NOT NULL, nickname TEXT NOT NULL, linked_at INTEGER NOT NULL,
        notify_level TEXT NOT NULL DEFAULT 'all', anytime INTEGER NOT NULL DEFAULT 0,
        unanswered INTEGER NOT NULL DEFAULT 0, last_state TEXT, last_sent_at INTEGER NOT NULL DEFAULT 0,
        last_inbound_at INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX IF NOT EXISTS contact_identity ON contact(identity);
      CREATE TABLE IF NOT EXISTS pending (
        id TEXT NOT NULL, address TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL,
        PRIMARY KEY (address, id));
      CREATE TABLE IF NOT EXISTS outbox (
        id TEXT PRIMARY KEY, address TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL,
        transition_ids TEXT NOT NULL, created_at INTEGER NOT NULL, sent_at INTEGER, error TEXT);
      CREATE TABLE IF NOT EXISTS history (
        id INTEGER PRIMARY KEY AUTOINCREMENT, address TEXT NOT NULL, direction TEXT NOT NULL,
        body TEXT NOT NULL, at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS person_memory (address TEXT PRIMARY KEY, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS failure (
        id INTEGER PRIMARY KEY AUTOINCREMENT, address TEXT NOT NULL, error TEXT NOT NULL, at INTEGER NOT NULL);
    `);
  }

  close() { this.db.close(); }

  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  // ---------- contacts ----------

  private toContact(r: ContactRow): Contact {
    return {
      address: r.address, identity: r.identity, nickname: r.nickname, linkedAt: r.linked_at,
      notifyLevel: r.notify_level === 'summary' ? 'summary' : 'all', anytime: r.anytime === 1,
      unanswered: r.unanswered, lastState: r.last_state ? JSON.parse(r.last_state) : undefined,
      lastSentAt: r.last_sent_at, lastInboundAt: r.last_inbound_at,
    };
  }

  contact(address: string): Contact | undefined {
    const r = this.db.prepare('SELECT * FROM contact WHERE address = ?').get(address) as ContactRow | undefined;
    return r ? this.toContact(r) : undefined;
  }

  contacts(): Contact[] {
    return (this.db.prepare('SELECT * FROM contact').all() as unknown as ContactRow[]).map(r => this.toContact(r));
  }

  // Linking a new household to an address replaces any earlier link and its queue.
  link(address: string, identity: string, nickname: string, state: NotifiedState, now: number) {
    this.transaction(() => {
      this.db.prepare('DELETE FROM pending WHERE address = ?').run(address);
      this.db.prepare(`INSERT INTO contact (address, identity, nickname, linked_at, last_state, last_inbound_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(address) DO UPDATE SET identity = excluded.identity, nickname = excluded.nickname,
          linked_at = excluded.linked_at, last_state = excluded.last_state, unanswered = 0,
          last_inbound_at = excluded.last_inbound_at`)
        .run(address, identity, nickname, now, JSON.stringify(state), now);
    });
  }

  // STOP and household removal: delete everything stored for this address.
  forget(address: string) {
    this.transaction(() => {
      for (const table of ['contact', 'pending', 'outbox', 'history', 'person_memory', 'failure']) {
        this.db.prepare(`DELETE FROM ${table} WHERE address = ?`).run(address);
      }
    });
  }

  setPreference(address: string, patch: { notifyLevel?: NotifyLevel; anytime?: boolean }) {
    if (patch.notifyLevel) this.db.prepare('UPDATE contact SET notify_level = ? WHERE address = ?').run(patch.notifyLevel, address);
    if (patch.anytime !== undefined) this.db.prepare('UPDATE contact SET anytime = ? WHERE address = ?').run(patch.anytime ? 1 : 0, address);
  }

  noteInbound(address: string, body: string, now: number) {
    this.db.prepare('UPDATE contact SET unanswered = 0, last_inbound_at = ? WHERE address = ?').run(now, address);
    this.addHistory(address, 'in', body, now);
  }

  addHistory(address: string, direction: 'in' | 'out', body: string, now: number) {
    this.db.prepare('INSERT INTO history (address, direction, body, at) VALUES (?, ?, ?, ?)').run(address, direction, body, now);
    // Keep the last ~30 turns per thread.
    this.db.prepare(`DELETE FROM history WHERE address = ? AND id NOT IN
      (SELECT id FROM history WHERE address = ? ORDER BY id DESC LIMIT 30)`).run(address, address);
  }

  history(address: string): { direction: 'in' | 'out'; body: string; at: number }[] {
    return this.db.prepare('SELECT direction, body, at FROM history WHERE address = ? ORDER BY id').all(address) as never;
  }

  personMemory(address: string): PersonMemory {
    const r = this.db.prepare('SELECT json FROM person_memory WHERE address = ?').get(address) as { json: string } | undefined;
    return r ? JSON.parse(r.json) : {};
  }

  updatePersonMemory(address: string, fn: (m: PersonMemory) => PersonMemory) {
    const next = fn(this.personMemory(address));
    this.db.prepare(`INSERT INTO person_memory (address, json) VALUES (?, ?)
      ON CONFLICT(address) DO UPDATE SET json = excluded.json`).run(address, JSON.stringify(next));
  }

  // ---------- watcher state and queue (one transaction, so a crash can't split them) ----------

  recordTransitions(address: string, state: NotifiedState, transitions: Transition[], now: number) {
    this.transaction(() => {
      this.db.prepare('UPDATE contact SET last_state = ? WHERE address = ?').run(JSON.stringify(state), address);
      const insert = this.db.prepare('INSERT OR IGNORE INTO pending (id, address, payload, created_at) VALUES (?, ?, ?, ?)');
      for (const t of transitions) insert.run(t.id, address, JSON.stringify(t), now);
    });
  }

  pending(address: string): Pending[] {
    const rows = this.db.prepare('SELECT id, address, payload, created_at FROM pending WHERE address = ? ORDER BY created_at, id')
      .all(address) as { id: string; address: string; payload: string; created_at: number }[];
    return rows.map(r => ({ id: r.id, address: r.address, transition: JSON.parse(r.payload), createdAt: r.created_at }));
  }

  // ---------- outbox: at-most-once proactive sends ----------
  // Spectrum has no idempotency key, so a row is marked 'sending' before the network call and the
  // queue is cleared only once the send resolves. After a crash, a 'sending' row may or may not
  // have reached the phone; we treat it as sent (never a duplicate; worst case one lost message).

  beginSend(row: Omit<OutboxRow, 'status'>, now: number): boolean {
    const result = this.db.prepare(`INSERT OR IGNORE INTO outbox (id, address, body, status, transition_ids, created_at)
      VALUES (?, ?, ?, 'sending', ?, ?)`).run(row.id, row.address, row.body, JSON.stringify(row.transitionIds), now);
    return Number(result.changes) === 1;
  }

  finishSend(id: string, now: number) {
    this.transaction(() => {
      const row = this.db.prepare('SELECT address, transition_ids FROM outbox WHERE id = ?').get(id) as { address: string; transition_ids: string } | undefined;
      if (!row) return;
      this.db.prepare("UPDATE outbox SET status = 'sent', sent_at = ? WHERE id = ?").run(now, id);
      const del = this.db.prepare('DELETE FROM pending WHERE address = ? AND id = ?');
      for (const tid of JSON.parse(row.transition_ids) as string[]) del.run(row.address, tid);
      this.db.prepare('UPDATE contact SET last_sent_at = ?, unanswered = unanswered + 1 WHERE address = ?').run(now, row.address);
    });
  }

  // A failed send leaves the queue intact and waits one throttle window before retrying.
  failSend(id: string, address: string, error: string, now: number) {
    this.transaction(() => {
      this.db.prepare('DELETE FROM outbox WHERE id = ?').run(id);
      this.db.prepare('UPDATE contact SET last_sent_at = ? WHERE address = ?').run(now, address);
      this.db.prepare('INSERT INTO failure (address, error, at) VALUES (?, ?, ?)').run(address, error.slice(0, 500), now);
    });
  }

  // On startup: rows left in 'sending' by a crash count as sent.
  settleInterruptedSends(now: number): string[] {
    const ids = (this.db.prepare("SELECT id FROM outbox WHERE status = 'sending'").all() as { id: string }[]).map(r => r.id);
    for (const id of ids) this.finishSend(id, now);
    return ids;
  }

  outbox(address: string): OutboxRow[] {
    const rows = this.db.prepare('SELECT id, address, body, status, transition_ids FROM outbox WHERE address = ? ORDER BY created_at')
      .all(address) as { id: string; address: string; body: string; status: OutboxRow['status']; transition_ids: string }[];
    return rows.map(r => ({ id: r.id, address: r.address, body: r.body, status: r.status, transitionIds: JSON.parse(r.transition_ids) }));
  }
}
