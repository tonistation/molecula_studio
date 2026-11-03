import test from 'node:test';
import assert from 'node:assert/strict';

import { frameTimeMs, totalFrames } from '../../src/shared/timeline.ts';

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
