import test from 'node:test';
import assert from 'node:assert/strict';

import { LIMITS, validateProject } from '../../src/shared/schema/index.ts';
import type { Issue } from '../../src/shared/schema/index.ts';
import { fixtureCopy, fixtureJson } from '../helpers/fixtures.ts';

const HEX = 'a'.repeat(64);

function base(): any {
  return fixtureCopy('storyboard');
}

function withAudio(d: any, overrides: Record<string, unknown> = {}) {
  d.assets.push({
    assetId: 'asset_voice',
    kind: 'audio',
    path: 'assets/asset_voice.wav',
    mimeType: 'audio/wav',
    byteLength: 160044,
    sha256: HEX,
    durationMs: 5000,
    source: { origin: 'user', license: 'user-provided', attribution: '' },
    ...overrides,
  });
  d.scenes[0].audio = { assetId: 'asset_voice', offsetMs: 0, gainDb: 0 };
}

function withImage(d: any) {
  d.assets.push({
    assetId: 'asset_image',
    kind: 'image',
    path: 'assets/asset_image.png',
    mimeType: 'image/png',
    byteLength: 1024,
    sha256: null,
    durationMs: null,
    source: { origin: 'fixture', license: 'CC0-1.0', attribution: 'fixture' },
  });
}

function issuesOf(value: unknown): Issue[] {
  const result = validateProject(value);
  assert.equal(result.ok, false, 'expected validation to fail');
  return result.ok ? [] : result.issues;
}

function expectInvalid(name: string, edit: (draft: any) => void, code?: string) {
  test(`rejects ${name}`, () => {
    const draft = base();
    edit(draft);
    const issues = issuesOf(draft);
    assert.ok(issues.length > 0);
    for (const issue of issues) {
      assert.equal(typeof issue.path, 'string');
      assert.equal(typeof issue.code, 'string');
      assert.equal(typeof issue.message, 'string');
      assert.ok(issue.path.startsWith('$'), `issue path must be rooted: ${issue.path}`);
    }
    if (code) {
      assert.ok(
        issues.some((issue) => issue.code === code),
        `expected code ${code}, got ${JSON.stringify(issues.map((issue) => [issue.code, issue.path]))}`,
      );
    }
  });
}

function expectValid(name: string, edit: (draft: any) => void) {
  test(`accepts ${name}`, () => {
    const draft = base();
    edit(draft);
    const result = validateProject(draft);
    assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  });
}

function sceneStub(sceneId: string, startMs: number, durationMs: number, extra: any = {}) {
  return {
    sceneId,
    revision: 0,
    title: sceneId,
    startMs,
    durationMs,
    text: '',
    visualIntent: '',
    visual: null,
    audio: null,
    words: [],
    mediaBindings: { audio: null, words: null },
    ...extra,
  };
}

// Root wrapper -------------------------------------------------------------

expectInvalid('a missing required root key', (d) => delete d.title, 'required');
expectInvalid('an unknown root key', (d) => (d.extra = true), 'unknown-key');
expectInvalid('a non-ASCII projectId', (d) => (d.projectId = 'Project One'), 'pattern');
expectInvalid('an uppercase projectId', (d) => (d.projectId = 'Project'), 'pattern');
expectInvalid('a negative revision', (d) => (d.revision = -1), 'range');
expectInvalid('a fractional revision', (d) => (d.revision = 1.5), 'type');
expectInvalid('an empty title', (d) => (d.title = ''), 'range');
expectInvalid('a 121 character title', (d) => (d.title = 'a'.repeat(121)), 'range');
expectInvalid('a NUL character in text', (d) => (d.title = 'a\u0000b'), 'text-control');
expectInvalid('a control character in idea', (d) => (d.idea = 'bell\u0007'), 'text-control');
expectInvalid('a non-UTC date', (d) => (d.createdAt = '2026-11-03 00:00:00'), 'date');
expectInvalid('a date with a numeric offset', (d) => (d.createdAt = '2026-11-03T00:00:00+00:00'), 'date');
expectInvalid('an impossible calendar date', (d) => (d.createdAt = '2026-02-30T00:00:00Z'), 'date');
expectInvalid(
  'updatedAt before createdAt',
  (d) => (d.updatedAt = '2026-11-02T23:59:59Z'),
  'date-order',
);
expectInvalid('an unknown locale', (d) => (d.locale = 'fr'), 'const');
expectInvalid('an unknown styleVersion zero', (d) => (d.styleVersion = 0), 'range');
expectInvalid('a seed above uint32', (d) => (d.seed = 4294967296), 'range');
expectInvalid('a negative seed', (d) => (d.seed = -1), 'range');

