import test from 'node:test';
import assert from 'node:assert/strict';
import { fixtureJson } from '../helpers/fixtures.ts';
import { validateProject } from '../../src/shared/schema/validate.ts';
import { serializeProject } from '../../src/shared/schema/serialize.ts';
import { adjustKitScene } from '../../src/shared/kit/adjust.ts';
import type { KitScene } from '../../src/shared/kit/types.ts';

function project() {
  const result = validateProject(fixtureJson('storyboard'));
  assert.ok(result.ok);
  return result.project;
}

test('scene adjustments validate, isolate the scene and preserve historical camera until explicit conversion', () => {
  const input = project();
  const before = structuredClone(input);
  const id = input.scenes[0]!.sceneId;
  let result = adjustKitScene(input, id, { type: 'color', field: 'background', value: '#123456' });
  const original = input.scenes[0]!.visual as KitScene;
  assert.deepEqual((result.scenes[0]!.visual as KitScene).camera, original.camera);
  assert.deepEqual(result.scenes[1], input.scenes[1]);
  assert.deepEqual(input, before);
  assert.throws(() => adjustKitScene(result, id, { type: 'camera', camera: { ...original.camera, move: 'pan' } }), /pista/i);
  const camera = structuredClone(original.camera);
  delete camera.keyframes;
  camera.move = 'pan';
  result = adjustKitScene(result, id, { type: 'camera', camera, convertKeyframes: true });
  const labels = [{ objectId: original.objects[0]!.id, text: 'Agua dulce', color: '#FFFFFF' }];
  result = adjustKitScene(result, id, { type: 'labels', labels });
  assert.deepEqual(result.scenes[0], { ...input.scenes[0], revision: input.scenes[0]!.revision + 3,
    visual: { ...original, palette: { ...original.palette, background: '#123456' }, camera, labels } });
  assert.deepEqual(result.scenes[1], input.scenes[1]);
  const reopened = validateProject(JSON.parse(serializeProject(result)));
  assert.ok(reopened.ok);
  assert.deepEqual(reopened.project, result);
  labels[0]!.text = 'Mutación externa';
  assert.equal((result.scenes[0]!.visual as KitScene).labels[0]!.text, 'Agua dulce');
});

test('scene adjustments reject invalid colors, camera references, labels and whole-project errors without mutation', () => {
  const input = project();
  const before = structuredClone(input);
  const id = input.scenes[0]!.sceneId;
  const kit = input.scenes[0]!.visual as KitScene;
  const camera = { move: 'follow' as const, from: kit.camera.from, to: kit.camera.to, easing: kit.camera.easing, targetObjectId: 'missing' };
  for (const change of [
    { type: 'color' as const, field: 'background' as const, value: 'red' },
    { type: 'camera' as const, camera, convertKeyframes: true },
    { type: 'labels' as const, labels: [{ objectId: 'missing', text: 'Agua', color: '#FFFFFF' }] },
    { type: 'labels' as const, labels: [{ objectId: kit.objects[0]!.id, text: '', color: '#FFFFFF' }] },
    { type: 'labels' as const, labels: Array.from({ length: 7 }, () => ({ objectId: kit.objects[0]!.id, text: 'Agua', color: '#FFFFFF' })) },
    { type: 'labels' as const, labels: [{ objectId: kit.objects[0]!.id, text: 'x'.repeat(121), color: '#FFFFFF' }] },
  ]) assert.throws(() => adjustKitScene(input, id, change));
  assert.throws(() => adjustKitScene({ ...input, seed: -1 }, id, { type: 'labels', labels: [] }));
  assert.throws(() => adjustKitScene(input, 'missing', { type: 'labels', labels: [] }));
  assert.throws(() => adjustKitScene({ ...input, styleId: 'unknown' }, id, { type: 'labels', labels: [] }));
  assert.deepEqual(input, before);
});

test('scene controls use existing bounded surfaces and accept exact label limits without new object identities', () => {
  const input = project();
  const id = input.scenes[0]!.sceneId;
  const kit = input.scenes[0]!.visual as KitScene;
  for (const field of ['background', 'skyTop', 'skyBottom'] as const) {
    assert.ok(validateProject(adjustKitScene(input, id, { type: 'color', field, value: '#aAbB09' })).ok);
  }
  const bare = structuredClone(input);
  (bare.scenes[0]!.visual as KitScene).environment.terrain = null;
  (bare.scenes[0]!.visual as KitScene).environment.water = null;
  const before = structuredClone(bare);
  for (const field of ['terrain', 'water'] as const) assert.throws(() => adjustKitScene(bare, id, { type: 'color', field, value: '#112233' }), /superficie/);
  assert.deepEqual(bare, before);
  const labels = Array.from({ length: 6 }, () => ({ objectId: kit.objects[0]!.id, text: '😀'.repeat(120), color: '#172D45' }));
  const result = adjustKitScene(input, id, { type: 'labels', labels });
  assert.ok(validateProject(result).ok);
  assert.deepEqual((result.scenes[0]!.visual as KitScene).objects, kit.objects);
  const camera = { move: 'follow' as const, from: kit.camera.from, to: kit.camera.to, easing: kit.camera.easing, targetObjectId: kit.objects[0]!.id };
  const followed = adjustKitScene(input, id, { type: 'camera', camera, convertKeyframes: true });
  assert.deepEqual((followed.scenes[0]!.visual as KitScene).camera, camera);
  for (const from of [[NaN, 0, 1], [101, 0, 1], [Infinity, 0, 1]] as [number, number, number][]) {
    assert.throws(() => adjustKitScene(input, id, { type: 'camera', camera: { ...camera, from }, convertKeyframes: true }));
  }
  const undrawn = { ...input, scenes: input.scenes.map(scene => ({ ...scene, visual: null })) };
  assert.throws(() => adjustKitScene(undrawn, id, { type: 'labels', labels: [] }), /dibujo del kit/);
});
