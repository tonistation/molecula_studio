import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';

import { InspectionError } from '../../src/companion/store/media-inspect.ts';
import { wavBytes } from '../helpers/media.ts';

test('inspection worker returns verified headers without detaching caller bytes', async () => {
  const { inspectMediaBounded, INSPECTION_TIMEOUT_MS } = await import('../../src/companion/store/inspection-runner.ts');
  assert.equal(INSPECTION_TIMEOUT_MS, 10_000);
  const bytes = wavBytes();
  assert.equal((await inspectMediaBounded(bytes, 'audio/wav')).durationMs, 1000);
  assert.equal(bytes.byteLength, wavBytes().byteLength);
  await assert.rejects(inspectMediaBounded(new Uint8Array([1]), 'audio/wav'),
    (error: unknown) => error instanceof InspectionError && error.reason === 'mime-mismatch');
});

test('watchdog terminates a genuinely CPU-stuck inspection while the parent remains responsive', { timeout: 6000 }, async () => {
  const { createMediaInspector } = await import('../../src/companion/store/inspection-runner.ts');
  const started = new SharedArrayBuffer(4);
  let worker: Worker | undefined;
  let ticks = 0;
  const heartbeat = setInterval(() => { ticks += 1; }, 10);
  const inspect = createMediaInspector({ timeoutMs: 1000, createWorker() {
    worker = new Worker(new URL('../helpers/stuck-inspection.ts', import.meta.url), { workerData: { started } });
    return worker;
  } });
  try {
    await assert.rejects(inspect(wavBytes(), 'audio/wav'),
      (error: unknown) => error instanceof InspectionError && error.reason === 'inspection-timeout');
    assert.equal(Atomics.load(new Int32Array(started), 0), 1, 'the worker really entered its CPU loop');
    assert.equal(worker?.threadId, -1, 'timeout settles only after worker termination');
    assert.ok(ticks > 0, 'the main thread can service other requests during inspection');
  } finally { clearInterval(heartbeat); await worker?.terminate(); }
});

test('inspection admission is bounded and timeout releases slots for a later explicit retry', async () => {
  const { createMediaInspector } = await import('../../src/companion/store/inspection-runner.ts');
  assert.throws(() => createMediaInspector({ timeoutMs: 10_001 }), RangeError);
  const workers: Worker[] = [];
  const inspect = createMediaInspector({ timeoutMs: 100, createWorker() {
    const worker = new Worker(new URL('../helpers/stuck-inspection.ts', import.meta.url), {
      workerData: { started: new SharedArrayBuffer(4) },
    });
    workers.push(worker);
    return worker;
  } });
  try {
    const first = inspect(wavBytes(), 'audio/wav');
    const second = inspect(wavBytes(), 'audio/wav');
    await assert.rejects(inspect(wavBytes(), 'audio/wav'),
      (error: unknown) => error instanceof InspectionError && error.reason === 'inspection-busy');
    const results = await Promise.allSettled([first, second]);
    assert.ok(results.every((result) => result.status === 'rejected' && result.reason.reason === 'inspection-timeout'));
    assert.equal(workers.length, 2, 'busy requests do not allocate more workers');
    assert.ok(workers.every((worker) => worker.threadId === -1));
    await assert.rejects(inspect(wavBytes(), 'audio/wav'),
      (error: unknown) => error instanceof InspectionError && error.reason === 'inspection-timeout');
    assert.equal(workers.length, 3);
  } finally { await Promise.all(workers.map((worker) => worker.terminate())); }
});
