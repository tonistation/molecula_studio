import { parentPort, workerData } from 'node:worker_threads';

import { inspectMedia, InspectionError } from './media-inspect.ts';
import type { InspectionInput, InspectionMessage } from './inspection-runner.ts';

const input = workerData as InspectionInput;
let result: InspectionMessage;
try {
  result = { ok: true, inspection: inspectMedia(input.bytes, input.mimeType) };
} catch (error) {
  result = { ok: false, reason: error instanceof InspectionError ? error.reason : 'unreadable',
    message: error instanceof InspectionError ? error.message : 'media headers could not be inspected' };
}
parentPort?.postMessage(result);
