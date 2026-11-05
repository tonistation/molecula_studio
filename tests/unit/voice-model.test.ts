import test from 'node:test';
import assert from 'node:assert/strict';
import { narrationScript, voiceStatuses } from '../../studio/src/voice-model.ts';
import { bindingDigests } from '../../src/shared/digests.ts';
import { parseProjectText } from '../../src/shared/schema/index.ts';
import { fixtureText } from '../helpers/fixtures.ts';

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