expectInvalid('output.width other than 1080', (d) => (d.output.width = 720), 'const');
expectInvalid('output.height other than 1920', (d) => (d.output.height = 1080), 'const');
expectInvalid('output.fps other than 30', (d) => (d.output.fps = 60), 'const');
expectInvalid('output.container other than mp4', (d) => (d.output.container = 'webm'), 'const');
expectInvalid('an unknown voiceMode', (d) => (d.output.voiceMode = 'auto'), 'const');
expectInvalid('a duration above 60000ms', (d) => (d.output.durationMs = 60100), 'range');
expectInvalid('a duration that does not match scenes', (d) => (d.output.durationMs = 11900), 'sum');
expectInvalid('a non-100ms output duration', (d) => (d.output.durationMs = 12050), 'grid');
expectInvalid('an unknown output key', (d) => (d.output.bitrate = 1), 'unknown-key');

expectInvalid('fontSizePx below 24', (d) => (d.captionStyle.fontSizePx = 23), 'range');
expectInvalid('safeMarginPx above 240', (d) => (d.captionStyle.safeMarginPx = 241), 'range');
expectInvalid('a short hex color', (d) => (d.captionStyle.color = '#FFF'), 'pattern');
expectInvalid('a non-hex color', (d) => (d.captionStyle.highlightColor = '#GGGGGG'), 'pattern');
expectInvalid('an unknown caption anchor', (d) => (d.captionStyle.anchor = 'top'), 'const');
expectInvalid('a non-boolean caption enabled', (d) => (d.captionStyle.enabled = 'yes'), 'type');
expectInvalid('an unknown fontId', (d) => (d.captionStyle.fontId = 'Arial'), 'const');

// Scenes -------------------------------------------------------------------

expectInvalid('a duplicate sceneId', (d) => (d.scenes[1].sceneId = d.scenes[0].sceneId), 'unique');
expectInvalid('a scene gap', (d) => (d.scenes[1].startMs = 6100), 'layout');
expectInvalid('a scene overlap', (d) => (d.scenes[1].startMs = 5900), 'layout');
expectInvalid('a first scene not starting at 0', (d) => {
  d.scenes[0].startMs = 100;
  d.scenes[1].startMs = 6100;
  d.output.durationMs = 12100;
}, 'layout');
expectInvalid('a scene shorter than 1000ms', (d) => (d.scenes[0].durationMs = 900), 'range');
expectInvalid('a scene longer than 15000ms', (d) => (d.scenes[0].durationMs = 15100), 'range');
expectInvalid('a scene duration that is not a 100ms multiple', (d) => (d.scenes[0].durationMs = 6050), 'grid');
expectInvalid('a scene start that is not a 100ms multiple', (d) => {
  d.scenes[1].startMs = 6050;
  d.output.durationMs = 12050;
}, 'grid');
expectInvalid('an unknown scene key', (d) => (d.scenes[0].ready = true), 'unknown-key');
expectInvalid('scene text above 2000 characters', (d) => (d.scenes[0].text = 'x'.repeat(2001)), 'range');
expectInvalid('visualIntent above 1000 characters', (d) => (d.scenes[0].visualIntent = 'x'.repeat(1001)), 'range');
expectInvalid('a negative scene revision', (d) => (d.scenes[0].revision = -1), 'range');

