import test from 'node:test';
import assert from 'node:assert/strict';
import { selectModelCatalog } from '../../src/shared/models/catalog.ts';
import { canonicalize } from '../../src/shared/canonical.ts';
import { sha256Sync } from '../../src/shared/models/sha256-sync.ts';

const snapshot = (n: number) => {
  const model = { version: 1 as const, name: `Model ${n}`, semanticId: `model-${n}`, parts: [{ shape: 'sphere' as const,
    position: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number],
    scale: [1, 1, 1] as [number, number, number], color: '#ffffff' }] };
  return { id: sha256Sync(canonicalize(model)), model };
};

test('catalog retains all 64 portable snapshots and rejects forged or excessive inputs', () => {
  const project = Array.from({ length: 64 }, (_, n) => snapshot(n));
  const extra = snapshot(100);
  assert.deepEqual(selectModelCatalog(project, [extra], 'model 100'), project);
  assert.throws(() => selectModelCatalog([...project, extra], [], ''));
  assert.throws(() => selectModelCatalog([{ ...extra, id: project[0]!.id }], project, ''));
  assert.throws(() => selectModelCatalog(project, [{ ...extra, model: { ...extra.model, name: 'tampered' } }], ''));
});
