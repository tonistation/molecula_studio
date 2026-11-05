import test from 'node:test';
import assert from 'node:assert/strict';
import { fixtureJson } from '../helpers/fixtures.ts';
import { validateProject } from '../../src/shared/schema/validate.ts';
import { applyScriptProposal } from '../../src/shared/script/apply.ts';
import type { ScriptProposal } from '../../src/shared/script/schema.ts';

function project() {
  const result = validateProject(fixtureJson('storyboard'));
  assert.ok(result.ok);
  return result.project;
}
function proposal(): ScriptProposal {
  return { title: 'Sal del mar', sources: [{ title: 'Fuente', url: 'https://example.org' }],
    scenes: [{ title: 'Pregunta', narration: '¿De dónde sale la sal?', visualIntent: 'Un salero', seconds: 2.34 },
      { title: 'Río', narration: 'El río lleva minerales.', visualIntent: 'Río con rocas', seconds: 3.56 }],
    cover: { headline: 'El origen de la sal' }, postText: 'Comparte esta pregunta.' };
}

test('applying a script creates fresh contiguous empty scenes and preserves unrelated settings', () => {
  const input = project();
  const script = proposal();
  const before = structuredClone({ input, script });
  const result = applyScriptProposal(input, script, ['s-new-a', 's-new-b']);
  assert.ok(validateProject(result).ok);
  assert.deepEqual(result, { ...input, title: script.title, sources: script.sources, cover: script.cover, postText: script.postText,
    output: { ...input.output, durationMs: 5900 }, scenes: script.scenes.map((scene, index) => ({
      sceneId: ['s-new-a', 's-new-b'][index], revision: 0, title: scene.title, text: scene.narration,
      visualIntent: scene.visualIntent, startMs: index === 0 ? 0 : 2300, durationMs: index === 0 ? 2300 : 3600,
      visual: null, audio: null, words: [], mediaBindings: { audio: null, words: null },
    })) });
  assert.deepEqual({ input, script }, before);
  assert.deepEqual(applyScriptProposal(input, script, ['s-new-a', 's-new-b']), result);
  result.sources![0]!.title = 'Changed';
  result.entities[0]!.seed += 1;
  assert.deepEqual({ input, script }, before);
});

test('script application rejects reused, duplicate, invalid or missing explicit scene IDs atomically', () => {
  const input = project();
  const before = structuredClone(input);
  for (const ids of [[], ['s-a'], ['s-a', 's-a'], [input.scenes[0]!.sceneId, 's-b'], ['BAD', 's-b'], ['s-a', 's-b', 's-c']]) {
    assert.throws(() => applyScriptProposal(input, proposal(), ids));
    assert.deepEqual(input, before);
  }
});

test('script application revalidates direct proposals and read-only or invalid projects', () => {
  const input = project();
  for (const script of [{ ...proposal(), title: '' }, { ...proposal(), extra: true },
    { ...proposal(), scenes: [{ ...proposal().scenes[0]!, seconds: 15.01 }] }]) {
    assert.throws(() => applyScriptProposal(input, script, ['s-a', 's-b']));
  }
  assert.throws(() => applyScriptProposal({ ...input, seed: -1 }, proposal(), ['s-a', 's-b']));
  assert.throws(() => applyScriptProposal({ ...input, styleId: 'unknown' }, proposal(), ['s-a', 's-b']));
});

test('rounded scene durations cannot silently exceed 60 seconds', () => {
  const input = project();
  const script = proposal();
  script.scenes = [10.051, 10.051, 10.051, 10.051, 10.051, 9.745].map(seconds => ({ ...script.scenes[0]!, seconds }));
  const before = structuredClone({ input, script });
  assert.throws(() => applyScriptProposal(input, script, script.scenes.map((_, i) => `s-${i}`)), /60000|60/);
  assert.deepEqual({ input, script }, before);
  script.scenes = [5.4, 5.4, 5.4, 14.6, 14.6, 14.6].map(seconds => ({ ...script.scenes[0]!, seconds }));
  assert.equal(applyScriptProposal(input, script, script.scenes.map((_, i) => `s-${i}`)).output.durationMs, 60000);
});
