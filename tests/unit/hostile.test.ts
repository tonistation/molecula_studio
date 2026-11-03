import test from 'node:test';
import assert from 'node:assert/strict';

import { LIMITS, parseProjectText } from '../../src/shared/schema/index.ts';
import { fixtureText } from '../helpers/fixtures.ts';

type Failure = 'too-large' | 'too-deep' | 'invalid-json' | 'duplicate-key' | 'dangerous-key' | 'unsupported-version' | 'invalid-schema';

const nested = (depth: number) => `${'{"a":'.repeat(depth)}null${'}'.repeat(depth)}`;

const twoMiB = LIMITS.maxJsonBytes;
const exactlyAtLimit = `{"idea":"${'a'.repeat(twoMiB - 11)}"}`;
const oneByteOver = `{"idea":"${'a'.repeat(twoMiB - 10)}"}`;

const corpus: Array<{ name: string; input: string | Uint8Array; failure: Failure }> = [
  { name: 'truncated JSON', input: '{"schemaVersion": 1, "projectId": "p"', failure: 'invalid-json' },
  { name: 'an unterminated string', input: '{"title":"abc', failure: 'invalid-json' },
  { name: 'single-quoted keys', input: "{'a':1}", failure: 'invalid-json' },
  { name: 'a trailing comma', input: '{"a":1,}', failure: 'invalid-json' },
  { name: 'a missing value', input: '{"a":}', failure: 'invalid-json' },
  { name: 'trailing content', input: '{"schemaVersion":1} x', failure: 'invalid-json' },
  { name: 'a NaN literal', input: '{"a":NaN}', failure: 'invalid-json' },
  { name: 'a non-finite number', input: '{"a":1e999}', failure: 'invalid-json' },
  { name: 'an empty document', input: '', failure: 'invalid-json' },
  { name: 'invalid UTF-8 bytes', input: new Uint8Array([0x7b, 0xff, 0xfe, 0x7d]), failure: 'invalid-json' },
  { name: 'duplicate root keys', input: '{"title":"a","title":"b"}', failure: 'duplicate-key' },
  { name: 'duplicate nested keys', input: '{"a":{"x":1,"x":2}}', failure: 'duplicate-key' },
  { name: 'duplicate keys in an array item', input: '[{"x":1,"x":2}]', failure: 'duplicate-key' },
  { name: 'depth 17', input: nested(17), failure: 'too-deep' },
  { name: 'more than 2 MiB', input: oneByteOver, failure: 'too-large' },
  { name: 'more than 2 MiB in UTF-8 bytes', input: '€'.repeat(1_000_000), failure: 'too-large' },
  { name: 'a nested __proto__ key', input: '{"a":{"__proto__":{"polluted":true}}}', failure: 'dangerous-key' },
  { name: 'a constructor key', input: '{"constructor":{}}', failure: 'dangerous-key' },
  { name: 'a prototype key in an array item', input: '{"a":[{"prototype":1}]}', failure: 'dangerous-key' },
  { name: 'a repeated dangerous key', input: '{"__proto__":1,"__proto__":2}', failure: 'dangerous-key' },
  { name: 'a future schemaVersion', input: '{"schemaVersion":2}', failure: 'unsupported-version' },
  { name: 'a missing schemaVersion', input: '{"title":"x"}', failure: 'invalid-schema' },
  { name: 'schemaVersion zero', input: '{"schemaVersion":0}', failure: 'invalid-schema' },
  { name: 'a string schemaVersion', input: '{"schemaVersion":"1"}', failure: 'invalid-schema' },
  { name: 'a fractional schemaVersion', input: '{"schemaVersion":1.5}', failure: 'invalid-schema' },
  { name: 'an array root', input: '[]', failure: 'invalid-schema' },
  { name: 'a null root', input: 'null', failure: 'invalid-schema' },
  { name: 'a number root', input: '1', failure: 'invalid-schema' },
  { name: 'a string root', input: '"project"', failure: 'invalid-schema' },
  { name: 'a boolean root', input: 'true', failure: 'invalid-schema' },
];

for (const entry of corpus) {
  test(`parse rejects ${entry.name} with ${entry.failure}`, () => {
    const result = parseProjectText(entry.input);
    assert.equal(result.ok, false, `expected failure for ${entry.name}`);
    if (result.ok) return;
    assert.equal(result.failure, entry.failure);
    assert.ok(Array.isArray(result.issues));
    for (const issue of result.issues) {
      assert.equal(typeof issue.path, 'string');
      assert.equal(typeof issue.code, 'string');
      assert.equal(typeof issue.message, 'string');
    }
  });
}

test('the hostile corpus stays bounded in time and never throws', () => {
  const started = performance.now();
  for (const entry of corpus) {
    assert.doesNotThrow(() => parseProjectText(entry.input));
  }
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 5000, `corpus took ${elapsed.toFixed(0)}ms`);
});

test('depth 16 is structurally accepted and then fails schema validation', () => {
  const result = parseProjectText(nested(16));
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure, 'invalid-schema');
});

test('a document exactly at the 2 MiB limit is parsed, not rejected as too large', () => {
  const result = parseProjectText(exactlyAtLimit);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure, 'invalid-schema');
});

test('dangerous keys never pollute object prototypes', () => {
  parseProjectText('{"__proto__":{"polluted":true}}');
  parseProjectText('{"a":{"constructor":{"prototype":{"polluted":true}}}}');
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test('the provided examples are not treated as hostile', () => {
  for (const name of ['empty', 'storyboard']) {
    const result = parseProjectText(fixtureText(name));
    assert.equal(result.ok, true, `${name} should parse`);
  }
});
