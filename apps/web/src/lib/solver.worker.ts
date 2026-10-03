import wasmUrl from 'highs/runtime?url';
import { installSolverWorker } from '@thermal-reserve/model/worker';
installSolverWorker({ wasmUrl });
