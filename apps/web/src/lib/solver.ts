import { createSolverClient, type SolveArgs, type ReplanArgs, type ReplanResult } from '@thermal-reserve/model/worker';
import { planSustainStagger, runPlan, type Plan } from '@thermal-reserve/model';

export function launchSolve(args: SolveArgs): { result: Promise<Plan>; cancel(): void } {
  const start = performance.now();
  const worker = new Worker(new URL('./solver.worker.ts', import.meta.url), { type: 'module' });
  const client = createSolverClient(worker);
  let timer: ReturnType<typeof setTimeout>;
  const fallback = (reason: string): Plan => ({ ...planSustainStagger(args.sc, args.cohorts, args.cfg), id: `${args.sc.id}-${args.mode}-fallback-${reason}`, note: 'Rule-based fallback', solveMs: performance.now() - start });
  const result = new Promise<Plan>(resolve => {
    timer = setTimeout(() => { resolve(fallback('timeout')); client.terminate(); }, 5000);
    worker.addEventListener('error', () => { resolve(fallback('worker')); client.terminate(); });
    client.solve({ ...args, opts: { ...args.opts, timeoutMs: 4500 } }).then(resolve, () => resolve(fallback('error')));
  }).finally(() => { clearTimeout(timer); client.terminate(); });
  return { result, cancel: () => client.terminate() };
}

export function launchReplan(args: ReplanArgs): { result: Promise<ReplanResult>; cancel(): void } {
  const start = performance.now();
  const worker = new Worker(new URL('./solver.worker.ts', import.meta.url), { type: 'module' });
  const client = createSolverClient(worker);
  let timer: ReturnType<typeof setTimeout>;
  const fallback = (): ReplanResult => {
    const plan = { ...planSustainStagger(args.sc, args.cohorts, args.cfg), note: 'Rule-based fallback', solveMs: performance.now() - start };
    return { plan, run: runPlan(args.sc, args.cohorts, args.cfg, plan, args.consts), segments: [] };
  };
  const result = new Promise<ReplanResult>(resolve => {
    timer = setTimeout(() => { resolve(fallback()); client.terminate(); }, 15000);
    worker.addEventListener('error', () => { resolve(fallback()); client.terminate(); });
    client.replan({ ...args, opts: { ...args.opts, timeoutMs: 4500 } }).then(resolve, () => resolve(fallback()));
  }).finally(() => { clearTimeout(timer); client.terminate(); });
  return { result, cancel: () => client.terminate() };
}
