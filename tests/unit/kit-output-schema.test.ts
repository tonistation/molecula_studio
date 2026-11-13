import test from 'node:test';
import assert from 'node:assert/strict';
import { fixtureJson } from '../helpers/fixtures.ts';
import { validateProject } from '../../src/shared/schema/validate.ts';
import { validateKitScene } from '../../src/shared/kit/validate.ts';
import { KIT_SCENE_SCHEMA, selectKitOutputSchema } from '../../src/shared/kit/output-schema.ts';
import { KIT_OBJECT_TYPES, KIT_ANIMATION_TYPES, KIT_CAMERA_MOVES } from '../../src/shared/kit/schema.ts';
import { buildKitPrompt } from '../../src/shared/kit/prompt.ts';

test('3D prompt and output schema reject non-3D visual input', () => {
  const visual = { kind: 'vector' as const, version: 1 as const, background: '#FFFFFF', layers: [] };
  assert.throws(() => selectKitOutputSchema([{ visual }]), /requiere escenas visuales 3D/);
  assert.throws(() => buildKitPrompt({ scene: { title: '', text: '', visualIntent: '', durationMs: 1000 },
    previousScenes: [{ visual }], references: [] }), /requiere escenas visuales 3D/);
});

// Independent test-only evaluator for the exact exported JSON Schema vocabulary.
// Semantic/cross-field constraints are intentionally verified by validateKitScene, not this evaluator.
type Schema = { [key: string]: any };
const schema: Schema = KIT_SCENE_SCHEMA;
function matches(value: any, node: Schema = schema): boolean {
  if (node.$ref) return matches(value, schema.$defs[node.$ref.split('/').at(-1)]);
  if (node.anyOf) return node.anyOf.some((branch: Schema) => matches(value, branch));
  if (node.enum && !node.enum.includes(value)) return false;
  switch (node.type) {
    case 'object':
      return value !== null && typeof value === 'object' && !Array.isArray(value)
        && node.required.every((key: string) => Object.hasOwn(value, key))
        && Object.keys(value).every(key => Object.hasOwn(node.properties, key) && matches(value[key], node.properties[key]));
    case 'array': return Array.isArray(value) && value.length >= node.minItems && value.length <= node.maxItems
      && value.every(item => matches(item, node.items));
    case 'string': return typeof value === 'string' && [...value].length >= (node.minLength ?? 0)
      && [...value].length <= (node.maxLength ?? Infinity) && (!node.pattern || new RegExp(node.pattern).test(value));
    case 'number': case 'integer': return typeof value === 'number' && Number.isFinite(value)
      && (node.type !== 'integer' || Number.isInteger(value)) && value >= (node.minimum ?? -Infinity) && value <= (node.maximum ?? Infinity);
    case 'null': return value === null;
    default: throw new Error(`Unexpected schema type ${node.type}`);
  }
}
function minimal(): any {
  return { kind: 'kit', kitVersion: 1, palette: { background: '#FFFFFF' },
    sky: { top: '#112233', bottom: '#FFFFFF', sun: null, clouds: [] },
    environment: { seed: 1, terrain: null, water: null }, objects: [], particles: [], labels: [], overlays: [],
    camera: { move: 'pan', from: [0, 0, 8], to: [1, 0, 8], target: [0, 0, 0], easing: 'linear' } };
}
const proportions = { width: 1, height: 2, depth: 1 };
const params: Record<string, unknown> = {
  box: { width: 1, height: 1, depth: 1 }, sphere: { radius: 1 }, cylinder: { radius: 1, height: 2 }, cone: { radius: 1, height: 2 },
  lathe: { profile: [[0, 0], [1, 1]] }, rock: { radius: 1 }, drop: { radius: 1 },
  character: { proportions, bodyColor: '#112233', accentColor: '#445566' },
  arrow: { proportions, direction: [0, 1, 0], color: '#FFFFFF' }, car: { proportions, bodyColor: '#112233', wheelColor: '#445566' },
  rockLayers: { proportions, colors: ['#112233', '#445566'] }, label: { proportions, text: 'Agua', color: '#FFFFFF' },
};

