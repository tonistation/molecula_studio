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
  ['invalid-interval', [{ ...spoken[0], end: 0.1 }, { ...spoken[3], start: 0 }], 0],
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
    { end: 1.001 }, { start: 0.1, end: 0.1001 }, { end: 0.6 }]) {
    const warnings: string[] = [];
    assert.deepEqual(sttWordsToWords([{ ...spoken[0], ...change }, spoken[3]], 'Hola mundo', 1000, value => warnings.push(value)), estimateWords('Hola mundo', 1000));
    assert.equal(warnings.length, 1);
  }
  for (const [text, transcript] of [['sí mundo', 'si'], ['lago-mar mundo', 'lagomar'], ['3,5 mundo', '35'], ['-5 mundo', '5'], ['.NET mundo', 'NET']]) {
    assert.deepEqual(sttWordsToWords([{ ...spoken[0], text: transcript }, spoken[3]], text!, 1000), estimateWords(text!, 1000));
  }
});

test('synthetic 14-word/27-entry tail defect preserves 12 anchors and repairs only the final two words', () => {
  // Structural reproduction only: not a retained transcript or timestamps from the real trial.
  const tokens = Array.from({ length: 14 }, (_, i) => `palabra${i}`);
  const input = tokens.flatMap((text, i) => [
    { text, type: 'word', start: i < 12 ? i * 0.3 : 4.96, end: i < 12 ? i * 0.3 + 0.2 : 4.959 },
    ...(i < 13 ? [{ text: ' ', type: 'spacing', start: 0, end: 0 }] : []),
  ]);
  const before = structuredClone(input); const diagnostics: AlignmentDiagnostic[] = []; const warnings: string[] = [];
  const words = sttWordsToWords(input, tokens.join(' '), 4963, value => warnings.push(value), value => diagnostics.push(value));
  assert.deepEqual(words.slice(0, 12), tokens.slice(0, 12).map((text, i) => ({ text, startMs: Math.round(i * 300), endMs: Math.round(i * 300 + 200), emphasis: false })));
  assert.deepEqual(words.slice(12), estimateWords(tokens.slice(12).join(' '), 1463).map(word => ({ ...word, startMs: word.startMs + 3500, endMs: word.endMs + 3500 })));
  assert.deepEqual(diagnostics, [{ reason: 'invalid-interval', expectedWordCount: 14, receivedEntryCount: 27, spokenWordCount: 14, durationMs: 4963, wordIndex: 12, repairedWordCount: 2 }]);
  assert.match(warnings[0]!, /Alineación parcial:.*2 palabras con tiempos estimados/);
  assert.doesNotMatch(warnings[0]!, /no alineación real/);
  assert.deepEqual(input, before);
});

test('bounded middle, leading and tiny tail repairs use the existing estimator without shifting rounded anchors', () => {
  for (const [input, expected] of [
    [[{ text: 'uno', start: 0.1004, end: 0.2004 }, { text: 'dos,', start: 0.3, end: 0.3 }, { text: 'tres', start: 0.6004, end: 0.9004 }],
      [{ text: 'uno', startMs: 100, endMs: 200, emphasis: false }, ...estimateWords('dos,', 400).map(word => ({ ...word, startMs: word.startMs + 200, endMs: word.endMs + 200 })), { text: 'tres', startMs: 600, endMs: 900, emphasis: false }]],
    [[{ text: 'uno', start: 0.8, end: 0.7 }, { text: 'dos,', start: 0.4, end: 0.5 }, { text: 'tres', start: 0.7, end: 0.9 }],
      [...estimateWords('uno', 400), { text: 'dos,', startMs: 400, endMs: 500, emphasis: false }, { text: 'tres', startMs: 700, endMs: 900, emphasis: false }]],
    [[{ text: 'uno', start: 0, end: 0.998 }, { text: 'dos,', start: 1, end: 1 }, { text: 'tres', start: 1, end: 1 }],
      [{ text: 'uno', startMs: 0, endMs: 998, emphasis: false }, { text: 'dos,', startMs: 998, endMs: 999, emphasis: false }, { text: 'tres', startMs: 999, endMs: 1000, emphasis: false }]],
  ] as const) {
    const words = sttWordsToWords(input.map(word => ({ ...word, type: 'word' })), 'uno dos, tres', 1000);
    assert.deepEqual(words, expected);
    assert.ok(words.every((word, i) => word.endMs > word.startMs && word.endMs <= 1000 && word.startMs >= (words[i - 1]?.endMs ?? 0)));
  }
});

