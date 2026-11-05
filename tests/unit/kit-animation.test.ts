import { test } from 'node:test';
import assert from 'node:assert/strict';
import { animateObject, ease, identitySeed } from '../../src/video/kit/animate.ts';
import { cameraAt, projectPoint } from '../../src/video/kit/camera.ts';
import type { KitCamera, KitObject } from '../../src/shared/kit/types.ts';
import { Euler, Vector3 } from 'three';

const object: KitObject = { id: 'rock', type: 'rock', params: { radius: 1 }, position: [1, 2, 3], rotation: [0, 0, 0], scale: 2, color: '#999999', animations: [] };
const camera: KitCamera = { move: 'pan', from: [0, 2, 10], to: [4, 2, 10], target: [0, 0, 0], easing: 'linear' };

test('easing clamps and has exact endpoints and distinct curves', () => {
  for (const kind of ['linear', 'ease-in', 'ease-out', 'ease-in-out'] as const) {
    assert.equal(ease(-1, kind), 0);
    assert.equal(ease(2, kind), 1);
  }
  assert.equal(ease(0.5, 'ease-in'), 0.25);
  assert.equal(ease(0.5, 'ease-out'), 0.75);
  assert.equal(ease(0.5, 'ease-in-out'), 0.5);
});

test('move/fall clamp, compose with roll/pulse and do not mutate data', () => {
  const spec: KitObject = { ...object, animations: [
    { type: 'fall', startMs: 100, endMs: 1100, easing: 'ease-in', params: { from: [0, 4, 0], to: [0, 0, 0] } },
    { type: 'roll', startMs: 100, endMs: 1100, easing: 'linear', params: { axis: [0, 0, 1], turns: 1 } },
    { type: 'pulse', startMs: 100, endMs: 1100, easing: 'linear', params: { amplitude: 0.2, cycles: 1 } },
  ] };
  const before = structuredClone(spec);
  assert.deepEqual(animateObject(spec, 0).position, object.position);
  assert.deepEqual(animateObject(spec, 600).position, [0, 3, 0]);
  assert.equal(animateObject(spec, 600).rotation[2], Math.PI);
  assert.deepEqual(animateObject(spec, 2000).position, [0, 0, 0]);
  assert.deepEqual(spec, before);
  assert.deepEqual(animateObject(spec, 600), animateObject(spec, 600));
});

test('appear/disappear and pose use absolute time, including backward seeks', () => {
  const spec: KitObject = { ...object, animations: [
    { type: 'appear', startMs: 100, endMs: 200, easing: 'linear', params: {} },
    { type: 'disappear', startMs: 800, endMs: 1000, easing: 'linear', params: {} },
    { type: 'pose', startMs: 0, endMs: 1000, easing: 'linear', params: { from: 'neutral', to: 'arms-up' } },
  ] };
  assert.equal(animateObject(spec, 0).opacity, 0);
  assert.equal(animateObject(spec, 150).opacity, 0.5);
  assert.equal(animateObject(spec, 900).opacity, 0.5);
  assert.equal(animateObject(spec, 1100).opacity, 0);
  assert.notDeepEqual(animateObject(spec, 500).pose, animateObject(spec, 0).pose);
  assert.equal(animateObject(spec, 150).opacity, 0.5);
});

test('identity seed ignores scene/time/transform and honors explicit seed', () => {
  assert.equal(identitySeed(object), identitySeed({ ...object, position: [4, 5, 6] }));
  assert.equal(identitySeed({ ...object, seed: 101 }), 101);
  assert.notEqual(identitySeed(object), identitySeed({ ...object, id: 'other' }));
});

test('roll rotates about an arbitrary unit axis, not independent Euler components', () => {
  const axis: [number, number, number] = [Math.SQRT1_2, Math.SQRT1_2, 0];
  const spec: KitObject = { ...object, animations: [{ type: 'roll', startMs: 0, endMs: 1000, easing: 'linear', params: { axis, turns: 0.5 } }] };
  const result = new Vector3(...axis).applyEuler(new Euler(...animateObject(spec, 1000).rotation));
  assert.ok(result.distanceTo(new Vector3(...axis)) < 1e-9);
});

