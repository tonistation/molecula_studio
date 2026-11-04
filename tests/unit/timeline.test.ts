import test from 'node:test';
import assert from 'node:assert/strict';

import { evaluateFrame, frameTimeMs, totalFrames } from '../../src/shared/timeline.ts';
import { parseProjectText, serializeProject, validateProject } from '../../src/shared/schema/index.ts';
import type { Project } from '../../src/shared/schema/types.ts';
import { fixtureText } from '../helpers/fixtures.ts';

function project(name = 'storyboard'): Project {
  const parsed = parseProjectText(fixtureText(name));
  assert.ok(parsed.ok);
  return parsed.project;
}

test('totalFrames rounds up to cover the last partial frame', () => {
  assert.equal(totalFrames(0, 30), 0);
  assert.equal(totalFrames(1000, 30), 30);
  assert.equal(totalFrames(12000, 30), 360);
  assert.equal(totalFrames(60000, 30), 1800);
  assert.equal(totalFrames(1, 30), 1);
  assert.equal(totalFrames(33, 30), 1);
  assert.equal(totalFrames(34, 30), 2);
});

test('frameTimeMs keeps fractional milliseconds instead of snapping the clock', () => {
  assert.equal(frameTimeMs(0, 30), 0);
  assert.equal(frameTimeMs(1, 30), 1000 / 30);
  assert.equal(frameTimeMs(359, 30), (359 * 1000) / 30);
  assert.equal(frameTimeMs(30, 30), 1000);
  assert.equal(frameTimeMs(3, 30), 100);
});

test('frameTimeMs rejects frames outside a safe integer domain', () => {
  assert.throws(() => frameTimeMs(-1, 30), RangeError);
  assert.throws(() => frameTimeMs(1, 0), RangeError);
  assert.throws(() => frameTimeMs(Number.NaN, 30), RangeError);
});

test('frame evaluation selects half-open contiguous scenes with fractional local time', () => {
  const snapshot = project();
  const boundary = snapshot.scenes[1]!.startMs * 30 / 1000;
  for (const index of [0, 1, boundary - 1, boundary, boundary + 1]) {
    const sceneIndex = index < boundary ? 0 : 1;
    const scene = snapshot.scenes[sceneIndex]!;
    assert.deepEqual(evaluateFrame(snapshot, index), {
      frameIndex: index,
      timeMs: index * 1000 / 30,
      sceneIndex,
      sceneId: scene.sceneId,
      sceneTimeMs: index * 1000 / 30 - scene.startMs,
      seed: snapshot.seed,
    });
  }
});

test('every frame belongs to exactly one scene; final frame is before the endpoint', () => {
  const snapshot = project();
  const count = totalFrames(snapshot.output.durationMs, snapshot.output.fps);
  for (let index = 0; index < count; index++) {
    const sample = evaluateFrame(snapshot, index);
    const active = snapshot.scenes.filter(scene =>
      scene.startMs <= sample.timeMs && sample.timeMs < scene.startMs + scene.durationMs);
    assert.equal(active.length, 1);
    assert.equal(sample.sceneId, active[0]!.sceneId);
    assert.ok(sample.sceneTimeMs >= 0 && sample.sceneTimeMs < active[0]!.durationMs);
  }
  const final = evaluateFrame(snapshot, count - 1);
  assert.equal(final.sceneIndex, snapshot.scenes.length - 1);
  assert.equal(final.timeMs, (count - 1) * 1000 / 30);
  assert.ok(final.timeMs < snapshot.output.durationMs);
  assert.throws(() => evaluateFrame(snapshot, count), RangeError);
});

test('reverse and out-of-order seeking produce the exact same samples', () => {
  const snapshot = project();
  const count = totalFrames(snapshot.output.durationMs, 30);
  const expected = Array.from({ length: count }, (_, index) => evaluateFrame(snapshot, index));
  for (let index = count - 1; index >= 0; index--) {
    assert.deepEqual(evaluateFrame(snapshot, index), expected[index]);
  }
  for (const index of [7, count - 1, 0, 37, 1, 7]) {
    assert.deepEqual(evaluateFrame(snapshot, index), expected[index]);
  }
});

test('empty drafts have no sample and partial drafts need no visual or available media', () => {
  const empty = project('empty');
  assert.equal(totalFrames(empty.output.durationMs, 30), 0);
  assert.throws(() => evaluateFrame(empty, 0), RangeError);
  const partial = project('draft-partial');
  assert.equal(partial.scenes[0]!.visual, null);
  assert.equal(evaluateFrame(partial, 0).sceneId, partial.scenes[0]!.sceneId);
});

test('invalid frame requests never alter snapshot or subsequent evaluation', () => {
  const snapshot = project();
  const before = structuredClone(snapshot);
  const expected = evaluateFrame(snapshot, 0);
  for (const index of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1,
    totalFrames(snapshot.output.durationMs, 30)]) {
    assert.throws(() => evaluateFrame(snapshot, index), RangeError);
    assert.deepEqual(evaluateFrame(snapshot, 0), expected);
    assert.deepEqual(snapshot, before);
  }
  const sample = evaluateFrame(snapshot, 0);
  sample.seed = 123;
  assert.deepEqual(evaluateFrame(snapshot, 0), expected);
});

test('persisted seed including uint32 endpoints survives serialization and arbitrary seeks', () => {
  for (const seed of [0, 4294967295]) {
    const snapshot = project();
    snapshot.seed = seed;
    const seeds = snapshot.entities.map(entity => entity.seed);
    const reopened = parseProjectText(serializeProject(snapshot));
    assert.ok(reopened.ok);
    assert.deepEqual(reopened.project.entities.map(entity => entity.seed), seeds);
    for (const index of [1, 0, 5, 1]) {
      assert.equal(evaluateFrame(reopened.project, index).seed, seed);
      assert.deepEqual(evaluateFrame(reopened.project, index), evaluateFrame(snapshot, index));
    }
  }
});

test('sampling rejects malformed layout and unsupported style without mutation', () => {
  for (const corrupt of [
    (p: Project) => { p.scenes[1]!.startMs += 100; },
    (p: Project) => { p.scenes[1]!.startMs -= 100; },
    (p: Project) => { p.output.durationMs += 100; },
    (p: Project) => { p.output.fps = 0 as 30; },
    (p: Project) => { p.seed = -1; },
    (p: Project) => { p.styleId = 'unknown-style'; },
  ]) {
    const snapshot = project();
    corrupt(snapshot);
    const before = structuredClone(snapshot);
    assert.throws(() => evaluateFrame(snapshot, 0), RangeError);
    assert.deepEqual(snapshot, before);
  }
});

test('100ms scene boundaries use exact frame starts, not accumulated deltas', () => {
  const snapshot = project();
  snapshot.scenes[0]!.durationMs = 1100;
  snapshot.scenes[1]!.startMs = 1100;
  snapshot.scenes[1]!.durationMs = 1300;
  snapshot.output.durationMs = 2400;
  for (const scene of snapshot.scenes) {
    scene.visual = null;
    scene.audio = null;
    scene.words = [];
    scene.mediaBindings = { audio: null, words: null };
  }
  assert.ok(validateProject(snapshot).ok);
  assert.equal(evaluateFrame(snapshot, 32).sceneIndex, 0);
  assert.equal(evaluateFrame(snapshot, 33).sceneTimeMs, 0);
  assert.equal(evaluateFrame(snapshot, 33).sceneIndex, 1);
  assert.equal(evaluateFrame(snapshot, 71).sceneTimeMs, 71 * 1000 / 30 - 1100);
  assert.throws(() => evaluateFrame(snapshot, 72), RangeError);
});
