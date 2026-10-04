import { replanRun, type PlanningMode, type ReplanPolicy, type ReplanSegment, type ScenarioWithForecasts } from './forecast';
import { configureHighs, solvePlan, type SolveOpts } from './lp';
import type { PressureParams } from './pressure';
import type { CohortParams, FleetConfig, ModelConstants, Plan, RunResult, Scenario } from './types';

// Run solvePlan off the main thread (AGENTS.md Section 9: "Solve plan" in a Web Worker).
//
// WEB, in apps/web (Vite):
//   // solver.worker.ts
//   import wasmUrl from 'highs/runtime?url';
//   import { installSolverWorker } from '@thermal-reserve/model/worker';
//   installSolverWorker({ wasmUrl });
//
//   // anywhere on the main thread
//   const client = createSolverClient(new Worker(new URL('./solver.worker.ts', import.meta.url), { type: 'module' }));
//   const plan = await client.solve({ sc, cohorts, cfg, mode: 'OPTIMIZED', consts });
//   const { plan, run, segments } = await client.replan({ sc, cohorts, cfg, consts, p, opts });  // replanRun, Section 7
//
// Everything crossing the boundary is structured-cloneable (NaN targets survive).

export interface SolveArgs {
  sc: Scenario;
  cohorts: CohortParams[];
  cfg: FleetConfig;
  mode: 'OPTIMIZED' | 'MAX_RELIEF';
  consts: ModelConstants;
  opts?: SolveOpts;
}

/** replanRun's arguments (Section 7), for the worker. */
export interface ReplanArgs {
  sc: ScenarioWithForecasts;
  cohorts: CohortParams[];
  cfg: FleetConfig;
  consts: ModelConstants;
  p: PressureParams;
  opts: { mode: PlanningMode; bufferSigma: number; policy: ReplanPolicy; strategy: 'OPTIMIZED' | 'MAX_RELIEF'; timeoutMs?: number };
}
export interface ReplanResult { plan: Plan; run: RunResult; segments: ReplanSegment[] }

export type SolveRequest = { id: number; kind?: 'solve'; args: SolveArgs } | { id: number; kind: 'replan'; args: ReplanArgs };
export type SolveResponse = { id: number; ok: true; plan: Plan; replan?: ReplanResult } | { id: number; ok: false; error: string };

type MessageHandler = (ev: { data: unknown }) => void;

/** The parts of a dedicated worker scope this module uses. */
export interface WorkerScopeLike {
  addEventListener(type: 'message', fn: MessageHandler): void;
  postMessage(msg: unknown): void;
}

/** The parts of a Worker this module uses. */
export interface WorkerLike {
  addEventListener(type: 'message', fn: MessageHandler): void;
  postMessage(msg: unknown): void;
  terminate(): void;
}

/** Call inside the worker file. `wasmUrl` is where the page serves highs.wasm. */
export function installSolverWorker(opts: { wasmUrl?: string } = {}, scope: WorkerScopeLike = globalThis as unknown as WorkerScopeLike): void {
  if (opts.wasmUrl) {
    const url = opts.wasmUrl;
    configureHighs({ locateFile: () => url });
  }
  scope.addEventListener('message', (ev) => {
    const req = ev.data as SolveRequest;
    if (!req || typeof req.id !== 'number' || !req.args) return;
    const fail = (e: unknown) => scope.postMessage({ id: req.id, ok: false, error: e instanceof Error ? e.message : String(e) } satisfies SolveResponse);
    if (req.kind === 'replan') {
      const { sc, cohorts, cfg, consts, p, opts } = req.args;
      replanRun(sc, cohorts, cfg, consts, p, opts).then(
        (r) => scope.postMessage({ id: req.id, ok: true, plan: r.plan, replan: r } satisfies SolveResponse),
        fail,
      );
      return;
    }
    const { sc, cohorts, cfg, mode, consts, opts: solveOpts } = req.args;
    solvePlan(sc, cohorts, cfg, mode, consts, solveOpts).then(
      (plan) => scope.postMessage({ id: req.id, ok: true, plan } satisfies SolveResponse),
      (e: unknown) => scope.postMessage({ id: req.id, ok: false, error: e instanceof Error ? e.message : String(e) } satisfies SolveResponse),
    );
  });
}

/** Main-thread side: one request in flight per call, matched by id. */
export function createSolverClient(worker: WorkerLike): { solve(args: SolveArgs): Promise<Plan>; replan(args: ReplanArgs): Promise<ReplanResult>; terminate(): void } {
  let nextId = 1;
  const pending = new Map<number, { resolve: (p: Plan, r?: ReplanResult) => void; reject: (e: Error) => void }>();
  worker.addEventListener('message', (ev) => {
    const res = ev.data as SolveResponse;
    const p = res && pending.get(res.id);
    if (!p) return;
    pending.delete(res.id);
    if (res.ok) p.resolve(res.plan, res.replan);
    else p.reject(new Error(res.error));
  });
  return {
    solve(args) {
      const id = nextId++;
      return new Promise<Plan>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        worker.postMessage({ id, args } satisfies SolveRequest);
      });
    },
    replan(args) {
      const id = nextId++;
      return new Promise<ReplanResult>((resolve, reject) => {
        pending.set(id, { resolve: (_p, r) => (r ? resolve(r) : reject(new Error('Solver worker returned no replan result'))), reject });
        worker.postMessage({ id, kind: 'replan', args } satisfies SolveRequest);
      });
    },
    terminate() {
      worker.terminate();
      for (const p of pending.values()) p.reject(new Error('Solver worker terminated'));
      pending.clear();
    },
  };
}
