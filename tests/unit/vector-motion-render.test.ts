import test from 'node:test';
import assert from 'node:assert/strict';
import { layerAt, counterTextAtFrame } from '../../src/video/vector/animation.ts';
import { projectToVideoProps } from '../../src/shared/video-props.ts';
import { parseProjectText } from '../../src/shared/schema/index.ts';
import { fixtureText } from '../helpers/fixtures.ts';
import type { MotionLayer } from '../../src/shared/motion/types.ts';

const layer: MotionLayer = { id: 'counter', type: 'counter', position: [10, 20], rotation: 10,
  scale: 2, opacity: 0.8, startMs: 200, endMs: 1200, fill: '#ffffff',
  fontId: 'builtin-sans-heavy-v1', fontSize: 80, from: 0, to: 100,
  animations: [{ type: 'move', startMs: 400, endMs: 800, easing: 'linear', from: [0, 0], to: [100, 50] },
    { type: 'fade', startMs: 200, endMs: 600, easing: 'ease-in', from: 0, to: 1 }] };

test('layer timing, eased animations and counter are deterministic at boundaries', () => {
  assert.equal(layerAt(layer, 199).visible, false);
  assert.equal(layerAt(layer, 1200).visible, false);
  assert.deepEqual(layerAt(layer, 200).position, [10, 20]);
  assert.deepEqual(layerAt(layer, 600).position, [50, 25]);
  assert.equal(layerAt(layer, 400).opacity, 0.25);
  assert.equal(counterTextAtFrame(layer, 21, 30), '52');
  const result = layerAt(layer, 600);
  layerAt(layer, 1100);
  assert.deepEqual(layerAt(layer, 600), result);
});

test('counter formats authored precision and reaches its target on the last visible frame', () => {
  const counter = { ...layer, startMs: 0, endMs: 1000 };
  assert.equal(counterTextAtFrame(counter, 0, 30), '0');
  assert.equal(counterTextAtFrame(counter, 1, 30), '3');
  assert.equal(counterTextAtFrame(counter, 29, 30), '100');
  assert.equal(counterTextAtFrame(counter, 30, 30), '100');
  const decimal = { ...counter, from: -1.25, to: 1.25 };
  assert.equal(counterTextAtFrame(decimal, 0, 30), '-1.25');
  assert.equal(counterTextAtFrame(decimal, 29, 30), '1.25');
  assert.equal(counterTextAtFrame({ ...counter, from: -0.01, to: 0 }, 29, 30), '0');
  const offset = { ...counter, startMs: 10, endMs: 101 };
  assert.equal(counterTextAtFrame(offset, 1, 30), '0');
  assert.equal(counterTextAtFrame(offset, 2, 30), '50');
  assert.equal(counterTextAtFrame(offset, 3, 30), '100');
  const single = { ...counter, startMs: 1, endMs: 34 };
  assert.equal(counterTextAtFrame(single, 1, 30), '100');
  assert.equal(counterTextAtFrame({ ...counter, endMs: 1010 }, 29, 30, 30), '100');
  const reverse = { ...counter, from: 1.2, to: -1.2 };
  const early = counterTextAtFrame(reverse, 1, 30);
  counterTextAtFrame(reverse, 27, 30);
  assert.equal(counterTextAtFrame(reverse, 1, 30), early);
  assert.equal(counterTextAtFrame(reverse, 29, 30), '-1.2');
  for (const value of [0.123456789, 1e-7, -1e-300, Number.MIN_VALUE, -0, 1000000]) {
    const rendered = counterTextAtFrame({ ...counter, from: 0, to: value }, 29, 30);
    assert.equal(Number(rendered), Object.is(value, -0) ? 0 : value);
    assert.notEqual(rendered, '-0');
    assert.ok(rendered.length < 32);
  }
});

test('schema 3 styles pass and legacy collisions or wrong visuals are rejected', () => {
  const parsed = parseProjectText(fixtureText('storyboard'));
  assert.ok(parsed.ok);
  const project = parsed.project;
  project.styleId = 'vector-2d';
  project.scenes.forEach(scene => { scene.visual = null; });
  assert.throws(() => projectToVideoProps(project, {}), /style/i);
  project.schemaVersion = 3;
  project.scenes[0]!.visual = { kind: 'vector', version: 1, background: '#ffffff', layers: [] };
  assert.equal(projectToVideoProps(project, {}).scenes[0]!.visual?.kind, 'vector');
  project.scenes[0]!.visual = { kind: 'motion', version: 1, background: '#ffffff', layers: [] };
  assert.throws(() => projectToVideoProps(project, {}), /visual/i);
  project.styleId = 'motion-graphics';
  assert.equal(projectToVideoProps(project, {}).scenes[0]!.visual?.kind, 'motion');
  project.scenes[0]!.visual = { kind: 'motion', version: 1, background: '#ffffff', layers: [{ ...layer, type: 'model' } as never] };
  assert.throws(() => projectToVideoProps(project, {}), /visual/i);
});
