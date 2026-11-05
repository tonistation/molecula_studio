import test from 'node:test';
import assert from 'node:assert/strict';
import { validateKitScene } from '../../src/shared/kit/validate.ts';
import { KIT_OBJECT_TYPES } from '../../src/shared/kit/schema.ts';

const scene = () => ({
  kind: 'kit', kitVersion: 1, palette: { background: '#DDEEF5' },
  sky: { top: '#DDEEF5', bottom: '#FFFFFF', sun: null, clouds: [] },
  environment: { seed: 1, terrain: null, water: null },
  objects: [], particles: [], labels: [], overlays: [],
  camera: { move: 'static', from: [0, 0, 8], to: [0, 0, 8], target: [0, 0, 0], easing: 'linear' },
});

const object = () => ({ id: 'ball', type: 'sphere', params: { radius: 1 }, position: [0, 0, 0], rotation: [0, 0, 0], scale: 1, color: '#FFFFFF', animations: [] });

const proportions = { width: 1, height: 2, depth: 1 };
const objectSamples: Record<string, Record<string, unknown>> = {
  box: { width: 1, height: 1, depth: 1 }, sphere: { radius: 1 },
  cylinder: { radius: 1, height: 2 }, cone: { radius: 1, height: 2 },
  lathe: { profile: [[0, 0], [1, 1], [0, 2]] }, rock: { radius: 1 }, drop: { radius: 1 },
  character: { proportions, bodyColor: '#112233', accentColor: '#445566', pose: 'wave' },
  arrow: { proportions, direction: [0, 1, 0], color: '#FFFFFF' },
  car: { proportions, bodyColor: '#112233', wheelColor: '#445566' },
  rockLayers: { proportions, colors: ['#112233', '#445566'] },
  label: { proportions, text: 'Agua dulce', color: '#FFFFFF' },
};

test('covers every object variant and rejects extra fields inside each parameter contract', () => {
  assert.deepEqual(Object.keys(objectSamples).sort(), [...KIT_OBJECT_TYPES].sort());
  for (const [type, params] of Object.entries(objectSamples)) {
    const value = { ...scene(), objects: [{ ...object(), type, params }] };
    assert.equal(validateKitScene(value).ok, true, type);
    assert.equal(validateKitScene({ ...value, objects: [{ ...value.objects[0], params: { ...params, source: 'code()' } }] }).ok, false, type);
  }
});

test('covers every animation variant, requires declared parameters and bounds their values', () => {
  const samples = { move: { from: [0, 0, 0], to: [1, 1, 1] }, fall: { from: [0, 1, 0], to: [0, 0, 0] },
    roll: { axis: [1, 0, 0], turns: 2 }, pulse: { amplitude: 0.2, cycles: 2 },
    appear: {}, disappear: {}, pose: { from: 'neutral', to: 'arms-up' } };
  for (const [type, params] of Object.entries(samples)) {
    const animation = { type, params, startMs: 0, endMs: 1000, easing: 'ease-in-out' };
    const value = { ...scene(), objects: [{ ...object(), type: 'character', params: objectSamples.character, animations: [animation] }] };
    assert.equal(validateKitScene(value).ok, true, type);
    assert.equal(validateKitScene({ ...value, objects: [{ ...value.objects[0], animations: [{ ...animation, params: { ...params, extra: 1 } }] }] }).ok, false, type);
    assert.equal(validateKitScene({ ...value, objects: [{ ...value.objects[0], animations: [{ ...animation, easing: 'unknown' }] }] }).ok, false, type);
  }
});

test('accepts bounded sky, terrain, each water/particle variant, labels, overlays and camera moves', () => {
  for (const type of ['sea', 'river', 'waterfall']) {
    const water = type === 'sea' ? { type, level: 0, size: 20, color: '#1122FF' }
      : { type, points: [[0, 2, 0], [1, 0, 0]], width: 1, color: '#1122FF' };
    const value = { ...scene(),
      sky: { ...scene().sky, sun: { position: [0, 4, -5], radius: 1, color: '#FFFF00' }, clouds: [{ position: [1, 2, 3], scale: 1 }] },
      environment: { seed: 3, terrain: { type: 'mountain', color: '#44AA44', height: 5, size: 20 }, water },
      objects: [object()], labels: [{ objectId: 'ball', text: 'Agua', color: '#FFFFFF' }],
      particles: ['sparkle', 'rain', 'bubbles'].map(type => ({ type, seed: 4, count: 10, position: [0, 0, 0], spread: [2, 2, 2], color: '#FFFFFF', speed: 1, size: 0.1 })),
      overlays: [{ type: 'counter', from: 30, to: 0, startMs: 0, endMs: 1000, color: '#FFFFFF' },
        { type: 'chevrons', count: 2, direction: 'right', color: '#FFFFFF' }],
    };
    assert.equal(validateKitScene(value).ok, true, type);
    assert.equal(validateKitScene({ ...value, environment: { ...value.environment, water: { ...water, url: 'https://example.com' } } }).ok, false);
    assert.equal(validateKitScene({ ...value, particles: [{ ...value.particles[0], count: 1001 }] }).ok, false);
    assert.equal(validateKitScene({ ...value, overlays: [{ ...value.overlays[0], endMs: 0 }] }).ok, false);
  }
  for (const move of ['static', 'dolly-in', 'pan', 'orbit', 'follow']) {
    const camera = move === 'follow' ? { move, from: [0, 0, 8], to: [0, 0, 8], targetObjectId: 'ball', easing: 'ease-out' }
      : { ...scene().camera, move };
    assert.equal(validateKitScene({ ...scene(), objects: [object()], camera }).ok, true, move);
  }
});

