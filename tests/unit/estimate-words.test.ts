import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LIMITS } from '../../src/shared/schema/limits.ts';
import { parseProjectText } from '../../src/shared/schema/index.ts';
import { estimateWords } from '../../src/shared/voice/estimate.ts';
import { fixtureText } from '../helpers/fixtures.ts';

test('estimation preserves Unicode text and normalizes whitespace without mutation', () => {
  const words = estimateWords('  ¿De\n dónde  sale la sal? 🌊 ', 5000);
  assert.deepEqual(words.map(word => word.text), ['¿De', 'dónde', 'sale', 'la', 'sal?', '🌊']);
  assert.deepEqual(words, estimateWords('  ¿De\n dónde  sale la sal? 🌊 ', 5000));
  assert.ok(words.every(word => !word.emphasis));
});

test('empty narration produces no captions', () => {
  assert.deepEqual(estimateWords(' \n\t ', 1000), []);
});

test('non-BMP word limits count code points instead of UTF-16 code units', () => {
  for (const length of [50, 80]) {
    const text = '🧂'.repeat(length);
    assert.deepEqual(estimateWords(text, 1000), [{ text, startMs: 0, endMs: 1000, emphasis: false }]);
  }
  assert.throws(() => estimateWords('🧂'.repeat(81), 1000), /80/);
});

test('non-BMP scene text accepts the schema boundary and rejects one code point more', () => {
  const text = Array.from({ length: 25 }, () => '🧂'.repeat(79)).join(' ') + '🧂';
  assert.equal(Array.from(text).length, LIMITS.maxSceneText);
  assert.equal(estimateWords(text, 5000).map(word => word.text).join(' '), text);
  assert.throws(() => estimateWords(text + '🧂', 5000), /texto/);
});

test('schema-valid storyboard narration with non-BMP text can be estimated', () => {
  const parsed = parseProjectText(fixtureText('storyboard'));
  assert.ok(parsed.ok);
  const project = parsed.project;
  const scene = project.scenes[0]!;
  scene.text = '🧂'.repeat(50);
  scene.words = [];
  scene.mediaBindings = { audio: null, words: null };
  const validated = parseProjectText(JSON.stringify(project));
  assert.ok(validated.ok);
  assert.equal(estimateWords(validated.project.scenes[0]!.text, scene.durationMs)[0]!.text, scene.text);
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
  for (const duration of [NaN, Infinity, 0, 15001, 1000.5]) {
    assert.throws(() => estimateWords('mar', duration), RangeError);
  }
  assert.throws(() => estimateWords('a '.repeat(301), 1000), /palabras/);
  assert.throws(() => estimateWords('x'.repeat(LIMITS.maxSceneText + 1), 1000), /texto/);
  assert.throws(() => estimateWords('x'.repeat(81), 1000), /80/);
});

test('audio shorter than a scene is estimated over its actual duration, rejecting impossible word density', () => {
  assert.deepEqual(estimateWords('mar', 240), [{ text: 'mar', startMs: 0, endMs: 240, emphasis: false }]);
  assert.throws(() => estimateWords('a b', 1), /duración/);
});