expectInvalid('words out of scene bounds', (d) => (d.scenes[0].words[4].endMs = 7000), 'range');
expectInvalid('a word with start equal to end', (d) => (d.scenes[0].words[4].endMs = 2400), 'order');
expectInvalid('overlapping words', (d) => (d.scenes[0].words[1].startMs = 800), 'order');
expectInvalid('unsorted words', (d) => {
  const words = d.scenes[0].words;
  d.scenes[0].words = [words[1], words[0], words[2], words[3], words[4]];
}, 'order');
expectInvalid('a word longer than 80 characters', (d) => (d.scenes[0].words[0].text = 'x'.repeat(81)), 'range');
expectInvalid('an empty word text', (d) => (d.scenes[0].words[0].text = ''), 'range');
expectInvalid('a non-boolean emphasis', (d) => (d.scenes[0].words[0].emphasis = 1), 'type');
expectInvalid('an unknown word key', (d) => (d.scenes[0].words[0].phoneme = 'x'), 'unknown-key');

// Media bindings and approval ---------------------------------------------

expectInvalid('an audio binding while audio is null', (d) => {
  d.scenes[0].mediaBindings.audio = { inputDigest: HEX, outputDigest: HEX };
}, 'binding');
expectInvalid('a words binding while words are empty', (d) => {
  d.scenes[0].words = [];
  d.scenes[0].mediaBindings.words = { inputDigest: HEX, outputDigest: HEX };
}, 'binding');
expectInvalid('a non-hex binding digest', (d) => {
  d.scenes[0].mediaBindings.words.inputDigest = 'Z'.repeat(64);
}, 'digest');
expectInvalid('an uppercase binding digest', (d) => {
  d.scenes[0].mediaBindings.words.outputDigest = 'A'.repeat(64);
}, 'digest');
expectInvalid('a short binding digest', (d) => {
  d.scenes[0].mediaBindings.words.outputDigest = 'abc';
}, 'digest');

expectValid('a valid words binding without audio', (d) => {
  d.scenes[0].mediaBindings.words = { inputDigest: HEX, outputDigest: HEX };
});

expectInvalid('approval revision beyond the project revision', (d) => {
  d.approval = { contentDigest: HEX, approvedRevision: d.revision + 1, approvedAt: d.updatedAt };
}, 'range');
expectInvalid('approval date after updatedAt', (d) => {
  d.approval = { contentDigest: HEX, approvedRevision: d.revision, approvedAt: '2026-11-03T00:11:00Z' };
}, 'date-order');
expectInvalid('an invalid approval digest', (d) => {
  d.approval = { contentDigest: 'nope', approvedRevision: d.revision, approvedAt: d.updatedAt };
}, 'digest');
expectInvalid('an unknown approval key', (d) => {
  d.approval = { contentDigest: HEX, approvedRevision: 0, approvedAt: d.updatedAt, note: 'ok' };
}, 'unknown-key');
expectValid('an approval pinned to the current revision', (d) => {
  d.approval = { contentDigest: HEX, approvedRevision: d.revision, approvedAt: d.updatedAt };
});

// Entities -----------------------------------------------------------------

