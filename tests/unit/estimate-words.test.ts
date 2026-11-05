import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LIMITS } from '../../src/shared/schema/limits.ts';
import { estimateWords } from '../../src/shared/voice/estimate.ts';

test('estimation preserves Unicode text and normalizes whitespace without mutation', () => {
  const words = estimateWords('  ¿De\n dónde  sale la sal? 🌊 ', 5000);
  assert.deepEqual(words.map(word => word.text), ['¿De', 'dónde', 'sale', 'la', 'sal?', '🌊']);
  assert.deepEqual(words, estimateWords('  ¿De\n dónde  sale la sal? 🌊 ', 5000));
  assert.ok(words.every(word => !word.emphasis));
});

test('empty narration produces no captions', () => {
  assert.deepEqual(estimateWords(' \n\t ', 1000), []);
});

test('longer words receive more speaking time and punctuation creates a pause', () => {
  const [short, long] = estimateWords('a extraordinario', 5000);
  assert.ok(long!.endMs - long!.startMs > short!.endMs - short!.startMs);
  const punctuated = estimateWords('agua, roca mar.', 5000);
  assert.ok(punctuated[1]!.startMs > punctuated[0]!.endMs);
  assert.equal(punctuated[2]!.startMs, punctuated[1]!.endMs);
  assert.ok(punctuated[2]!.endMs < 5000);
});

test('integer monotonic non-overlapping timing fits minimum and maximum scenes at word limit', () => {
  for (const duration of [LIMITS.minSceneMs, LIMITS.maxSceneMs]) {
    const words = estimateWords(Array.from({ length: LIMITS.maxWordsPerScene }, () => 'a,').join(' '), duration);
    assert.equal(words.length, LIMITS.maxWordsPerScene);
    let previousEnd = 0;
    for (const word of words) {
      assert.ok(Number.isInteger(word.startMs) && Number.isInteger(word.endMs));
      assert.ok(word.startMs >= previousEnd && word.endMs > word.startMs && word.endMs <= duration);
      previousEnd = word.endMs;
    }
  }
});

test('single unpunctuated word occupies the full scene', () => {
  assert.deepEqual(estimateWords('mar', 1000), [{ text: 'mar', startMs: 0, endMs: 1000, emphasis: false }]);
});

test('invalid durations and exceeded limits fail explicitly instead of truncating', () => {
  for (const duration of [NaN, Infinity, 0, 999, 15001, 1000.5]) {
    assert.throws(() => estimateWords('mar', duration), RangeError);
  }
  assert.throws(() => estimateWords('a '.repeat(301), 1000), /palabras/);
  assert.throws(() => estimateWords('x'.repeat(LIMITS.maxSceneText + 1), 1000), /texto/);
  assert.throws(() => estimateWords('x'.repeat(81), 1000), /80/);
});
