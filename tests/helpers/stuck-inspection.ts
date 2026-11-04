import { workerData } from 'node:worker_threads';

// A real CPU-bound inspector fault: only a different thread can stop this.
Atomics.store(new Int32Array(workerData.started as SharedArrayBuffer), 0, 1);
while (true) { /* intentionally non-cooperative */ }
