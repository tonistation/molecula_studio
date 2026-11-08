import test from 'node:test';
import assert from 'node:assert/strict';
import { sttWordsToWords } from '../../src/shared/voice/alignment.ts';
import { estimateWords } from '../../src/shared/voice/estimate.ts';
import type { AlignmentDiagnostic } from '../../src/shared/voice/alignment.ts';

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

const diagnosticCases: [string, unknown, number?][] = [
  ['invalid-response', null],
  ['entry-limit', new Array(5001).fill(null)],
  ['word-count-mismatch', spoken.slice(0, 1)],
  ['text-mismatch', [{ ...spoken[0], text: 'PRIVATE https://secret.test' }, spoken[3]], 0],
  ['text-mismatch', [{ ...spoken[0], text: null }, spoken[3]], 0],
  ['invalid-time', [{ ...spoken[0], start: NaN }, spoken[3]], 0],
  ['invalid-time', [{ ...spoken[0], end: Infinity }, spoken[3]], 0],
  ['invalid-time', [{ ...spoken[0], start: '0.1' }, spoken[3]], 0],
  ['negative-time', [{ ...spoken[0], start: -0.01 }, spoken[3]], 0],
  ['negative-time', [{ ...spoken[0], end: -0.01 }, spoken[3]], 0],
  ['invalid-interval', [{ ...spoken[0], end: 0.1 }, spoken[3]], 0],
  ['overlap', [{ ...spoken[0], end: 0.6 }, spoken[3]], 1],
  ['out-of-range', [spoken[0], { ...spoken[3], end: 1.001 }], 1],
  ['rounding-collapse', [{ ...spoken[0], start: 0.1, end: 0.1001 }, spoken[3]], 0],
];
for (const [caseIndex, [reason, input, wordIndex]] of diagnosticCases.entries()) {
  test(`alignment diagnostic ${reason} is safe, deterministic and preserves fallback/input (${caseIndex})`, t => {
    const logs: unknown[][] = [];
    for (const method of ['log', 'warn', 'error'] as const) t.mock.method(console, method, (...args: unknown[]) => { logs.push(args); });
    const before = structuredClone(input);
    const diagnostics: AlignmentDiagnostic[] = []; const warnings: string[] = [];
    const run = () => sttWordsToWords(input, 'Hola mundo', 1000, value => warnings.push(value), value => diagnostics.push(value));
    assert.deepEqual(run(), estimateWords('Hola mundo', 1000));
    assert.deepEqual(run(), estimateWords('Hola mundo', 1000));
    assert.deepEqual(input, before);
    assert.deepEqual(diagnostics[0], diagnostics[1]);
    assert.equal(diagnostics[0]!.reason, reason);
    assert.equal(diagnostics[0]!.wordIndex, wordIndex);
    assert.equal(diagnostics[0]!.expectedWordCount, 2);
    assert.equal(diagnostics[0]!.durationMs, 1000);
    assert.match(warnings[0]!, new RegExp(`\\[${reason}\\]`));
    assert.match(warnings[0]!, /estimados, no alineación real/);
    assert.doesNotMatch(JSON.stringify({ diagnostics, warnings }), /PRIVATE|secret|Hola|mundo|https|NaN|Infinity/);
    assert.ok(JSON.stringify(diagnostics[0]).length < 220);
    assert.deepEqual(logs, []);
  });
}

test('accepted STT emits no diagnostic and counts only words without mutating ignored entries', () => {
  const input = structuredClone(spoken); const before = structuredClone(input);
  const diagnostics: AlignmentDiagnostic[] = [];
  const result = sttWordsToWords(input, '¡Hola, mundo!', 1000, undefined, value => diagnostics.push(value));
  assert.equal(result[0]!.startMs, 119);
  assert.deepEqual(input, before); assert.deepEqual(diagnostics, []);
});

test('diagnostic counts distinguish ignored entries and bound the maximum accepted provider array', () => {
  const input = [null, 5, {}, { type: 'spacing', text: 'PRIVATE' }, spoken[0]];
  let diagnostic: AlignmentDiagnostic | undefined;
  sttWordsToWords(input, 'Hola mundo', 1000, undefined, value => { diagnostic = value; });
  assert.deepEqual(diagnostic, { reason: 'word-count-mismatch', expectedWordCount: 2, durationMs: 1000, receivedEntryCount: 5, spokenWordCount: 1 });
  const maximum = [...spoken, ...new Array(4996).fill({ type: 'audio_event', text: 'PRIVATE' })];
  sttWordsToWords(maximum, 'Hola mundo', 1000, undefined, () => assert.fail('valid words at cap must remain accepted'));
  const oversized = new Array(5001);
  Object.defineProperty(oversized, '0', { get: () => assert.fail('oversized input must not be traversed') });
  sttWordsToWords(oversized, 'Hola mundo', 1000, undefined, value => { diagnostic = value; });
  assert.deepEqual(diagnostic, { reason: 'entry-limit', expectedWordCount: 2, durationMs: 1000 });
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
