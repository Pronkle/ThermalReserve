// Read-only live mirror of the public Spacetime tables the companion needs. Connects with its own
// client identity (token in data/, gitignored), never the operator passcode.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DbConnection } from '@thermal-reserve/stdb-bindings';
import type { ChatConfig } from '../config';
import type { AggregateHourView, HouseholdView, SimView, WeatherHourView, World } from '../types';

type Conn = InstanceType<typeof DbConnection>;
type HouseholdRow = Conn['db']['household'] extends { iter(): IterableIterator<infer R> } ? R : never;
type SimRow = Conn['db']['simConfig'] extends { iter(): IterableIterator<infer R> } ? R : never;

export const toHousehold = (r: HouseholdRow): HouseholdView => ({
  identity: r.identity.toHexString(),
  nickname: r.nickname,
  taF: r.taF,
  targetF: r.targetF,
  floorF: r.floorF,
  overridden: r.overridden,
  exempt: r.exempt,
  savedCf: r.savedCf,
  cohortId: r.cohortId,
});

export const toSim = (r: SimRow): SimView => ({
  scenarioId: r.scenarioId,
  planId: r.planId,
  strategy: r.strategy,
  status: r.status,
  simHour: r.simHour,
  hours: r.hours,
  eventStartHour: r.eventStartHour,
  eventEndHour: r.eventEndHour,
  startIso: r.startIso,
  capacityMMcfd: r.capacityMmcfd,
  maxDepthF: r.maxDepthF,
  floorF: r.floorF,
  enrolledHomes: r.enrolledHomes,
  exemptShare: r.exemptShare,
  overrideRate: r.overrideRate,
});

export interface ContactFeedRow { identity: string; firstName: string; lastName: string; phone: string; }

export interface MirrorEvents {
  onChange: () => void;
  // Opted-in contacts from /home (private contact_feed view; only when a reader passcode is set).
  onContact?: (row: ContactFeedRow) => void;
  onContactCleared?: (row: ContactFeedRow) => void;
  onHouseholdRemoved: (identity: string) => void;
  onReady: () => void;
  log?: (line: string) => void;
}

export class Mirror implements World {
  private conn: Conn | undefined;
  private ready = false;
  private stopped = false;
  private retryMs = 1000;

  // With a passcode, this identity claims the contact reader role and also subscribes to contact_feed.
  constructor(private readonly config: ChatConfig, private readonly events: MirrorEvents, private readonly contactReaderPasscode?: string) {}

  contactFeed(): ContactFeedRow[] {
    if (!this.conn || !this.contactReaderPasscode) return [];
    return [...this.conn.db.contactFeed.iter()].map(r => ({ identity: r.identity.toHexString(), firstName: r.firstName, lastName: r.lastName, phone: r.phone }));
  }

  get isReady() { return this.ready; }

  // Resolves once the subscription has applied (or after timeoutMs, so callers never hang).
  whenReady(timeoutMs = 10_000): Promise<boolean> {
    if (this.ready) return Promise.resolve(true);
    return new Promise(resolve => {
      const started = Date.now();
      const poll = setInterval(() => {
        if (this.ready || Date.now() - started > timeoutMs) { clearInterval(poll); resolve(this.ready); }
      }, 100);
    });
  }

  sim(): SimView | undefined {
    const row = this.conn ? [...this.conn.db.simConfig.iter()][0] : undefined;
    return row ? toSim(row) : undefined;
  }

  households(): HouseholdView[] {
    return this.conn ? [...this.conn.db.household.iter()].map(toHousehold) : [];
  }

  household(identity: string): HouseholdView | undefined {
    return this.households().find(h => h.identity === identity);
  }

  weather(): WeatherHourView[] {
    if (!this.conn) return [];
    return [...this.conn.db.weatherHour.iter()]
      .map(r => ({ hour: r.hour, outdoorF: r.outdoorF, systemMMcfh: r.systemMmcfh }))
      .sort((a, b) => a.hour - b.hour);
  }

  planTargetF(cohortId: number, hour: number): number | undefined {
    if (!this.conn) return undefined;
    const planId = this.sim()?.planId;
    for (const r of this.conn.db.planHour.iter()) {
      if (r.cohortId === cohortId && r.hour === hour && r.planId === planId) return Number.isFinite(r.targetF) ? r.targetF : undefined;
    }
    return undefined;
  }