test('unsafe defects, malformed entries, absent anchors or insufficient free milliseconds retain complete fallback', () => {
  const valid = { text: 'uno', type: 'word', start: 0, end: 0.999 };
  const invalid = { text: 'dos', type: 'word', start: 1, end: 1 };
  for (const input of [
    [valid, invalid, { ...invalid, text: 'tres' }],
    [{ ...valid, end: 0 }, invalid, { ...invalid, text: 'tres' }],
    [valid, { ...invalid, start: NaN }, { ...invalid, text: 'tres' }],
    [valid, { ...invalid, end: -1 }, { ...invalid, text: 'tres' }],
    [valid, { ...invalid, start: 1.01 }, { ...invalid, text: 'tres' }],
    [valid, { ...invalid, text: 'otro' }, { ...invalid, text: 'tres' }],
    [valid, invalid, { text: 'tres', type: 'word', start: 0.9, end: 1 }],
    [valid, invalid, { text: 'tres', type: 'word', start: 0.9991, end: 0.9992 }],
    [valid, { type: 'word' }, { ...invalid, text: 'tres' }],
  ]) {
    const diagnostics: AlignmentDiagnostic[] = [];
    assert.deepEqual(sttWordsToWords(input, 'uno dos tres', 1000, undefined, value => diagnostics.push(value)), estimateWords('uno dos tres', 1000));
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0]!.repairedWordCount, undefined);
  }
});

test('separate repairs are deterministic and atomic: one cramped gap rejects the entire partial result', t => {
  const logs: unknown[][] = [];
  for (const method of ['log', 'warn', 'error'] as const) t.mock.method(console, method, (...args: unknown[]) => { logs.push(args); });
  const input = [
    { text: 'uno', start: 0.1, end: 0.1, type: 'word' },
    { text: 'dos', start: 0.2, end: 0.4, type: 'word' },
    { text: 'tres', start: 0.5, end: 0.5, type: 'word' },
    { text: 'cuatro', start: 0.6, end: 0.8, type: 'word' },
  ];
  const before = structuredClone(input); const diagnostics: AlignmentDiagnostic[] = [];
  const run = () => sttWordsToWords(input, 'uno dos tres cuatro', 1000, undefined, value => diagnostics.push(value));
  const result = run(); assert.deepEqual(run(), result); assert.deepEqual(input, before);
  assert.deepEqual(result.map(word => [word.startMs, word.endMs]), [[0, 200], [200, 400], [400, 600], [600, 800]]);
  assert.deepEqual(diagnostics[0], diagnostics[1]); assert.equal(diagnostics[0]!.repairedWordCount, 2);
  assert.doesNotMatch(JSON.stringify(diagnostics), /uno|dos|tres|cuatro|https/);
  for (const cramped of [
    input.map((word, i) => i === 1 ? { ...word, start: 0 } : word),
    input.map((word, i) => i === 3 ? { ...word, start: 0.4001 } : word),
  ]) {
    let diagnostic: AlignmentDiagnostic | undefined;
    assert.deepEqual(sttWordsToWords(cramped, 'uno dos tres cuatro', 1000, undefined, value => { diagnostic = value; }), estimateWords('uno dos tres cuatro', 1000));
    assert.equal(diagnostic?.reason, 'invalid-interval'); assert.equal(diagnostic?.repairedWordCount, undefined);
  }
  assert.deepEqual(logs, []);
});