expectInvalid('a duplicate entityId', (d) => (d.entities[1].entityId = d.entities[0].entityId), 'unique');
expectInvalid('an unknown generatorId', (d) => (d.entities[0].generatorId = 'procedural-v2'), 'const');
expectInvalid('an unknown generatorVersion', (d) => (d.entities[0].generatorVersion = 2), 'const');
expectInvalid('a variant pointing at itself', (d) => {
  d.entities[0].variantOf = { entityId: 'entity_presenter', definitionVersion: 1 };
}, 'cycle');
expectInvalid('a variant cycle', (d) => {
  d.entities[0].variantOf = { entityId: 'entity_rocks', definitionVersion: 1 };
  d.entities[1].variantOf = { entityId: 'entity_presenter', definitionVersion: 1 };
}, 'cycle');
expectInvalid('a variant with an unknown origin', (d) => {
  d.entities[0].variantOf = { entityId: 'entity_missing', definitionVersion: 1 };
}, 'reference');
expectInvalid('a character with the rigid rig', (d) => (d.entities[0].identity.rigId = 'rigid-v1'), 'const');
expectInvalid('a car with the character rig', (d) => (d.entities[2].identity.rigId = 'character-basic-v1'), 'const');
expectInvalid('a non-null voiceId', (d) => (d.entities[0].identity.voiceId = 'voice_1'), 'const');
expectInvalid('proportions below 0.1', (d) => (d.entities[0].identity.proportions.width = 0.05), 'range');
expectInvalid('proportions above 10', (d) => (d.entities[0].identity.proportions.height = 11), 'range');
expectInvalid('an unknown identity type', (d) => (d.entities[0].identity.type = 'tree'), 'const');
expectInvalid('character props with a car field', (d) => {
  d.entities[0].identity.props = { bodyColor: '#FFFFFF', wheelColor: '#000000' };
}, 'unknown-key');
expectInvalid('rockLayers with one color', (d) => (d.entities[1].identity.props.colors = ['#FFFFFF']), 'range');
expectInvalid('rockLayers with seven colors', (d) => {
  d.entities[1].identity.props.colors = ['#111111', '#222222', '#333333', '#444444', '#555555', '#666666', '#777777'];
}, 'limit');
expectInvalid('an arrow direction that is not unit length', (d) => {
  d.entities[3].identity.props.direction = [2, 0, 0];
}, 'range');
expectInvalid('an arrow direction that is zero', (d) => {
  d.entities[3].identity.props.direction = [0, 0, 0];
}, 'range');
expectInvalid('a label with empty text', (d) => (d.entities[4].identity.props.text = ''), 'range');
expectInvalid('an unknown identity key', (d) => (d.entities[0].identity.material = 'gold'), 'unknown-key');

// Visual instances and camera ---------------------------------------------

expectInvalid('a component referencing a missing entity', (d) => {
  d.scenes[0].visual.components[0].entityId = 'entity_missing';
}, 'reference');
expectInvalid('a component with a stale definitionVersion', (d) => {
  d.scenes[0].visual.components[0].definitionVersion = 2;
}, 'reference');
expectInvalid('a non-uniform scale object', (d) => {
  d.scenes[0].visual.components[0].scale = { x: 1, y: 1, z: 1 };
}, 'type');
expectInvalid('a non-uniform scale array', (d) => {
  d.scenes[0].visual.components[0].scale = [1, 1, 1];
}, 'type');
expectInvalid('a scale below 0.1', (d) => (d.scenes[0].visual.components[0].scale = 0.05), 'range');
expectInvalid('a rotation above 6.284', (d) => (d.scenes[0].visual.components[0].rotation = [0, 6.3, 0]), 'range');
expectInvalid('a position outside the bounded vector', (d) => {
  d.scenes[0].visual.components[0].position = [0, 101, 0];
}, 'range');
expectInvalid('an instance identity override', (d) => {
  d.scenes[0].visual.components[0].props = { bodyColor: '#000000' };
}, 'unknown-key');
expectInvalid('a duplicate componentId', (d) => {
  d.scenes[0].visual.components[1].componentId = 'presenter';
}, 'unique');
expectInvalid('an unknown motion', (d) => (d.scenes[0].visual.components[0].motion = 'spin'), 'const');
expectInvalid('a non-default state', (d) => (d.scenes[0].visual.components[0].state = 'highlighted'), 'const');
expectInvalid('a non-perspective projection', (d) => {
  d.scenes[0].visual.camera.projection = 'orthographic';
}, 'const');
expectInvalid('an unknown template', (d) => (d.scenes[0].visual.templateId = 'explainer-v2'), 'const');
expectInvalid('an unknown palette', (d) => (d.scenes[0].visual.palette = 'sunset'), 'const');
expectInvalid('a first camera keyframe after 0', (d) => {
  d.scenes[0].visual.camera.keyframes[0].atMs = 100;
}, 'order');
expectInvalid('unordered camera keyframes', (d) => {
  d.scenes[0].visual.camera.keyframes[0].atMs = 500;
  d.scenes[0].visual.camera.keyframes[1].atMs = 400;
}, 'order');
expectInvalid('a camera keyframe beyond the scene', (d) => {
  d.scenes[0].visual.camera.keyframes[1].atMs = 6001;
}, 'range');
expectInvalid('a camera keyframe with identical position and target', (d) => {
  d.scenes[0].visual.camera.keyframes[0].target = [0, 2, 8];
}, 'range');
expectInvalid('a camera fov below 20', (d) => (d.scenes[0].visual.camera.keyframes[0].fovDeg = 19), 'range');
expectInvalid('a camera fov above 80', (d) => (d.scenes[0].visual.camera.keyframes[0].fovDeg = 81), 'range');
expectInvalid('an unknown camera key', (d) => (d.scenes[0].visual.camera.fovDeg = 45), 'unknown-key');
expectInvalid('an unknown component key', (d) => {
  d.scenes[0].visual.components[0].geometry = 'sphere';
}, 'unknown-key');

