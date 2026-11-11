import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { canonicalize } from '../../src/shared/canonical.ts';
import { verifyModelSnapshots } from '../../src/shared/models/integrity.ts';

const model = { version: 1, name: 'Brain', semanticId: 'brain', parts: [
  { shape: 'sphere', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], color: '#ffffff' },
] };
const id = createHash('sha256').update(canonicalize(model)).digest('hex');

test('verifies canonical model content instead of trusting a 64-character ID', async () => {
  const reordered = { parts: model.parts, semanticId: model.semanticId, name: model.name, version: 1 };
  const verified = await verifyModelSnapshots([{ id, model: reordered }]);
  assert.deepEqual(verified, [{ id, model: reordered }]);
  assert.notEqual(verified![0]!.model, reordered);
  assert.equal(await verifyModelSnapshots([{ id: 'a'.repeat(64), model }]), null);
  assert.equal(await verifyModelSnapshots([{ id, model: { ...model, name: 'Changed' } }]), null);
  assert.equal(await verifyModelSnapshots([{ id, model }, { id, model }]), null);
  assert.equal(await verifyModelSnapshots([{ id, model, url: 'https://example.com' }]), null);
});
