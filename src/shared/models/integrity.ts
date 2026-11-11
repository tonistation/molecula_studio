import { canonicalize } from '../canonical.ts';
import { sha256Hex } from '../digests.ts';
import { sha256Sync } from './sha256-sync.ts';
import { MAX_PROJECT_MODELS, MODEL_ID_PATTERN, validateProceduralModel, type ModelSnapshot } from './model.ts';

/** Verify bounded content addresses and return independent snapshots, or reject the whole batch. */
function detachModelSnapshots(value: unknown): ModelSnapshot[] | null {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
    || value.length > MAX_PROJECT_MODELS || Object.getOwnPropertySymbols(value).length
    || Object.getOwnPropertyNames(value).length !== value.length + 1) return null;
  const snapshots: ModelSnapshot[] = [];
  const ids = new Set<string>();
  for (let i = 0; i < value.length; i += 1) {
    const entry = Object.getOwnPropertyDescriptor(value, String(i));
    if (!entry?.enumerable || !('value' in entry)) return null;
    const item: unknown = entry.value;
    if (!item || typeof item !== 'object' || Array.isArray(item)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(item))
      || Object.getOwnPropertySymbols(item).length) return null;
    const names = Object.getOwnPropertyNames(item);
    if (names.length !== 2 || !names.includes('id') || !names.includes('model')) return null;
    const id = Object.getOwnPropertyDescriptor(item, 'id');
    const model = Object.getOwnPropertyDescriptor(item, 'model');
    if (!id?.enumerable || !('value' in id) || typeof id.value !== 'string'
      || !MODEL_ID_PATTERN.test(id.value) || ids.has(id.value)
      || !model?.enumerable || !('value' in model) || !validateProceduralModel(model.value).ok) return null;
    ids.add(id.value);
    snapshots.push({ id: id.value, model: JSON.parse(canonicalize(model.value)) });
  }
  return snapshots;
}

export function verifyModelSnapshotsSync(value: unknown): ModelSnapshot[] | null {
  const snapshots = detachModelSnapshots(value);
  if (!snapshots) return null;
  for (const snapshot of snapshots) {
    if (sha256Sync(canonicalize(snapshot.model)) !== snapshot.id) return null;
  }
  return snapshots;
}

export async function verifyModelSnapshots(value: unknown): Promise<ModelSnapshot[] | null> {
  const snapshots = detachModelSnapshots(value);
  if (!snapshots) return null;
  for (const snapshot of snapshots) {
    if (await sha256Hex(canonicalize(snapshot.model)) !== snapshot.id) return null;
  }
  return snapshots;
}
