import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyProject } from '../../src/shared/schema/empty.ts';
import { parseProjectText } from '../../src/shared/schema/parse.ts';
import { serializeProject } from '../../src/shared/schema/serialize.ts';
import { validateVectorVisual } from '../../src/shared/vector/validate.ts';
import { validateProject } from '../../src/shared/schema/validate.ts';

const base = () => ({ ...emptyProject({ projectId: 'test', now: '2026-01-01T00:00:00Z' }),
  output: { ...emptyProject({ projectId: 'test', now: '2026-01-01T00:00:00Z' }).output, durationMs: 1000 },
  scenes: [{ sceneId: 'scene', revision: 0, title: 'Scene', startMs: 0, durationMs: 1000, text: '', visualIntent: '', visual: null, audio: null, words: [], mediaBindings: { audio: null, words: null } }] });
const layer = { id: 'shape', type: 'rect', position: [540, 960], rotation: 0, scale: 1, opacity: 1,
  startMs: 0, endMs: 1000, fill: '#123456', width: 100, height: 200, animations: [] };
const parse = (value: unknown) => parseProjectText(JSON.stringify(value));

test('legacy colliding style remains opaque, including after serialization', () => {
  const raw = { ...base(), styleId: 'vector-2d', scenes: [{ ...base().scenes[0], visual: { kind: 'old', payload: { arbitrary: 'preserved' } } }] };
  const result = parse(raw);
  assert.ok(result.ok); assert.equal(result.mode, 'read-only'); assert.equal(result.project.schemaVersion, 2);
  const again = parseProjectText(serializeProject(result.project));
  assert.ok(again.ok); assert.equal(again.mode, 'read-only');
  assert.deepEqual(JSON.parse(serializeProject(again.project)).scenes[0].visual, raw.scenes[0]!.visual);
});

test('schema 3 recognizes vector and motion, preserving other project data', () => {
  for (const [styleId, kind] of [['vector-2d', 'vector'], ['motion-graphics', 'motion']] as const) {
    const raw = { ...base(), schemaVersion: 3, styleId, sources: [{ title: 'Source', url: 'https://example.org' }],
      scenes: [{ ...base().scenes[0], visual: { kind, version: 1, background: '#FFFFFF', layers: [layer] } }] };
    const result = parse(raw); assert.ok(result.ok, JSON.stringify(result)); assert.equal(result.mode, 'editable');
    assert.deepEqual(JSON.parse(serializeProject(result.project)).scenes[0].visual, raw.scenes[0]!.visual);
    assert.deepEqual(result.project.sources, raw.sources);
  }
});

test('schema 3 rejects wrong kind, extra fields and invalid timing', () => {
  for (const visual of [
    { kind: 'motion', version: 1, background: '#FFFFFF', layers: [] },
    { kind: 'vector', version: 1, background: '#FFFFFF', layers: [{ ...layer, url: 'https://example.org' }] },
    { kind: 'vector', version: 1, background: '#FFFFFF', layers: [{ ...layer, endMs: 1001 }] },
    { kind: 'code', version: 1, background: '#FFFFFF', layers: [] },
  ]) {
    const result = parse({ ...base(), schemaVersion: 3, styleId: 'vector-2d', scenes: [{ ...base().scenes[0], visual }] });
    assert.equal(result.ok, false);
  }
});

test('motion accepts a bounded animated counter; vector does not', () => {
  const counter = { ...layer, type: 'counter', from: 0, to: 100, fontId: 'builtin-sans-heavy-v1', fontSize: 64,
    animations: [{ type: 'fade', startMs: 0, endMs: 500, easing: 'ease-out', from: 0, to: 1 }] } as Record<string, unknown>;
  delete counter.width; delete counter.height;
  for (const [styleId, kind, valid] of [['motion-graphics', 'motion', true], ['vector-2d', 'vector', false]] as const) {
    const result = parse({ ...base(), schemaVersion: 3, styleId, scenes: [{ ...base().scenes[0], visual: { kind, version: 1, background: '#FFFFFF', layers: [counter] } }] });
    assert.equal(result.ok, valid);
  }
});

test('standalone validator rejects getters without invoking them', () => {
  let invoked = false;
  const visual = { kind: 'vector', version: 1, background: '#FFFFFF', layers: [] };
  Object.defineProperty(visual, 'background', { enumerable: true, get() { invoked = true; return '#FFFFFF'; } });
  assert.equal(validateVectorVisual(visual, 1000).ok, false);
  assert.equal(invoked, false);
});

test('hostile array prototypes, indices, properties and sparse arrays are rejected without invoking getters', () => {
  for (const makeArray of [
    (hit: () => void) => { const arr = [layer]; const proto = Object.create(Array.prototype); Object.defineProperty(proto, 'slice', { get() { hit(); throw new Error('executed'); } }); Object.setPrototypeOf(arr, proto); return arr; },
    (hit: () => void) => { const arr = [layer]; Object.defineProperty(arr, '0', { enumerable: true, get() { hit(); throw new Error('executed'); } }); return arr; },
    (hit: () => void) => { const arr = [layer]; Object.defineProperty(arr, 'extra', { enumerable: true, get() { hit(); throw new Error('executed'); } }); return arr; },
    () => Array(1),
  ]) {
    let calls = 0;
    const visual = { kind: 'vector', version: 1, background: '#FFFFFF', layers: makeArray(() => { calls++; }) };
    const project = { ...base(), schemaVersion: 3, styleId: 'vector-2d', scenes: [{ ...base().scenes[0], visual }] };
    assert.doesNotThrow(() => assert.equal(validateVectorVisual(visual, 1000).ok, false));
    assert.doesNotThrow(() => assert.equal(validateProject(project).ok, false));
    assert.equal(calls, 0);
  }
});

test('vector and motion text rejects markup and URL schemes but permits ordinary comparisons', () => {
  const textLayer = { id: 'text', type: 'text', position: [100, 200], rotation: 0, scale: 1, opacity: 1,
    startMs: 0, endMs: 1000, fill: '#123456', animations: [], fontId: 'builtin-sans-heavy-v1', fontSize: 64 };
  for (const [styleId, kind] of [['vector-2d', 'vector'], ['motion-graphics', 'motion']] as const) {
    for (const [text, expected] of [['<script>alert(1)</script> https://evil.example', false], ['HTTPS://evil.example', false], ['javascript:alert(1)', false], ['<img src=x>', false], ['x < 5; ¡sí! −3 y +4', true], ['a < b y 5 > 4', true]] as const) {
      const visual = { kind, version: 1, background: '#FFFFFF', layers: [{ ...textLayer, text }] };
      const result = validateProject({ ...base(), schemaVersion: 3, styleId, scenes: [{ ...base().scenes[0], visual }] });
      assert.equal(result.ok, expected, `${kind}: ${text}`);
    }
  }
});

test('layer interval contains at least one half-open scene-local 30fps sample', () => {
  for (const [startMs, endMs, expected] of [[1, 2, false], [0, 1, true], [1, 34, true], [34, 66, false], [34, 67, true], [999, 1000, false]] as const) {
    const visual = { kind: 'vector', version: 1, background: '#FFFFFF', layers: [{ ...layer, startMs, endMs }] };
    assert.equal(validateVectorVisual(visual, 1000).ok, expected, `${startMs}–${endMs}`);
  }
  const visual = { kind: 'vector', version: 1, background: '#FFFFFF', layers: [{ ...layer,
    animations: [{ type: 'fade', startMs: 1, endMs: 2, easing: 'linear', from: 0, to: 1 }] }] };
  assert.equal(validateVectorVisual(visual, 1000).ok, true);
});