test('move and pulse honor easing, base rotation, scale and endpoint persistence', () => {
  const spec: KitObject = { ...object, rotation: [0.1, 0.2, 0.3], animations: [
    { type: 'move', startMs: 0, endMs: 1000, easing: 'ease-out', params: { from: [0, 0, 0], to: [4, 0, 0] } },
    { type: 'pulse', startMs: 0, endMs: 1000, easing: 'linear', params: { amplitude: 0.5, cycles: 1 } },
  ] };
  assert.equal(animateObject(spec, 500).position[0], 3);
  assert.equal(animateObject(spec, 250).scale, 3);
  assert.ok(Math.abs(animateObject(spec, 2000).scale - 2) < 1e-12);
  assert.equal(animateObject(spec, 2000).position[0], 4);
});

test('camera clamps and preserves static, pan and dolly endpoints', () => {
  assert.deepEqual(cameraAt(camera, -100, 1000, []).position, camera.from);
  assert.deepEqual(cameraAt(camera, 500, 1000, []).position, [2, 2, 10]);
  assert.deepEqual(cameraAt(camera, 2000, 1000, []).position, camera.to);
  assert.deepEqual(cameraAt({ ...camera, move: 'static' }, 1000, 1000, []).position, camera.from);
  assert.deepEqual(cameraAt({ ...camera, move: 'dolly-in' }, 1000, 1000, []).position, camera.to);
});

test('orbit interpolates around target rather than cutting through it', () => {
  const state = cameraAt({ ...camera, move: 'orbit', from: [0, 0, 10], to: [10, 0, 0] }, 500, 1000, []);
  assert.ok(Math.abs(Math.hypot(...state.position) - 10) < 1e-9);
  assert.ok(Math.abs(state.position[0] - Math.sqrt(50)) < 1e-9);
});

test('follow and object target track animated world positions', () => {
  const moving: KitObject = { ...object, animations: [{ type: 'move', startMs: 0, endMs: 1000, easing: 'linear', params: { from: [0, 0, 0], to: [10, 0, 0] } }] };
  const state = cameraAt({ move: 'follow', from: [0, 2, 10], to: [0, 2, 10], targetObjectId: 'rock', easing: 'linear' }, 500, 1000, [moving]);
  assert.deepEqual(state.target, [5, 0, 0]);
  assert.deepEqual(state.position, [5, 2, 10]);
  assert.throws(() => cameraAt({ ...camera, target: undefined, targetObjectId: 'missing' } as KitCamera, 0, 1000, []), /missing/);
});

test('legacy camera track preserves every timestamp, target and FOV', () => {
  const track: KitCamera = { ...camera, keyframes: [
    { atMs: 0, position: [0, 0, 10], target: [0, 0, 0], fovDeg: 40 },
    { atMs: 400, position: [4, 4, 8], target: [2, 0, 0], fovDeg: 60 },
    { atMs: 1000, position: [10, 0, 6], target: [4, 0, 0], fovDeg: 30 },
  ] };
  assert.deepEqual(cameraAt(track, 400, 1000, []), { position: [4, 4, 8], target: [2, 0, 0], fov: 60 });
  assert.equal(cameraAt(track, 700, 1000, []).fov, 45);
  assert.equal(cameraAt(track, 2000, 1000, []).fov, 30);
});

test('perspective projection centers target, hides behind camera and uses FOV', () => {
  const state = { position: [0, 0, 10] as [number, number, number], target: [0, 0, 0] as [number, number, number], fov: 45 };
  assert.deepEqual(projectPoint([0, 0, 0], state, 1080, 1920), { x: 540, y: 960, visible: true });
  assert.equal(projectPoint([0, 0, 11], state, 1080, 1920).visible, false);
  assert.ok(projectPoint([1, 0, 0], state, 1080, 1920).x > projectPoint([1, 0, 0], { ...state, fov: 80 }, 1080, 1920).x);
});
