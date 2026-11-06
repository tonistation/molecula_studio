import test from 'node:test';
import assert from 'node:assert/strict';
import { parseProjectText } from '../../src/shared/schema/index.ts';
import { serializeProject } from '../../src/shared/schema/serialize.ts';
import { bindingDigests } from '../../src/shared/digests.ts';
import { workflowStates } from '../../studio/src/workflow-model.ts';
import { fixtureText } from '../helpers/fixtures.ts';

function storyboard() {
  const result = parseProjectText(fixtureText('storyboard'));
  assert.ok(result.ok);
  return result.project;
}

function voicedStoryboard() {
  const project = storyboard();
  project.output.voiceMode = 'withVoice';
  project.assets.push({ assetId: 'workflow_voice', kind: 'audio', path: 'assets/workflow_voice.wav',
    mimeType: 'audio/wav', byteLength: 100, sha256: 'a'.repeat(64), durationMs: 6000,
    source: { origin: 'fixture', license: 'Test fixture', attribution: '' } });
  project.scenes.forEach(scene => { scene.audio = { assetId: 'workflow_voice', offsetMs: 0, gainDb: 0 }; });
  return project;
}

test('workflow derives pending content, complete silent path and optional voice without mutation', async () => {
  const project = storyboard();
  project.output.voiceMode = 'silent';
  const before = structuredClone(project);
  assert.deepEqual(await workflowStates(project, []), ['ready', 'ready', 'ready', 'ready']);
  assert.deepEqual(project, before);
  project.idea = ' ';
  project.scenes = [];
  project.output.durationMs = 0;
  assert.deepEqual(await workflowStates(project, []), ['pending', 'pending', 'ready', 'pending']);
});

test('workflow separates missing drawings, unsupported style and partial narration from voice', async () => {
  const project = storyboard();
  project.output.voiceMode = 'silent';
  project.scenes[0]!.visual = null;
  assert.deepEqual(await workflowStates(project, []), ['ready', 'ready', 'ready', 'pending']);
  project.scenes[0]!.text = ' ';
  assert.equal((await workflowStates(project, []))[1], 'pending');
  project.styleVersion = 999;
  assert.equal((await workflowStates(project, []))[0], 'pending');
  assert.equal((await workflowStates(project, []))[3], 'pending');
});

test('workflow voice bindings survive serialization and only dependent steps become outdated after text edits', async () => {
  const project = voicedStoryboard();
  assert.ok(project.scenes.every(scene => scene.audio), 'fixture has attached voice');
  const digests = await bindingDigests(project);
  project.scenes.forEach((scene, index) => {
    const expected = digests.scenes[index]!;
    scene.mediaBindings.audio = { inputDigest: expected.audioInputDigest!, outputDigest: expected.audioOutputDigest! };
    scene.mediaBindings.words = { inputDigest: expected.wordsInputDigest!, outputDigest: expected.wordsOutputDigest! };
  });
  assert.deepEqual(await workflowStates(project, []), ['ready', 'ready', 'ready', 'ready']);
  const saved = parseProjectText(serializeProject(project));
  assert.ok(saved.ok, JSON.stringify(saved));
  assert.deepEqual(await workflowStates(saved.project, []), await workflowStates(project, []));
  project.scenes[0]!.text = 'La narración ahora cuenta otra historia.';
  assert.deepEqual(await workflowStates(project, []), ['ready', 'ready', 'outdated', 'outdated']);
  const reopened = parseProjectText(serializeProject(project));
  assert.ok(reopened.ok);
  assert.deepEqual(await workflowStates(reopened.project, []), ['ready', 'ready', 'outdated', 'outdated']);
  project.output.voiceMode = 'silent';
  assert.deepEqual(await workflowStates(project, []), ['ready', 'ready', 'ready', 'ready']);
});

test('workflow reports missing voice as pending and unavailable attached media as outdated', async () => {
  const project = voicedStoryboard();
  assert.equal((await workflowStates(project, [project.scenes[0]!.audio!.assetId]))[2], 'outdated');
  project.scenes.forEach(scene => { scene.audio = null; });
  assert.deepEqual((await workflowStates(project, [])).slice(2), ['pending', 'pending']);
});

test('workflow does not mark unrenderable intermediate captions or inert visuals ready', async () => {
  const project = storyboard();
  project.output.voiceMode = 'silent';
  project.scenes[0]!.text = 'x'.repeat(81);
  assert.deepEqual(await workflowStates(project, []), ['ready', 'ready', 'ready', 'pending']);
  project.captionStyle.enabled = false;
  assert.equal((await workflowStates(project, []))[3], 'ready');
  project.scenes[0]!.visual = { inert: {} };
  assert.equal((await workflowStates(project, []))[3], 'pending');
});

test('workflow metadata and visual edits do not invalidate current voice bindings', async () => {
  const project = voicedStoryboard();
  const expected = await bindingDigests(project);
  project.scenes.forEach((scene, index) => {
    const digest = expected.scenes[index]!;
    scene.mediaBindings.audio = { inputDigest: digest.audioInputDigest!, outputDigest: digest.audioOutputDigest! };
    scene.mediaBindings.words = { inputDigest: digest.wordsInputDigest!, outputDigest: digest.wordsOutputDigest! };
  });
  project.title = 'Otro título';
  project.idea = 'Otra idea';
  project.revision += 1;
  project.scenes[0]!.visual = null;
  assert.deepEqual(await workflowStates(project, []), ['ready', 'ready', 'ready', 'pending']);
  project.locale = 'en';
  assert.equal((await workflowStates(project, []))[2], 'outdated');
});
