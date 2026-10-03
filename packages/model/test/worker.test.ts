import { describe, expect, it } from 'vitest';
import { createSolverClient, installSolverWorker, solvePlan } from '../src/index';
import type { WorkerLike, WorkerScopeLike } from '../src/index';
import { cfg, cohorts, consts, designScenario } from './helpers';

type Handler = (ev: { data: unknown }) => void;
const g = globalThis as unknown as { structuredClone<T>(v: T): T; queueMicrotask(fn: () => void): void };

/** In-memory worker pair that structured-clones every message, like a real Worker. */
function fakeWorkerPair(): { worker: WorkerLike; scope: WorkerScopeLike } {
  const toWorker: Handler[] = [];
  const toMain: Handler[] = [];
  const send = (hs: Handler[], msg: unknown) => {
    const data = g.structuredClone(msg);
    g.queueMicrotask(() => hs.forEach((h) => h({ data })));
  };
  return {
    worker: { addEventListener: (_t, fn) => toMain.push(fn), postMessage: (m) => send(toWorker, m), terminate: () => {} },
    scope: { addEventListener: (_t, fn) => toWorker.push(fn), postMessage: (m) => send(toMain, m) },
  };
}

describe('solver worker (E7)', () => {
  it('returns the same plan as solvePlan, with NaN targets intact', async () => {
    const { worker, scope } = fakeWorkerPair();
    installSolverWorker({}, scope);
    const client = createSolverClient(worker);
    const sc = designScenario();
    const tight = { ...cfg, capacityMMcfd: 264 }; // coverable, so some hours stay at normal (NaN)
    const viaWorker = await client.solve({ sc, cohorts, cfg: tight, mode: 'OPTIMIZED', consts });
    const direct = await solvePlan(sc, cohorts, tight, 'OPTIMIZED', consts);
    expect(viaWorker.note).toBeUndefined();
    expect(viaWorker.targetsF.flat().some(Number.isNaN)).toBe(true);
    expect(viaWorker.targetsF).toEqual(direct.targetsF);
    expect(viaWorker.shortfallMMcfd).toEqual(direct.shortfallMMcfd);
  });

  it('matches concurrent requests to their responses', async () => {
    const { worker, scope } = fakeWorkerPair();
    installSolverWorker({}, scope);
    const client = createSolverClient(worker);
    const sc = designScenario();
    const [a, b] = await Promise.all([
      client.solve({ sc, cohorts, cfg: { ...cfg, capacityMMcfd: 400 }, mode: 'OPTIMIZED', consts }),
      client.solve({ sc, cohorts, cfg, mode: 'MAX_RELIEF', consts }),
    ]);
    expect(a.strategy).toBe('OPTIMIZED');
    expect(a.targetsF.flat().filter(Number.isFinite)).toHaveLength(0);
    expect(b.strategy).toBe('MAX_RELIEF');
  });
});
