import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalize } from '../../src/shared/canonical.ts';
import { sha256Sync } from '../../src/shared/models/sha256-sync.ts';
import { parseProjectText } from '../../src/shared/schema/index.ts';
import { applyKitSceneWithModels } from '../../src/shared/kit/apply.ts';
import { fixtureText } from '../helpers/fixtures.ts';

const model = { version: 1, name: 'Farol', semanticId: 'farol', parts: [
  { shape: 'box', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], color: '#ffffff' },
] };
const id = sha256Sync(canonicalize(model));

function example() {
  const parsed = parseProjectText(fixtureText('storyboard'));
  assert.ok(parsed.ok);
  const project = parsed.project;
  const scene = structuredClone(project.scenes[0]!.visual);
  assert.ok(scene && 'kind' in scene && scene.kind === 'kit');
  scene.objects.push({ id: 'farol', type: 'model', params: { modelId: id }, position: [0, 0, 0],
    rotation: [0, 0, 0], scale: 1, color: '#ffffff', animations: [] });
  return { project, scene };
}

test('applies a scene and detached verified model snapshots together', () => {
  const { project, scene } = example();
  const before = structuredClone(project);
  const snapshot = { id, model: structuredClone(model) };
  const next = applyKitSceneWithModels(project, project.scenes[0]!.sceneId, scene, [snapshot]);
  assert.deepEqual(project, before);
  assert.deepEqual(next.models, [snapshot]);
  snapshot.model.name = 'Changed';
  assert.equal(next.models![0]!.model.name, 'Farol');
});

test('rejects forged snapshots and missing references without mutating the draft', () => {
  const { project, scene } = example();
  const before = structuredClone(project);
  assert.throws(() => applyKitSceneWithModels(project, project.scenes[0]!.sceneId, scene, [{ id: '0'.repeat(64), model }]));
  assert.throws(() => applyKitSceneWithModels(project, project.scenes[0]!.sceneId, scene, []));
  assert.deepEqual(project, before);
});
