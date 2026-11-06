import test from 'node:test';
import assert from 'node:assert/strict';
import { narrationScript, voiceStatuses } from '../../studio/src/voice-model.ts';
import { bindingDigests } from '../../src/shared/digests.ts';
import { parseProjectText } from '../../src/shared/schema/index.ts';
import { fixtureText } from '../helpers/fixtures.ts';
import { serializeProject } from '../../src/shared/schema/index.ts';

test('voice UI uses numbered narration and actual bindings; text changes invalidate only that scene', async () => {
  const result = parseProjectText(fixtureText('storyboard'));
  assert.ok(result.ok);
  const project = result.project;
  assert.equal(narrationScript(project), project.scenes.map((s, i) => `${i + 1}. ${s.title}\n${s.text}`).join('\n\n'));
  assert.deepEqual(Object.values(await voiceStatuses(project, [])), ['sin voz', 'sin voz']);
  project.output.voiceMode = 'withVoice';
  project.assets.push({ assetId: 'voice', kind: 'audio', path: 'assets/voice.wav', mimeType: 'audio/wav',
    sha256: 'a'.repeat(64), byteLength: 32044, durationMs: 1000,
    source: { origin: 'fixture', license: 'Test only', attribution: '' } });
  for (const scene of project.scenes) scene.audio = { assetId: 'voice', offsetMs: 0, gainDb: 0 };
  const expected = await bindingDigests(project);
  project.scenes.forEach((s, i) => {
    const b = expected.scenes[i]!;
    s.mediaBindings = { audio: { inputDigest: b.audioInputDigest!, outputDigest: b.audioOutputDigest! },
      words: b.wordsInputDigest === null ? null : { inputDigest: b.wordsInputDigest, outputDigest: b.wordsOutputDigest! } };
  });
  assert.deepEqual(Object.values(await voiceStatuses(project, [])), ['lista', 'lista']);
  project.scenes[0]!.text = 'Narración nueva';
  assert.deepEqual(Object.values(await voiceStatuses(project, [])), ['desactualizada', 'lista']);
  assert.deepEqual(Object.values(await voiceStatuses(project, ['voice'])), ['desactualizada', 'desactualizada']);
});

test('voice status preserves history and follows global locale, timing and media projections, not editorial edits', async () => {
  const parsed = parseProjectText(fixtureText('storyboard'));
  assert.ok(parsed.ok);
  const project = parsed.project;
  project.output.voiceMode = 'withVoice';
  project.assets.push({ assetId: 'voice', kind: 'audio', path: 'assets/voice.wav', mimeType: 'audio/wav',
    sha256: 'a'.repeat(64), byteLength: 32044, durationMs: 1000,
    source: { origin: 'fixture', license: 'Test only', attribution: '' } });
  for (const scene of project.scenes) scene.audio = { assetId: 'voice', offsetMs: 0, gainDb: 0 };
  const expected = await bindingDigests(project);
  project.scenes.forEach((scene, index) => {
    const binding = expected.scenes[index]!;
    scene.mediaBindings = { audio: { inputDigest: binding.audioInputDigest!, outputDigest: binding.audioOutputDigest! },
      words: { inputDigest: binding.wordsInputDigest!, outputDigest: binding.wordsOutputDigest! } };
  });
  const original = serializeProject(project);
  const history = project.scenes.map(scene => structuredClone(scene.mediaBindings));
  const check = async (edit: (copy: typeof project) => void, values: string[]) => {
    const copy = structuredClone(project);
    edit(copy);
    const before = JSON.stringify(copy);
    assert.deepEqual(Object.values(await voiceStatuses(copy, [])), values);
    assert.equal(JSON.stringify(copy), before, 'comparison never repairs or mutates its input');
    assert.deepEqual(copy.scenes.map(scene => scene.mediaBindings), history);
  };
  await check(copy => { copy.locale = 'en'; }, ['desactualizada', 'desactualizada']);
  await check(copy => { copy.title = 'Nuevo título'; copy.idea = 'Otra idea'; copy.scenes[0]!.visual = null; }, ['lista', 'lista']);
  await check(copy => { copy.scenes[0]!.audio!.gainDb = -6; }, ['desactualizada', 'lista']);
  await check(copy => { copy.scenes[0]!.audio!.offsetMs = 100; }, ['desactualizada', 'lista']);
  await check(copy => { copy.scenes[0]!.durationMs = 500; }, ['desactualizada', 'lista']);
  await check(copy => { copy.scenes[0]!.durationMs += 100; }, ['lista', 'lista']);
  await check(copy => { copy.scenes[0]!.words[0]!.emphasis = !copy.scenes[0]!.words[0]!.emphasis; }, ['desactualizada', 'lista']);
  await check(copy => { copy.assets.find(asset => asset.assetId === 'voice')!.sha256 = 'b'.repeat(64); }, ['desactualizada', 'desactualizada']);
  assert.equal(serializeProject(project), original);
  project.scenes[0]!.text = 'Narración nueva';
  const reopened = parseProjectText(serializeProject(project));
  assert.ok(reopened.ok);
  assert.deepEqual(Object.values(await voiceStatuses(reopened.project, [])), ['desactualizada', 'lista']);
  assert.deepEqual(reopened.project.scenes.map(scene => scene.mediaBindings), history);
});