test('kit output schema is closed and fully required in every anyOf/definition, within structured output limits', () => {
  assert.equal(schema.type, 'object');
  assert.equal(schema.anyOf, undefined);
  let properties = 0;
  const vocabulary = new Set(['type', 'properties', 'required', 'additionalProperties', 'minimum', 'maximum',
    'minItems', 'maxItems', 'minLength', 'maxLength', 'pattern', 'items', 'anyOf', 'enum', '$ref', '$defs', 'description']);
  function walk(node: Schema): void {
    Object.keys(node).forEach(key => assert.ok(vocabulary.has(key), key));
    if (node.type === 'object') {
      assert.equal(node.additionalProperties, false);
      assert.deepEqual([...node.required].sort(), Object.keys(node.properties).sort());
      properties += node.required.length;
      Object.values<Schema>(node.properties).forEach(walk);
    }
    if (node.items) walk(node.items);
    node.anyOf?.forEach(walk);
    if (node.$defs) Object.values<Schema>(node.$defs).forEach(walk);
    if (node.$ref) assert.ok(schema.$defs[node.$ref.split('/').at(-1)]);
  }
  function depth(node: Schema): number {
    if (node.$ref) return depth(schema.$defs[node.$ref.split('/').at(-1)]);
    if (node.anyOf) return Math.max(...node.anyOf.map(depth));
    if (node.items) return 1 + depth(node.items);
    if (node.properties) return 1 + Math.max(0, ...Object.values<Schema>(node.properties).map(depth));
    return 0;
  }
  walk(schema);
  assert.ok(properties < 5000);
  assert.ok(depth(schema) <= 10);
  assert.ok(JSON.stringify(schema).length < 120000);
});

test('kit output schema covers all object/animation/camera variants and persisted legacy optional fields without null widening', () => {
  const animations: Record<string, unknown> = { move: { from: [0, 0, 0], to: [1, 0, 0] }, fall: { from: [0, 1, 0], to: [0, 0, 0] },
    roll: { axis: [1, 0, 0], turns: 2 }, pulse: { amplitude: 0.2, cycles: 2 }, appear: {}, disappear: {}, pose: { from: 'neutral', to: 'wave' } };
  assert.deepEqual(Object.keys(params), [...KIT_OBJECT_TYPES]);
  assert.deepEqual(Object.keys(animations), [...KIT_ANIMATION_TYPES]);
  const base = minimal();
  for (const type of KIT_OBJECT_TYPES) {
    const item = { id: 'subject', type, params: params[type], position: [0, 0, 0], rotation: [0, 0, 0], color: '#112233', scale: 1,
      animations: KIT_ANIMATION_TYPES.map(type => ({ type, startMs: 0, endMs: 1000, easing: 'ease-in-out', params: animations[type] })) };
    for (const optional of [{}, { seed: 42 }, { legacy: { entityId: 'subject', definitionVersion: 1, motion: 'idle', state: 'default' } },
      { seed: 42, legacy: { entityId: 'subject', definitionVersion: 1, motion: 'idle', state: 'default' } }]) {
      const value = { ...base, objects: [{ ...item, ...optional }] };
      assert.ok(matches(value), type);
      assert.ok(validateKitScene(value).ok, type);
    }
    assert.equal(matches({ ...base, objects: [{ ...item, params: { ...params[type] as object, extra: 1 } }] }), false);
    assert.equal(matches({ ...base, objects: [{ ...item, seed: null }] }), false);
  }
  for (const move of KIT_CAMERA_MOVES) {
    const { target: _, ...camera } = base.camera;
    for (const optional of [{}, { keyframes: [{ atMs: 0, position: [0, 0, 8], target: [0, 0, 0], fovDeg: 40 }] }]) {
      const value = { ...base, objects: [{ id: 'subject', type: 'sphere', params: { radius: 1 }, position: [0, 0, 0], rotation: [0, 0, 0], color: '#112233', scale: 1, animations: [] }],
        camera: { ...camera, move, targetObjectId: 'subject', ...optional } };
      assert.ok(matches(value));
      assert.ok(validateKitScene(value).ok);
    }
  }
  const migrated = validateProject(fixtureJson('storyboard'));
  assert.ok(migrated.ok);
  for (const scene of migrated.project.scenes) assert.ok(matches(scene.visual));
  assert.ok(matches({ ...base, palette: { ...base.palette, preset: 'dark' } }));
  assert.equal(matches({ ...base, palette: { ...base.palette, preset: null } }), false);
  assert.equal(matches({ ...base, camera: { ...base.camera, targetObjectId: 'subject' } }), false);
  assert.equal(matches({ ...base, kind: 'code' }), false);
  const character = { id: 'subject', type: 'character', params: { ...params.character as object, pose: 'wave' },
    position: [0, 0, 0], rotation: [0, 0, 0], color: '#112233', scale: 1, animations: [] };
  assert.ok(matches({ ...base, objects: [character] }));
  assert.equal(matches({ ...base, objects: [{ ...character, params: { ...character.params, pose: null } }] }), false);
  assert.equal(matches({ ...base, labels: [{ objectId: 'subject', text: 'Agua\u0000', color: '#112233' }] }), false);
});