// Assets -------------------------------------------------------------------

expectInvalid('an asset path with traversal', (d) => {
  withImage(d);
  d.assets[0].path = '../assets/asset_image.png';
}, 'path');
expectInvalid('an absolute asset path', (d) => {
  withImage(d);
  d.assets[0].path = '/tmp/asset_image.png';
}, 'path');
expectInvalid('a backslash asset path', (d) => {
  withImage(d);
  d.assets[0].path = 'assets\\asset_image.png';
}, 'path');
expectInvalid('a percent-encoded asset path', (d) => {
  withImage(d);
  d.assets[0].path = 'assets/%2e%2e/asset_image.png';
}, 'path');
expectInvalid('an asset path that does not use its id', (d) => {
  withImage(d);
  d.assets[0].path = 'assets/other.png';
}, 'path');
expectInvalid('an extension that does not match the MIME type', (d) => {
  withImage(d);
  d.assets[0].path = 'assets/asset_image.wav';
}, 'path');
expectInvalid('an unknown MIME type', (d) => {
  withImage(d);
  d.assets[0].mimeType = 'image/svg+xml';
}, 'const');
expectInvalid('an audio asset without duration', (d) => {
  withAudio(d);
  d.assets[0].durationMs = null;
}, 'type');
expectInvalid('an image asset with duration', (d) => {
  withImage(d);
  d.assets[0].durationMs = 1000;
}, 'const');
expectInvalid('an asset byteLength above the limit', (d) => {
  withImage(d);
  d.assets[0].byteLength = 52428801;
}, 'range');
expectInvalid('an uppercase sha256', (d) => {
  withAudio(d);
  d.assets[0].sha256 = 'A'.repeat(64);
}, 'digest');
expectInvalid('an unknown asset origin', (d) => {
  withImage(d);
  d.assets[0].source.origin = 'web';
}, 'const');
expectInvalid('an empty asset license', (d) => {
  withImage(d);
  d.assets[0].source.license = '';
}, 'range');
expectInvalid('an audio reference to an image asset', (d) => {
  withImage(d);
  d.scenes[0].audio = { assetId: 'asset_image', offsetMs: 0, gainDb: 0 };
}, 'reference');
expectInvalid('an audio reference to a missing asset', (d) => {
  d.scenes[0].audio = { assetId: 'asset_missing', offsetMs: 0, gainDb: 0 };
}, 'reference');
expectInvalid('an audio offset beyond the asset duration', (d) => {
  withAudio(d);
  d.scenes[0].audio.offsetMs = 5000;
}, 'range');
expectInvalid('a gain outside -24..6', (d) => {
  withAudio(d);
  d.scenes[0].audio.gainDb = 6.5;
}, 'range');
expectValid('an audio selection that fits its scene', (d) => withAudio(d));

