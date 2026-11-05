import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Word } from '../../src/shared/schema/types.ts';
import { captionFontSize, captionPhrases, phraseAt } from '../../src/video/captions/phrases.ts';

const words = (count: number): Word[] => Array.from({ length: count }, (_, index) => ({
  text: `palabra${index}`, startMs: index * 200, endMs: index * 200 + 150, emphasis: index === 1,
}));

test('phrases contain two to five words without orphaning a final word', () => {
  for (let count = 2; count <= 30; count++) {
    const input = words(count);
    const pages = captionPhrases(input);
    assert.ok(pages.every(page => page.words.length >= 2 && page.words.length <= 5));
    assert.deepEqual(pages.flatMap(page => page.words), input);
  }
  assert.deepEqual(captionPhrases([]), []);
  assert.equal(captionPhrases(words(1))[0]!.words.length, 1);
});

test('punctuation does not leave an orphan and timing/emphasis remain unchanged', () => {
  const input = words(3);
  input[1]!.text = 'mar.';
  const before = structuredClone(input);
  assert.equal(captionPhrases(input).length, 1);
  assert.deepEqual(input, before);
});

test('phrase lookup is deterministic, half-open, and blank outside supplied word ranges', () => {
  const pages = captionPhrases(words(8));
  assert.equal(phraseAt(pages, -1), null);
  assert.equal(phraseAt(pages, 0), pages[0]);
  assert.equal(phraseAt(pages, 950), null);
  assert.equal(phraseAt(pages, 1000), pages[1]);
  assert.equal(phraseAt(pages, 1550), null);
  const first = phraseAt(pages, 210);
  phraseAt(pages, 1100);
  assert.deepEqual(phraseAt(pages, 210), first);
});

test('dense long captions fit conservatively without enlarging normal captions', () => {
  assert.equal(captionFontSize(words(2), 48, 816, 500), 48);
  const dense = words(5).map(word => ({ ...word, text: 'W'.repeat(80) }));
  assert.ok(captionFontSize(dense, 120, 576, 500) < 24);
});
