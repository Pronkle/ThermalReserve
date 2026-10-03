import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { DbConnection } from '@thermal-reserve/stdb-bindings';

type Row<K extends keyof DbConnection['db']> = ReturnType<DbConnection['db'][K]['iter']> extends IterableIterator<infer R> ? R : never;
interface Snapshot {
  config?: Row<'simConfig'>;
  cohorts: Row<'cohortState'>[];
  aggregates: Row<'aggregateHour'>[];
  households: Row<'household'>[];
  homes: Row<'sampleHome'>[];
  events: Row<'eventLog'>[];
  plans: Row<'planHour'>[];
}
interface LiveState extends Snapshot {
  connection?: DbConnection;
  identity?: string;
  status: 'unconfigured' | 'connecting' | 'connected' | 'disconnected';
  database: string;
  error?: string;
}
const empty: LiveState = { cohorts: [], aggregates: [], households: [], homes: [], events: [], plans: [], status: 'unconfigured', database: '' };
const Context = createContext<LiveState>(empty);

export function databaseName(search: string, configured: string, storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>): string {
  const override = new URLSearchParams(search).get('db');
  try {
    if (override !== null) {
      if (override) storage?.setItem('thermal-reserve.database', override);
      else storage?.removeItem('thermal-reserve.database');
      return override || configured;
    }
    return storage?.getItem('thermal-reserve.database') || configured;
  } catch { return override || configured; }
}
function snapshot(connection: DbConnection): Snapshot {
  return {
    config: [...connection.db.simConfig.iter()][0],
    plans: [...connection.db.planHour.iter()],
    cohorts: [...connection.db.cohortState.iter()],
    aggregates: [...connection.db.aggregateHour.iter()].sort((a, b) => a.hour - b.hour),
    households: [...connection.db.household.iter()],
    homes: [...connection.db.sampleHome.iter()],
    events: [...connection.db.eventLog.iter()].sort((a, b) => a.id > b.id ? -1 : a.id < b.id ? 1 : 0),
  };
}

export function StdbProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<LiveState>(empty);
  useEffect(() => {
    const uri = import.meta.env.VITE_STDB_URI as string | undefined;
    const database = databaseName(window.location.search, import.meta.env.VITE_STDB_DB || '', window.sessionStorage);
    if (!uri || !database) { setState({ ...empty, database }); return; }
    const tokenKey = `thermal-reserve.identity:${uri}:${database}`;
    let disposed = false;
    let connection: DbConnection | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let delay = 500;
    let generation = 0;
    function connect() {
      const attempt = ++generation;
      setState(previous => ({ ...previous, database, connection: undefined, status: previous.status === 'unconfigured' ? 'connecting' : 'disconnected' }));
      let queued = false;
      let ready = false;
      function refresh() {
        if (queued || !ready) return;
        queued = true;
        queueMicrotask(() => {
          queued = false;
          if (!disposed && attempt === generation && connection) setState(previous => ({ ...previous, ...snapshot(connection!), connection, status: 'connected', error: undefined }));
        });
      }
      function retry(error?: Error) {
        if (disposed || attempt !== generation || timer) return;
        ready = false;
        setState(previous => ({ ...previous, connection: undefined, status: 'disconnected', error: error?.message }));
        timer = setTimeout(() => { timer = undefined; connect(); }, delay);
        delay = Math.min(delay * 2, 30000);
      }
      let token: string | undefined;
      try { token = localStorage.getItem(tokenKey) || undefined; } catch { /* Storage may be unavailable in private browsing. */ }
      connection = DbConnection.builder().withUri(uri!).withDatabaseName(database).withToken(token)
        .onConnect((conn, identity, issuedToken) => {
          if (disposed || attempt !== generation) { conn.disconnect(); return; }
          try { localStorage.setItem(tokenKey, issuedToken); } catch { /* The connection still works without persistence. */ }
          setState(previous => ({ ...previous, identity: identity.toHexString() }));
          for (const table of [conn.db.simConfig, conn.db.cohortState, conn.db.aggregateHour, conn.db.household, conn.db.sampleHome, conn.db.eventLog, conn.db.planHour]) {
            table.onInsert(refresh); table.onUpdate(refresh); table.onDelete(refresh);
          }
          conn.subscriptionBuilder().onApplied(() => { ready = true; delay = 500; refresh(); })
            .onError(ctx => { retry(ctx.event ?? new Error('Live subscription failed')); conn.disconnect(); })
            .subscribe(['SELECT * FROM sim_config', 'SELECT * FROM cohort_state', 'SELECT * FROM aggregate_hour', 'SELECT * FROM household', 'SELECT * FROM sample_home', 'SELECT * FROM event_log', 'SELECT * FROM cohort', 'SELECT * FROM plan_hour', 'SELECT * FROM weather_hour']);
        }).onConnectError((_ctx, error) => retry(error)).onDisconnect((_ctx, error) => retry(error)).build();
    }
    connect();
    return () => { disposed = true; if (timer) clearTimeout(timer); if (connection) connection.disconnect(); };
  }, []);
  return <Context.Provider value={state}>{children}</Context.Provider>;
}
export const useConnection = () => useContext(Context);
export const useSimConfig = () => useConnection().config;
export const useCohortStates = () => useConnection().cohorts;
export const useAggregates = () => useConnection().aggregates;
export const useHouseholds = () => useConnection().households;
export const useSampleHomes = () => useConnection().homes;
export const useEventLog = (limit = 20) => useConnection().events.slice(0, limit);
export const useReducers = () => useConnection().connection?.reducers;
export function useMyHousehold() {
  const { households, identity } = useConnection();
  return households.find(home => home.identity.toHexString() === identity);
}