// Aggregate limits ---------------------------------------------------------

expectInvalid('more than 32 entities', (d) => {
  d.entities = Array.from({ length: LIMITS.maxEntities + 1 }, (_, index) => ({
    ...structuredClone(d.entities[0]),
    entityId: `entity_${index}`,
  }));
}, 'limit');
expectInvalid('more than 12 scenes', (d) => {
  d.scenes = Array.from({ length: LIMITS.maxScenes + 1 }, (_, index) =>
    sceneStub(`scene_${index}`, index * 1000, 1000),
  );
  d.output.durationMs = (LIMITS.maxScenes + 1) * 1000;
}, 'limit');
expectInvalid('more than 100 assets', (d) => {
  d.assets = Array.from({ length: LIMITS.maxAssets + 1 }, (_, index) => ({
    assetId: `asset_${index}`,
    kind: 'image',
    path: `assets/asset_${index}.png`,
    mimeType: 'image/png',
    byteLength: 10,
    sha256: null,
    durationMs: null,
    source: { origin: 'fixture', license: 'CC0-1.0', attribution: '' },
  }));
}, 'limit');
expectInvalid('more than 16 components in a scene', (d) => {
  const components = d.scenes[0].visual.components;
  d.scenes[0].visual.components = Array.from({ length: LIMITS.maxComponents + 1 }, (_, index) => ({
    ...structuredClone(components[0]),
    componentId: `component_${index}`,
  }));
}, 'limit');
expectInvalid('more than 8 camera keyframes', (d) => {
  const keyframes = d.scenes[0].visual.camera.keyframes;
  d.scenes[0].visual.camera.keyframes = Array.from({ length: 9 }, (_, index) => ({
    ...structuredClone(keyframes[0]),
    atMs: index * 100,
  }));
}, 'limit');
expectInvalid('more than 300 words in a scene', (d) => {
  d.scenes[0].words = Array.from({ length: LIMITS.maxWordsPerScene + 1 }, (_, index) => ({
    text: 'w',
    startMs: index * 4,
    endMs: index * 4 + 2,
    emphasis: false,
  }));
  d.scenes[0].mediaBindings.words = null;
}, 'limit');
expectInvalid('more than 1500 words in the project', (d) => {
  d.scenes = Array.from({ length: 6 }, (_, sceneIndex) =>
    sceneStub(`scene_${sceneIndex}`, sceneIndex * 1000, 1000, {
      words: Array.from({ length: sceneIndex === 5 ? 251 : 250 }, (_, index) => ({
        text: 'w',
        startMs: index * 3,
        endMs: index * 3 + 2,
        emphasis: false,
      })),
    }),
  );
  d.output.durationMs = 6000;
}, 'limit');
expectInvalid('more than 12000 characters of scene text', (d) => {
  d.scenes = Array.from({ length: 7 }, (_, sceneIndex) =>
    sceneStub(`scene_${sceneIndex}`, sceneIndex * 1000, 1000, {
      text: sceneIndex === 6 ? 'x' : 'x'.repeat(2000),
    }),
  );
  d.output.durationMs = 7000;
}, 'limit');

// Valid baselines ----------------------------------------------------------

test('rejects an unknown key inside the installed style visual', () => {
  const draft = base();
  draft.scenes[0].visual.extra = true;
  const issues = issuesOf(draft);
  assert.ok(issues.some((issue) => issue.code === 'unknown-key'));
});

expectValid('a project without scenes and zero duration', (d) => {
  d.scenes = [];
  d.output.durationMs = 0;
  d.entities = [];
});

