import test from 'node:test';
import assert from 'node:assert/strict';
import { sttWordsToWords } from '../../src/shared/voice/alignment.ts';
import { estimateWords } from '../../src/shared/voice/estimate.ts';

const spoken = [
  { text: 'Hola', start: 0.1194, end: 0.3196, type: 'word', logprob: -0.002 },
  { text: ' ', start: 0.32, end: 0.5, type: 'spacing' },
  { text: '(laughing)', start: 0.4, end: 0.5, type: 'audio_event' },
  { text: 'MUNDO', start: 0.5004, end: 0.9996, type: 'word' },
];
test('Vibi real-shaped seconds become integer ms once; captions retain authoritative punctuation and case', () => {
  const warnings: string[] = [];
  assert.deepEqual(sttWordsToWords(spoken, '¡Hola, mundo!', 1000, warning => warnings.push(warning)), [
    { text: '¡Hola,', startMs: 119, endMs: 320, emphasis: false },
    { text: 'mundo!', startMs: 500, endMs: 1000, emphasis: false },
  ]);
  assert.deepEqual(warnings, []);
});
test('extra, missing, different or reordered words fall back visibly without changing scene narration', () => {
  for (const words of [spoken.slice(0, 1), [...spoken, spoken[0]], [...spoken].reverse(),
    [{ ...spoken[0], text: 'Otro' }, ...spoken.slice(1)],
    [{ ...spoken[0], text: 'si' }, { ...spoken[3], text: 'mundo' }]]) {
    const warnings: string[] = [];
    assert.deepEqual(sttWordsToWords(words, 'Hola mundo', 1000, value => warnings.push(value)), estimateWords('Hola mundo', 1000));
    assert.equal(warnings.length, 1);
  }
});
test('invalid, overlapping, out-of-audio or sub-ms collapsed spans fall back; no clipping or hidden sorting', () => {
  for (const change of [{ start: -0.001 }, { start: NaN }, { end: Infinity }, { start: '0.1' },
    { end: 1.001 }, { start: 0.5, end: 0.4 }, { start: 0.1, end: 0.1001 }, { end: 0.6 }]) {
    const warnings: string[] = [];
    assert.deepEqual(sttWordsToWords([{ ...spoken[0], ...change }, spoken[3]], 'Hola mundo', 1000, value => warnings.push(value)), estimateWords('Hola mundo', 1000));
    assert.equal(warnings.length, 1);
  }
  for (const [text, transcript] of [['sí mundo', 'si'], ['lago-mar mundo', 'lagomar'], ['3,5 mundo', '35'], ['-5 mundo', '5'], ['.NET mundo', 'NET']]) {
    assert.deepEqual(sttWordsToWords([{ ...spoken[0], text: transcript }, spoken[3]], text!, 1000), estimateWords(text!, 1000));
  }
});
