import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalize } from '../../src/shared/canonical.ts';
import { sha256Sync } from '../../src/shared/models/sha256-sync.ts';
import { verifyModelSnapshotsSync } from '../../src/shared/models/integrity.ts';
import { parseProjectText } from '../../src/shared/schema/index.ts';
import { fixtureText } from '../helpers/fixtures.ts';
import { applyKitSceneWithModels } from '../../src/shared/kit/apply.ts';
import { parseKitModelBundle } from '../../src/shared/kit/parse.ts';
import { buildKitModelPrompt } from '../../src/shared/kit/prompt.ts';
import { selectKitModelOutputSchema } from '../../src/shared/kit/output-schema.ts';
import type { ProceduralModel } from '../../src/shared/models/model.ts';

const model: ProceduralModel = { version: 1, name: 'Farol', semanticId: 'farol', parts: [{ shape: 'sphere', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], color: '#ffffff' }] };
const id = sha256Sync(canonicalize(model));
function example() {
  const result = parseProjectText(fixtureText('storyboard'));
  assert.ok(result.ok);
  const project = result.project;
  const scene = structuredClone(project.scenes[0]!.visual);
  assert.ok(scene && 'kind' in scene && scene.kind === 'kit');
  scene.objects.push({ id: 'farol', type: 'model', params: { modelId: 'new-farol' }, position: [0, 0, 0], rotation: [0, 0, 0], scale: 1, color: '#ffffff', animations: [] });
  return { project, scene, models: [{ alias: 'new-farol', model: structuredClone(model) }] };
}

test('generated aliases become canonical verified snapshots and apply atomically', () => {
  const { project, scene, models } = example();
  const result = parseKitModelBundle(JSON.stringify({ scene, models }));
  assert.ok(result.ok);
  assert.deepEqual(result.models, [{ id, model }]);
  assert.ok(verifyModelSnapshotsSync(result.models));
  const object = result.scene.objects.at(-1)!;
  assert.equal(object.type, 'model');
  if (object.type === 'model') assert.equal(object.params.modelId, id);
  assert.deepEqual(applyKitSceneWithModels(project, project.scenes[0]!.sceneId, result.scene, result.models).models, result.models);
});

test('verified catalog snapshot can be reused without new definitions', () => {
  const { scene } = example();
  (scene.objects.at(-1)!.params as { modelId: string }).modelId = id;
  const result = parseKitModelBundle(JSON.stringify({ scene, models: [] }), {}, [{ id, model }]);
  assert.ok(result.ok);
  assert.deepEqual(result.models, [{ id, model }]);
  assert.equal(parseKitModelBundle(JSON.stringify({ scene, models: [] }), {}, [{ id: '0'.repeat(64), model }]).ok, false);
});

test('rejects ambiguous aliases, unknown references, bad shapes and hostile input', () => {
  const { scene, models } = example();
  const failures: unknown[] = [
    { scene, models: [...models, models[0]] },
    { scene, models: [] },
    { scene, models: [{ ...models[0], alias: id }] },
    { scene, models: [{ ...models[0], model: { ...model, name: 'https://evil.test' } }] },
    { scene, models: [{ ...models[0], model: { ...model, extra: true } }] },
    { scene, models: [{ ...models[0], model: { ...model, parts: Array(25).fill(model.parts[0]) } }] },
    { scene, models: Array(9).fill(models[0]) },
    { scene: { ...scene, objects: [...scene.objects, { ...scene.objects.at(-1), id: 'otro', params: { modelId: '0'.repeat(64) } }] }, models },
    { scene: { ...scene, extra: 'https://evil.test' }, models },
    { scene: { ...scene, objects: Array(200).fill(scene.objects.at(-1)) }, models },
    { scene, models, extra: true },
  ];
  for (const value of failures) assert.equal(parseKitModelBundle(JSON.stringify(value)).ok, false);
  assert.equal(parseKitModelBundle('{"scene":{},"models":[],"__proto__":{}}').ok, false);
});

test('model prompt selects literal closed model bundle schema deterministically', () => {
  const { project } = example();
  const args = { scene: project.scenes[0]!, previousScenes: [], references: [], catalog: [{ id, model }] };
  const prompt = buildKitModelPrompt(args);
  assert.equal(prompt, buildKitModelPrompt(args));
  assert.ok(prompt.includes(JSON.stringify(selectKitModelOutputSchema([]))));
  assert.ok(prompt.includes(id));
  assert.ok(prompt.includes('Farol'));
});

test('bundle schemas are closed, bounded and accept their corresponding wire payloads', () => {
  const { project, scene, models } = example();
  for (const visuals of [[], project.scenes]) {
    const schema: any = selectKitModelOutputSchema(visuals);
    function matches(value: any, node: any): boolean {
      if (node.$ref) return matches(value, schema.$defs[node.$ref.split('/').at(-1)]);
      if (node.anyOf) return node.anyOf.some((branch: any) => matches(value, branch));
      if (node.enum && !node.enum.includes(value)) return false;
      if (node.type === 'object') return !!value && typeof value === 'object' && !Array.isArray(value)
        && node.required.every((key: string) => Object.hasOwn(value, key))
        && Object.keys(value).every(key => Object.hasOwn(node.properties, key) && matches(value[key], node.properties[key]));
      if (node.type === 'array') return Array.isArray(value) && value.length >= node.minItems && value.length <= node.maxItems && value.every(v => matches(v, node.items));
      if (node.type === 'string') return typeof value === 'string' && [...value].length >= (node.minLength ?? 0) && [...value].length <= (node.maxLength ?? Infinity) && (!node.pattern || new RegExp(node.pattern, 'u').test(value));
      if (node.type === 'number' || node.type === 'integer') return typeof value === 'number' && Number.isFinite(value) && (node.type !== 'integer' || Number.isInteger(value)) && value >= (node.minimum ?? -Infinity) && value <= (node.maximum ?? Infinity);
      return node.type === 'null' && value === null;
    }
    function walk(node: any): void {
      if (node.type === 'object') {
        assert.equal(node.additionalProperties, false);
        assert.deepEqual([...node.required].sort(), Object.keys(node.properties).sort());
        Object.values(node.properties).forEach(walk);
      }
      if (node.$defs) Object.values(node.$defs).forEach(walk);
      if (node.items) walk(node.items);
      node.anyOf?.forEach(walk);
    }
    walk(schema);
    // Historical scenes require the full schema; use a modern scene for the compact schema.
    const current = structuredClone(scene);
    if (!visuals.length) {
      for (const object of current.objects) delete object.legacy;
      delete current.camera.keyframes;
    }
    assert.ok(matches({ scene: current, models }, schema));
    assert.equal(matches({ scene: current, models, extra: true }, schema), false);
    assert.equal(matches({ scene: current, models: [{ ...models[0], model: { ...model, parts: [] } }] }, schema), false);
    assert.ok(JSON.stringify(schema).length < 120000);
  }
});