expectValid('a scene using the last allowed duration', (d) => {
  d.scenes = [sceneStub('scene_long', 0, 15000)];
  d.output.durationMs = 15000;
});

expectValid('tab and newline characters in text', (d) => {
  d.title = 'Línea uno\ttab';
  d.idea = 'Primera línea\nSegunda línea';
});

expectValid('lowercase hex colors', (d) => {
  d.captionStyle.color = '#ffffff';
  d.captionStyle.highlightColor = '#ffd54a';
});

test('unknown style is preserved as read-only instead of rejected', () => {
  const result = validateProject(fixtureJson('unknown-style'));
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  if (!result.ok) return;

  assert.equal(result.mode, 'read-only');
  const scene = result.project.scenes[0]!;
  assert.deepEqual(scene.visual, {
    inert: {
      templateId: 'flat-v1',
      layers: [
        { shape: 'rect', color: '#FFFFFF', opacity: 0.5 },
        { shape: 'circle', color: '#FFAA00', radius: 12 },
      ],
      notes: 'payload inerte, no interpretable por este runtime',
    },
  });
  assert.deepEqual(result.inertVisual, [
    {
      sceneId: 'scene_flat',
      visual: {
        templateId: 'flat-v1',
        layers: [
          { shape: 'rect', color: '#FFFFFF', opacity: 0.5 },
          { shape: 'circle', color: '#FFAA00', radius: 12 },
        ],
        notes: 'payload inerte, no interpretable por este runtime',
      },
    },
  ]);
});

test('unknown styleVersion is read-only too', () => {
  const draft = base();
  draft.styleVersion = 2;
  const result = validateProject(draft);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.mode, 'read-only');
});

test('read-only mode still enforces wrapper bounds', () => {
  const words = fixtureCopy('unknown-style');
  words.scenes[0].words = [{ text: 'w', startMs: 0, endMs: 4000, emphasis: false }];
  const result = validateProject(words);
  assert.equal(result.ok, false);

  const duration = fixtureCopy('unknown-style');
  duration.scenes[0].durationMs = 3050;
  assert.equal(validateProject(duration).ok, false);

  const notAnObject = fixtureCopy('unknown-style');
  notAnObject.scenes[0].visual = 'flat';
  assert.equal(validateProject(notAnObject).ok, false);
});

test('validateProject rejects dangerous keys, depth, cycles and non-finite numbers', () => {
  const dangerous = JSON.parse('{"__proto__":{"polluted":true}}');
  const dangerousResult = validateProject(dangerous);
  assert.equal(dangerousResult.ok, false);
  if (!dangerousResult.ok) {
    assert.ok(dangerousResult.issues.some((issue) => issue.code === 'dangerous-key'));
  }

  let deep: unknown = 'leaf';
  for (let index = 0; index < 17; index += 1) deep = { nested: deep };
  const deepResult = validateProject(deep);
  assert.equal(deepResult.ok, false);
  if (!deepResult.ok) {
    assert.ok(deepResult.issues.some((issue) => issue.code === 'depth'));
  }

  const cyclic: Record<string, unknown> = { schemaVersion: 1 };
  cyclic.self = cyclic;
  const cyclicResult = validateProject(cyclic);
  assert.equal(cyclicResult.ok, false);
  if (!cyclicResult.ok) {
    assert.ok(cyclicResult.issues.some((issue) => issue.code === 'cycle'));
  }

  const nonFinite = base();
  nonFinite.revision = Number.POSITIVE_INFINITY;
  assert.equal(validateProject(nonFinite).ok, false);

  const exotic = base();
  exotic.createdAt = new Date('2026-11-03T00:00:00Z');
  assert.equal(validateProject(exotic).ok, false);
});

test('rejects duplicate asset ids', () => {
  const draft = base();
  withImage(draft);
  draft.assets.push(structuredClone(draft.assets[0]));
  const issues = issuesOf(draft);
  assert.ok(issues.some((issue) => issue.code === 'unique'));
});
