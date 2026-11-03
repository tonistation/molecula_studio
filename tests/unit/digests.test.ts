import test from 'node:test';
import assert from 'node:assert/strict';

import { canonicalize } from '../../src/shared/canonical.ts';
import { bindingDigests, sha256Hex } from '../../src/shared/digests.ts';
import { validateProject } from '../../src/shared/schema/index.ts';
import type { Project } from '../../src/shared/schema/index.ts';
import { fixtureCopy, fixtureJson } from '../helpers/fixtures.ts';

const HEX = 'a'.repeat(64);

function projectFrom(value: unknown): Project {
  const result = validateProject(value);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.project;
}

function storyboard(): any {
  return fixtureCopy('storyboard');
}

function withAudio(project: any) {
  project.assets.push({
    assetId: 'asset_voice',
    kind: 'audio',
    path: 'assets/asset_voice.wav',
    mimeType: 'audio/wav',
    byteLength: 160044,
    sha256: HEX,
    durationMs: 5000,
    source: { origin: 'user', license: 'user-provided', attribution: '' },
  });
  project.scenes[0].audio = { assetId: 'asset_voice', offsetMs: 500, gainDb: 0 };
  project.scenes[0].mediaBindings.audio = null;
}

test('sha256Hex hashes strings and bytes with WebCrypto', async () => {
  assert.equal(
    await sha256Hex('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
  assert.equal(
    await sha256Hex(new TextEncoder().encode('abc')),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
  assert.match(await sha256Hex(''), /^[0-9a-f]{64}$/);
});

test('bindingDigests reproduces the digests recorded in the storyboard fixture', async () => {
  const project = projectFrom(fixtureJson('storyboard'));
  const digests = await bindingDigests(project);

  assert.match(digests.contentDigest, /^[0-9a-f]{64}$/);
  assert.deepEqual(
    digests.scenes.map((scene) => scene.sceneId),
    ['scene_intro', 'scene_layers'],
  );

  const [intro, layers] = digests.scenes;
  assert.ok(intro && layers);
  assert.equal(intro.wordsInputDigest, '868ff862271dd59b41af2968b1079e87f444d5e06e9d78e41987393a4f698806');
  assert.equal(intro.wordsOutputDigest, '24fff32c63c47e8f82644f074e35624ad4ef35d28c91f2626b1bbdb561005e76');
  assert.equal(layers.wordsInputDigest, '5c31a6ca77b036002fe7cec61f5867c293cf5ef2f95a54679739e6c70d2fc54a');
  assert.equal(layers.wordsOutputDigest, 'e807ab471328c120e1e64010df3f9ca32e050b97e1b4ff699c01d43f980199bc');

  for (const scene of digests.scenes) {
    assert.equal(scene.audioInputDigest, null);
    assert.equal(scene.audioOutputDigest, null);
    assert.equal(scene.audioTimingDigest, null);
  }
});

test('content digest excludes identity, revision, audit dates and approval', async () => {
  const baseline = await bindingDigests(projectFrom(storyboard()));

  const metadata = storyboard();
  metadata.projectId = 'project_other';
  metadata.revision = 99;
  metadata.createdAt = '2020-01-01T00:00:00Z';
  metadata.updatedAt = '2026-11-03T23:59:59Z';
  metadata.approval = { contentDigest: HEX, approvedRevision: 1, approvedAt: '2026-11-03T00:10:00Z' };
  const metadataDigests = await bindingDigests(projectFrom(metadata));

  assert.equal(metadataDigests.contentDigest, baseline.contentDigest);

  const edited = storyboard();
  edited.title = 'Otro título';
  const editedDigests = await bindingDigests(projectFrom(edited));

  assert.notEqual(editedDigests.contentDigest, baseline.contentDigest);
});

test('content digest is the canonical root minus excluded fields', async () => {
  const project = projectFrom(storyboard());
  const { projectId, revision, createdAt, updatedAt, approval, ...rest } = project;
  assert.equal(projectId, 'project_rocks');
  assert.equal(revision, 3);
  assert.equal(approval, null);
  assert.ok(createdAt && updatedAt);

  assert.equal((await bindingDigests(project)).contentDigest, await sha256Hex(canonicalize(rest)));
});

test('audio digests follow the binding-v1 projections', async () => {
  const value = storyboard();
  withAudio(value);
  value.output.voiceMode = 'withVoice';
  const project = projectFrom(value);
  const digests = await bindingDigests(project);
  const scene = project.scenes[0]!;
  const asset = project.assets[0]!;
  const audio = scene.audio!;

  assert.equal(
    digests.scenes[0]!.audioInputDigest,
    await sha256Hex(canonicalize({ text: scene.text, locale: project.locale })),
  );
  assert.equal(
    digests.scenes[0]!.audioOutputDigest,
    await sha256Hex(
      canonicalize({ assetId: audio.assetId, sha256: asset.sha256, offsetMs: audio.offsetMs, gainDb: audio.gainDb }),
    ),
  );
  assert.equal(
    digests.scenes[0]!.audioTimingDigest,
    await sha256Hex(
      canonicalize({ sha256: asset.sha256, offsetMs: audio.offsetMs, durationMs: asset.durationMs! - audio.offsetMs }),
    ),
  );
});

test('silent voice mode yields no audioTimingDigest even when audio is selected', async () => {
  const value = storyboard();
  withAudio(value);
  value.output.voiceMode = 'silent';
  const digests = await bindingDigests(projectFrom(value));
  assert.equal(digests.scenes[0]!.audioTimingDigest, null);

  const withVoice = storyboard();
  withAudio(withVoice);
  withVoice.output.voiceMode = 'withVoice';
  const voiceDigests = await bindingDigests(projectFrom(withVoice));
  assert.match(voiceDigests.scenes[0]!.audioTimingDigest ?? '', /^[0-9a-f]{64}$/);
});

test('an unverified asset hash keeps audio digests null', async () => {
  const value = storyboard();
  withAudio(value);
  value.assets[0].sha256 = null;
  const digests = await bindingDigests(projectFrom(value));
  assert.equal(digests.scenes[0]!.audioOutputDigest, null);
  assert.equal(digests.scenes[0]!.audioTimingDigest, null);
  assert.match(digests.scenes[0]!.audioInputDigest ?? '', /^[0-9a-f]{64}$/);
});

test('empty words produce null words digests', async () => {
  const value = storyboard();
  value.scenes[0].words = [];
  value.scenes[0].mediaBindings.words = null;
  const digests = await bindingDigests(projectFrom(value));
  assert.equal(digests.scenes[0]!.wordsInputDigest, null);
  assert.equal(digests.scenes[0]!.wordsOutputDigest, null);
});

test('words input digest includes the audioTimingDigest of the consumed audio', async () => {
  const value = storyboard();
  withAudio(value);
  value.output.voiceMode = 'withVoice';
  const project = projectFrom(value);
  const digests = await bindingDigests(project);
  const scene = digests.scenes[0]!;

  assert.equal(
    scene.wordsInputDigest,
    await sha256Hex(
      canonicalize({
        text: project.scenes[0]!.text,
        locale: project.locale,
        audioTimingDigest: scene.audioTimingDigest,
      }),
    ),
  );
  assert.equal(
    scene.wordsOutputDigest,
    await sha256Hex(canonicalize(project.scenes[0]!.words)),
  );
});