test('kit output schema describes bounded sky, environment, particles, overlays and rejects extra keys at every level', () => {
  for (const water of [null, { type: 'sea', color: '#112233', level: 0, size: 20 },
    ...['river', 'waterfall'].map(type => ({ type, color: '#112233', points: [[0, 0, 0], [0, 1, 0]], width: 1 }))]) {
    const value = { ...minimal(), sky: { top: '#112233', bottom: '#FFFFFF', sun: { position: [1, 2, 3], radius: 1, color: '#FFFFFF' }, clouds: [{ position: [0, 0, 0], scale: 1 }] },
      environment: { seed: 42, terrain: { type: 'plain', color: '#112233', height: 0, size: 20 }, water },
      particles: ['sparkle', 'rain', 'bubbles'].map(type => ({ type, seed: 1, count: 1000, position: [0, 0, 0], spread: [1, 1, 1], color: '#FFFFFF', speed: 1, size: 0.1 })),
      overlays: [{ type: 'counter', startMs: 0, endMs: 1000, from: 30, to: 0, color: '#FFFFFF' }, { type: 'chevrons', count: 2, direction: 'right', color: '#FFFFFF' }] };
    assert.ok(matches(value));
    assert.ok(validateKitScene(value).ok);
    for (const field of ['sky', 'environment', 'camera', 'palette'] as const) assert.equal(matches({ ...value, [field]: { ...value[field], extra: true } }), false);
    assert.equal(matches({ ...value, particles: [{ ...value.particles[0], count: 1001 }] }), false);
  }
});

test('compact drawing output preserves modern catalog and falls back for historical continuity', () => {
  const compact: Schema = selectKitOutputSchema([]);
  assert.ok(Buffer.byteLength(JSON.stringify(compact)) < Buffer.byteLength(JSON.stringify(schema)) * 0.8);
  const original = schema.$defs;
  try {
    schema.$defs = compact.$defs;
    for (const type of KIT_OBJECT_TYPES) {
      const item = { id: 'subject', type, params: params[type], position: [0, 0, 0], rotation: [0, 0, 0], color: '#112233', scale: 1, animations: [], seed: 42 };
      const value = { ...minimal(), objects: [item] };
      assert.ok(matches(value, compact), type);
      assert.ok(validateKitScene(value).ok, type);
      assert.equal(matches({ ...value, objects: [{ ...item, extra: 1 }] }, compact), false);
      assert.equal(matches({ ...value, objects: [{ ...item, legacy: { entityId: 'subject', definitionVersion: 1, motion: 'idle', state: 'default' } }] }, compact), false);
    }
    const subject = { id: 'subject', type: 'sphere', params: { radius: 1 }, position: [0, 0, 0], rotation: [0, 0, 0], color: '#112233', scale: 1, animations: [] };
    for (const move of KIT_CAMERA_MOVES) {
      const { target: _, ...baseCamera } = minimal().camera;
      for (const target of move === 'follow' ? [{ targetObjectId: 'subject' }] : [{ target: [0, 0, 0] }, { targetObjectId: 'subject' }]) {
        const value = { ...minimal(), objects: [subject], camera: { ...baseCamera, move, ...target } };
        assert.ok(matches(value, compact));
        assert.ok(validateKitScene(value).ok);
      }
    }
    assert.equal(matches({ ...minimal(), camera: { ...minimal().camera, keyframes: [] } }, compact), false);
  } finally { schema.$defs = original; }
  const migrated = validateProject(fixtureJson('storyboard'));
  assert.ok(migrated.ok);
  assert.equal(selectKitOutputSchema(migrated.project.scenes), KIT_SCENE_SCHEMA);
  const legacy = migrated.project.scenes[0]!.visual as any;
  assert.equal(selectKitOutputSchema([{ visual: { ...legacy, camera: minimal().camera } }]), KIT_SCENE_SCHEMA);
  assert.equal(selectKitOutputSchema([{ visual: { ...legacy, objects: [] } }]), KIT_SCENE_SCHEMA);
});