  dispatchedPlan(cohortCount: number, hours: number) {
    const sim = this.sim();
    if (!this.conn || !sim?.planId || sim.strategy === 'BASELINE') return undefined;
    const targetsF = Array.from({ length: cohortCount }, () => new Array<number>(hours).fill(NaN));
    let rows = 0;
    for (const r of this.conn.db.planHour.iter()) {
      if (r.planId !== sim.planId || r.cohortId >= cohortCount || r.hour >= hours) continue;
      targetsF[r.cohortId][r.hour] = Number.isFinite(r.targetF) ? r.targetF : NaN;
      rows++;
    }
    return rows ? { planId: sim.planId, strategy: sim.strategy, targetsF } : undefined;
  }

  aggregates(): AggregateHourView[] {
    if (!this.conn) return [];
    return [...this.conn.db.aggregateHour.iter()]
      .map(r => ({ hour: r.hour, fleetGasMMcf: r.fleetGasMmcf, baselineGasMMcf: r.baselineGasMmcf, systemMMcf: r.systemMmcf, capacityMMcf: r.capacityMmcf, reliefMMcf: r.reliefMmcf, strategy: r.strategy }))
      .sort((a, b) => a.hour - b.hour);
  }

  connect() {
    const log = this.events.log ?? (line => console.log(line));
    const tokenFile = join(this.config.dataDir, `${this.config.stdbDb}.token`);
    let token: string | undefined;
    try { token = readFileSync(tokenFile, 'utf8').trim() || undefined; } catch { /* first run */ }
    this.conn = DbConnection.builder()
      .withUri(this.config.stdbUri)
      .withDatabaseName(this.config.stdbDb)
      .withToken(token)
      .onConnect((conn, identity, issuedToken) => {
        mkdirSync(this.config.dataDir, { recursive: true });
        writeFileSync(tokenFile, issuedToken, { mode: 0o600 });
        this.retryMs = 1000;
        log(`[stdb] connected to ${this.config.stdbDb} as ${identity.toHexString().slice(0, 12)}…`);
        const queries = ['SELECT * FROM sim_config', 'SELECT * FROM household', 'SELECT * FROM weather_hour', 'SELECT * FROM plan_hour', 'SELECT * FROM aggregate_hour'];
        if (this.contactReaderPasscode) {
          // Claim before subscribing so the view returns this identity's rows from the start.
          conn.reducers.claimContactReader({ passcode: this.contactReaderPasscode })
            .then(() => log('[stdb] contact reader claimed'))
            .catch(e => log(`[stdb] contact reader claim failed: ${String(e).slice(0, 120)}`));
          queries.push('SELECT * FROM contact_feed');
        }
        conn.subscriptionBuilder()
          .onApplied(() => {
            this.ready = true;
            log(`[stdb] subscribed: ${this.households().length} households, status ${this.sim()?.status ?? '?'}`);
            this.events.onReady();
            this.events.onChange();
          })
          .onError(ctx => log(`[stdb] subscription error: ${String((ctx as { event?: unknown }).event ?? "unknown")}`))
          .subscribe(queries);
      })
      .onConnectError((_ctx, err) => { log(`[stdb] connect error: ${String(err)}`); this.retry(); })
      .onDisconnect(() => { this.ready = false; log('[stdb] disconnected'); this.retry(); })
      .build();
    const conn = this.conn;
    const changed = () => { if (this.ready) this.events.onChange(); };
    conn.db.household.onInsert(changed);
    conn.db.household.onUpdate(changed);
    conn.db.household.onDelete((_ctx, row) => { if (this.ready) this.events.onHouseholdRemoved(row.identity.toHexString()); });
    conn.db.simConfig.onInsert(changed);
    conn.db.simConfig.onUpdate(changed);
    if (this.contactReaderPasscode) {
      const row = (r: { identity: { toHexString(): string }; firstName: string; lastName: string; phone: string }): ContactFeedRow =>
        ({ identity: r.identity.toHexString(), firstName: r.firstName, lastName: r.lastName, phone: r.phone });
      conn.db.contactFeed.onInsert((_ctx, r) => { if (this.ready) this.events.onContact?.(row(r)); });
      conn.db.contactFeed.onDelete((_ctx, r) => { if (this.ready) this.events.onContactCleared?.(row(r)); });
    }
  }

  // Reconnect with backoff (1 s doubling to 30 s) unless we are shutting down.
  private retry() {
    if (this.stopped) return;
    const wait = this.retryMs;
    this.retryMs = Math.min(this.retryMs * 2, 30_000);
    setTimeout(() => { if (!this.stopped) this.connect(); }, wait);
  }

  disconnect() {
    this.stopped = true;
    this.conn?.disconnect();
  }
}
