import { createSolverClient, type SolveArgs } from '@thermal-reserve/model/worker';
import { planSustainStagger, type Plan } from '@thermal-reserve/model';

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
