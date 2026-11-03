import test from 'node:test';
import assert from 'node:assert/strict';

import { canonicalize } from '../../src/shared/canonical.ts';

test('canonicalize matches the RFC 8785 number vector and sorts keys', () => {
  const input = {
    numbers: [333333333.33333329, 1e30, 4.5, 2e-3, 1e-27],
    string: '\u20ac$\u000f\nA\'B"\\\\"/',
    literals: [null, true, false],
  };

  const expected =
    '{"literals":[null,true,false],' +
    '"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],' +
    '"string":' +
    JSON.stringify(input.string) +
    '}';

  assert.equal(canonicalize(input), expected);
  // The RFC vector escapes U+000F as \u000f and keeps non-ASCII literal.
  assert.ok(canonicalize(input).includes('\\u000f'));
  assert.ok(canonicalize(input).includes('\u20ac'));
});

test('canonicalize sorts object keys by UTF-16 code units', () => {
  const keys = ['\u20ac', '\r', '\ufb33', '1', '\ud83d\ude00', '\u0080', '\u00f6'];
  const labels = new Map([
    ['\u20ac', 'Euro Sign'],
    ['\r', 'Carriage Return'],
    ['\ufb33', 'Hebrew Letter Dalet With Dagesh'],
    ['1', 'One'],
    ['\ud83d\ude00', 'Emoji: Grinning Face'],
    ['\u0080', 'Control'],
    ['\u00f6', 'Latin Small Letter O With Diaeresis'],
  ]);

  const input: Record<string, string> = {};
  for (const key of keys) input[key] = labels.get(key)!;

  const sortedKeys = ['\r', '1', '\u0080', '\u00f6', '\u20ac', '\ud83d\ude00', '\ufb33'];
  const expected =
    '{' +
    sortedKeys.map((key) => `${JSON.stringify(key)}:${JSON.stringify(input[key]!)}`).join(',') +
    '}';

  assert.equal(canonicalize(input), expected);
});

test('canonicalize normalizes -0 to 0 and keeps ECMAScript number formatting', () => {
  assert.equal(canonicalize(-0), '0');
  assert.equal(canonicalize([0, -0, 1.5, 1e-7, 1e21, 5e-324]), '[0,0,1.5,1e-7,1e+21,5e-324]');
});

test('canonicalize sorts nested objects and keeps array order', () => {
  const value = {
    b: [{ z: 1, a: 2 }, 'x'],
    a: { d: null, c: [true, false] },
  };
  assert.equal(canonicalize(value), '{"a":{"c":[true,false],"d":null},"b":[{"a":2,"z":1},"x"]}');
});

test('canonicalize rejects values that are not valid JSON data', () => {
  assert.throws(() => canonicalize(undefined), TypeError);
  assert.throws(() => canonicalize({ a: undefined }), TypeError);
  assert.throws(() => canonicalize([undefined]), TypeError);
  assert.throws(() => canonicalize({ a: () => 1 }), TypeError);
  assert.throws(() => canonicalize({ a: Symbol('s') }), TypeError);
  assert.throws(() => canonicalize({ a: 1n }), TypeError);
  assert.throws(() => canonicalize(NaN), TypeError);
  assert.throws(() => canonicalize(Infinity), TypeError);
  assert.throws(() => canonicalize(-Infinity), TypeError);
  assert.throws(() => canonicalize(new Date()), TypeError);
  assert.throws(() => canonicalize(new Map()), TypeError);
});

test('canonicalize rejects cyclic structures instead of recursing forever', () => {
  const value: Record<string, unknown> = { a: 1 };
  value.self = value;
  assert.throws(() => canonicalize(value), TypeError);
});
