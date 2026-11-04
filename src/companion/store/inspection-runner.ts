import { Worker } from 'node:worker_threads';

import type { AssetMimeType } from '../../shared/schema/types.ts';
import { LIMITS } from '../../shared/schema/limits.ts';
import { InspectionError, type Inspection } from './media-inspect.ts';

export const INSPECTION_TIMEOUT_MS = 10_000;

export interface InspectionInput {
  bytes: Uint8Array<ArrayBuffer>;
  mimeType: AssetMimeType;
}

export type InspectionMessage =
  | { ok: true; inspection: Inspection }
  | { ok: false; reason: InspectionError['reason']; message: string };

interface RunnerOptions {
  /** Tests may shorten the deadline, never enlarge the production ceiling. */
  timeoutMs?: number;
  /** Trusted fault-injection seam, not exposed through HTTP or project JSON. */
  createWorker?: (input: InspectionInput) => Worker;
}

/** Separate JS execution lets the parent terminate even a non-cooperative loop.
 * No user-defined code, codec, filename or module URL is ever executed.
 */
export function createMediaInspector(options: RunnerOptions = {}) {
  const timeoutMs = options.timeoutMs ?? INSPECTION_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > INSPECTION_TIMEOUT_MS) {
    throw new RangeError('inspection timeout must be between 1 and 10000ms');
  }
  const createWorker = options.createWorker ?? ((input: InspectionInput) => new Worker(
    new URL('./inspection-worker.ts', import.meta.url), {
      workerData: input,
      transferList: [input.bytes.buffer],
      resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
      env: {},
      execArgv: [],
    },
  ));
  let active = 0;

  return async (bytes: Uint8Array, mimeType: AssetMimeType): Promise<Inspection> => {
    if (bytes.byteLength === 0 || bytes.byteLength > LIMITS.maxAssetBytes) {
      throw new InspectionError(bytes.byteLength === 0 ? 'unreadable' : 'too-large', 'asset is empty or exceeds the input byte limit');
    }
    // No unbounded worker/byte queues: an explicit retry can be made later.
    if (active >= 2) throw new InspectionError('inspection-busy', 'two media inspections are already running');
    active += 1;
    const deadline = performance.now() + timeoutMs;
    try {
      // Keep caller bytes intact for hashing/persistence; transfer only this
      // bounded owned copy, never an entire pooled Buffer backing allocation.
      const worker = createWorker({ bytes: new Uint8Array(bytes), mimeType });
      return await new Promise<Inspection>((resolve, reject) => {
        let settled = false;
        const finish = async (result: Inspection | InspectionError) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          try {
            await worker.terminate();
            if (result instanceof InspectionError) reject(result);
            else resolve(result);
          } catch {
            reject(new InspectionError('unreadable', 'inspection worker shutdown failed'));
          }
        };
        const timer = setTimeout(() => {
          void finish(new InspectionError('inspection-timeout', 'media inspection exceeded its time limit'));
        }, Math.max(0, deadline - performance.now()));
        worker.once('message', (message: InspectionMessage) => {
          if (performance.now() >= deadline) {
            void finish(new InspectionError('inspection-timeout', 'media inspection exceeded its time limit'));
          } else if (message.ok === true) {
            void finish(message.inspection);
          } else {
            void finish(new InspectionError(message.reason, message.message));
          }
        });
        worker.once('error', () => { void finish(new InspectionError('unreadable', 'inspection worker failed')); });
        worker.once('messageerror', () => { void finish(new InspectionError('unreadable', 'inspection worker response could not be read')); });
        worker.once('exit', () => { void finish(new InspectionError('unreadable', 'inspection worker exited without a result')); });
      });
    } finally { active -= 1; }
  };
}

export const inspectMediaBounded = createMediaInspector();