test('rejects sparse arrays and accessors without executing user data', () => {
  assert.equal(validateKitScene({ ...scene(), objects: Array(1) }).ok, false);
  assert.equal(validateKitScene({ ...scene(), camera: { ...scene().camera, from: Array(3) } }).ok, false);
  let invoked = false;
  const value = Object.defineProperty(scene(), 'sky', { get() { invoked = true; throw new Error('must not execute'); }, enumerable: true });
  assert.equal(validateKitScene(value).ok, false);
  assert.equal(invoked, false);
  const hidden = Object.defineProperty(scene(), 'camera', { enumerable: false, get() { invoked = true; throw new Error('must not execute'); } });
  assert.doesNotThrow(() => assert.equal(validateKitScene(hidden).ok, false));
  assert.equal(invoked, false);
});

test('malformed unit vectors never invoke coercion or spread an unbounded array', () => {
  for (const direction of [[{ toString: null, valueOf: null }, 0, 0], Array(200_000).fill(0)]) {
    const value = { ...scene(), objects: [{ ...object(), type: 'arrow', params: { ...objectSamples.arrow, direction } }] };
    assert.doesNotThrow(() => assert.equal(validateKitScene(value).ok, false));
  }
});

test('rejects malformed params, unsafe values, duplicate ids, dangling references and invalid timing', () => {
  const bad = [
    { ...scene(), objects: [{ ...object(), params: { radius: 1, url: 'https://example.com' } }] },
    { ...scene(), objects: [{ ...object(), params: { radius: -1 } }] },
    { ...scene(), objects: [object(), object()] },
    { ...scene(), objects: [{ ...object(), position: [Infinity, 0, 0] }] },
    { ...scene(), camera: { ...scene().camera, target: undefined, targetObjectId: 'missing' } },
    { ...scene(), labels: [{ objectId: 'missing', text: 'Agua', color: '#FFFFFF' }] },
    { ...scene(), objects: [{ ...object(), animations: [{ type: 'move', startMs: 200, endMs: 100, easing: 'linear', params: { from: [0, 0, 0], to: [1, 0, 0] } }] }] },
    { ...scene(), objects: [{ ...object(), animations: Array.from({ length: 9 }, () => ({ type: 'appear', startMs: 0, endMs: 100, easing: 'linear', params: {} })) }] },
  ];
  for (const value of bad) assert.equal(validateKitScene(value).ok, false, JSON.stringify(value));
  const cyclic = scene() as unknown as Record<string, unknown>;
  cyclic.sky = cyclic;
  assert.equal(validateKitScene(cyclic).ok, false);
  assert.equal(validateKitScene({ ...scene(), sky: new Date() }).ok, false);
  assert.equal(validateKitScene(JSON.parse('{"__proto__":{}}')).ok, false);
});

test('bounds animations and keyframes by the containing scene duration', () => {
  const visual = { ...scene(), objects: [{ ...object(), animations: [{ type: 'appear', startMs: 0, endMs: 2000, easing: 'linear', params: {} }] }] };
  assert.equal(validateKitScene(visual, { durationMs: 1000 }).ok, false);
  assert.equal(validateKitScene(visual, { durationMs: 2000 }).ok, true);
});

test('accepts exact resource limits and rejects the next item with a limit finding', () => {
  const animation = { type: 'appear', params: {}, startMs: 0, endMs: 1000, easing: 'linear' };
  const particles = { type: 'rain', seed: 1, count: 1000, position: [0, 0, 0], spread: [1, 1, 1], color: '#FFFFFF', speed: 1, size: 1 };
  const objects = Array.from({ length: 24 }, (_, index) => ({ ...object(), id: `o-${index}`, animations: Array.from({ length: 8 }, () => animation) }));
  const value = { ...scene(), objects, particles: Array.from({ length: 4 }, () => particles),
    labels: Array.from({ length: 6 }, () => ({ objectId: 'o-0', text: 'Agua', color: '#FFFFFF' })) };
  assert.equal(validateKitScene(value).ok, true);
  for (const field of ['objects', 'particles', 'labels'] as const) {
    const result = validateKitScene({ ...value, [field]: [...value[field], { ...value[field][0], id: 'another' }] });
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.issues.some(issue => issue.path === `$.${field}` && issue.code === 'limit'));
  }
});

test('accepts a minimal kit scene', () => {
  assert.equal(validateKitScene(scene()).ok, true);
});

test('rejects extra fields, unknown object types, code and excessive objects', () => {
  assert.equal(validateKitScene({ ...scene(), extra: true }).ok, false);
  assert.equal(validateKitScene({ ...scene(), kind: 'code' }).ok, false);
  const object = { id: 'one', type: 'unknown', params: {}, position: [0, 0, 0], rotation: [0, 0, 0], scale: 1, color: '#FFFFFF', animations: [] };
  assert.equal(validateKitScene({ ...scene(), objects: [object] }).ok, false);
  assert.equal(validateKitScene({ ...scene(), objects: Array.from({ length: 25 }, () => object) }).ok, false);
});

test('reports paths for invalid nested data and enforces scene limits', () => {
  const invalidCamera = validateKitScene({ ...scene(), camera: { ...scene().camera, surprise: true } });
  assert.equal(invalidCamera.ok, false);
  if (!invalidCamera.ok) assert.ok(invalidCamera.issues.some((issue) => issue.path.includes('camera')));

  for (const [field, count] of [['particles', 5], ['labels', 7]] as const) {
    const result = validateKitScene({ ...scene(), [field]: Array.from({ length: count }, () => ({})) });
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.issues.some((issue) => issue.path.includes(field) && issue.code === 'limit'));
  }
});
