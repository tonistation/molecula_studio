import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyProject } from '../../src/shared/schema/empty.ts';
import { parseVectorResponse } from '../../src/shared/vector/parse.ts';
import { parseMotionResponse } from '../../src/shared/motion/parse.ts';
import { applyVectorVisual } from '../../src/shared/vector/apply.ts';
import { buildVectorPrompt } from '../../src/shared/vector/prompt.ts';
import { vectorOutputSchema } from '../../src/shared/vector/output-schema.ts';
import { validateVectorVisual } from '../../src/shared/vector/validate.ts';

const layer = { id: 'shape', type: 'rect', position: [2160, 1920], rotation: 0, scale: 1, opacity: 1, startMs: 0, endMs: 1000, fill: '#123456', width: 100, height: 200, animations: [] };
const visual = { kind: 'vector', version: 1, background: '#FFFFFF', layers: [layer] };
const project = () => ({ ...emptyProject({ projectId: 'test', now: '2026-01-01T00:00:00Z' }), schemaVersion: 3 as const,
  styleId: 'vector-2d', output: { ...emptyProject({ projectId: 'test', now: '2026-01-01T00:00:00Z' }).output, durationMs: 1000 },
  scenes: [{ sceneId: 'scene', revision: 0, title: 'Escena', startMs: 0, durationMs: 1000, text: 'hola', visualIntent: 'sol', visual: null, audio: null, words: [], mediaBindings: { audio: null, words: null } }] });

test('flat parsing uses strict bounded JSON and validates kind and extras', () => {
  assert.equal(parseVectorResponse('```json\n' + JSON.stringify(visual) + '\n```', 1000).ok, true);
  assert.equal(parseMotionResponse(JSON.stringify(visual), 1000).ok, false);
  assert.equal(parseVectorResponse('{"kind":"vector","kind":"vector"}', 1000).ok, false);
  assert.equal(parseVectorResponse(JSON.stringify({ ...visual, extra: 1 }), 1000).ok, false);
});
test('generation rejects blank visuals while persisted scenes may be intentionally blank', () => {
  const blank = { ...visual, layers: [] };
  assert.equal(validateVectorVisual(blank, 1000).ok, true);
  const parsed = parseVectorResponse(JSON.stringify(blank), 1000);
  assert.equal(parsed.ok, false);
  if (!parsed.ok) assert.match(parsed.errors.join(' '), /al menos una capa/);
  assert.equal(parseMotionResponse(JSON.stringify({ ...blank, kind: 'motion' }), 1000).ok, false);
  const p = project(); const before = structuredClone(p);
  assert.throws(() => applyVectorVisual(p, 'scene', blank));
  assert.deepEqual(p, before);
});
test('generation schema uses safe common coordinate bounds and requires layers', () => {
  const schema = vectorOutputSchema(1000) as { $defs: { point: { items: { minimum: number; maximum: number } } }; properties: { layers: { minItems: number } } };
  assert.equal(schema.$defs.point.items.minimum, -2160);
  assert.equal(schema.$defs.point.items.maximum, 2160);
  assert.equal(schema.properties.layers.minItems, 1);
  assert.equal(parseVectorResponse(JSON.stringify(visual), 1000).ok, true);
});
test('application is pure and prompt includes exact schema', () => {
  const p = project(); const before = structuredClone(p);
  const out = applyVectorVisual(p, 'scene', visual);
  assert.deepEqual(p, before); assert.equal(out.scenes[0]?.revision, 1);
  assert.throws(() => applyVectorVisual(p, 'missing', visual));
  assert.throws(() => applyVectorVisual({ ...p, styleId: 'motion-graphics' }, 'scene', visual));
  assert.ok(buildVectorPrompt({ scene: p.scenes[0]!, previousScenes: [] }).endsWith(JSON.stringify(vectorOutputSchema(1000))));
});
