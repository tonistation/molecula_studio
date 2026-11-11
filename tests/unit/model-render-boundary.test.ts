import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveModelSnapshots } from '../../src/video/kit/model-snapshots.ts';
import { createHash } from 'node:crypto';
import { canonicalize } from '../../src/shared/canonical.ts';
import { projectToVideoProps } from '../../src/shared/video-props.ts';
import { validateProject } from '../../src/shared/schema/validate.ts';
import { fixtureJson } from '../helpers/fixtures.ts';

const model = { version: 1, name: 'Plant', semanticId: 'plant', parts: [
  { shape: 'sphere', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 2, 1], color: '#aabbcc' },
] };
const id = createHash('sha256').update(canonicalize(model)).digest('hex');
const snapshot = { id, model };
const scenes = [{ visual: { objects: [{ type: 'model', params: { modelId: id } }] } }];

test('resolves only validated project snapshots and rejects missing or malformed models', () => {
  const valid = resolveModelSnapshots([snapshot], scenes);
  assert.equal(valid.ok, true);
  if (valid.ok) assert.deepEqual(valid.models.get(id), snapshot.model);
  assert.equal(resolveModelSnapshots([], scenes).ok, false);
  assert.equal(resolveModelSnapshots([snapshot, snapshot], scenes).ok, false);
  assert.equal(resolveModelSnapshots([{ ...snapshot, model: { ...snapshot.model, url: 'https://example.com' } }], scenes).ok, false);
  assert.equal(resolveModelSnapshots([{ ...snapshot, id: 'a'.repeat(64) }], []).ok, false);
});

test('projectToVideoProps rejects forged snapshots before handing props to a player', () => {
  const parsed = validateProject(fixtureJson('storyboard'));
  assert.ok(parsed.ok);
  parsed.project.models = [{ ...snapshot, id: 'a'.repeat(64) } as never];
  assert.throws(() => projectToVideoProps(parsed.project, {}));
});

test('each render checks current contents and retains only detached verified models', () => {
  const input = structuredClone(snapshot);
  const first = resolveModelSnapshots([input], scenes);
  assert.ok(first.ok);
  input.model.name = 'Forged';
  assert.equal(resolveModelSnapshots([input], scenes).ok, false);
  assert.equal(first.models.get(id)?.name, 'Plant');
  assert.ok(resolveModelSnapshots([snapshot], scenes).ok);
});
