import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LIMITS,
  SCHEMA_VERSION,
  emptyProject,
  parseProjectText,
  serializeProject,
  validateProject,
} from '../../src/shared/schema/index.ts';
import { fixtureBytes, fixtureJson, fixtureText } from '../helpers/fixtures.ts';

function validated(name: string) {
  const result = validateProject(fixtureJson(name));
  if (!result.ok) {
    throw new Error(`${name} should validate: ${JSON.stringify(result.issues, null, 2)}`);
  }
  return result;
}

test('schema version and limits are exported from a single source', () => {
  assert.equal(SCHEMA_VERSION, 1);
  assert.equal(LIMITS.maxJsonBytes, 2 * 1024 * 1024);
  assert.equal(LIMITS.maxDepth, 16);
  assert.equal(LIMITS.maxScenes, 12);
  assert.equal(LIMITS.maxEntities, 32);
  assert.equal(LIMITS.maxAssets, 100);
  assert.equal(LIMITS.maxWordsPerScene, 300);
  assert.equal(LIMITS.maxWordsPerProject, 1500);
  assert.equal(LIMITS.maxTotalText, 12000);
  assert.equal(LIMITS.maxSceneText, 2000);
  assert.equal(LIMITS.maxDurationMs, 60000);
  assert.equal(LIMITS.minSceneMs, 1000);
  assert.equal(LIMITS.maxSceneMs, 15000);
  assert.equal(LIMITS.maxComponents, 16);
});

test('empty example is a valid editable project without scenes', () => {
  const result = validated('empty');
  assert.equal(result.mode, 'editable');
  assert.equal(result.project.schemaVersion, 1);
  assert.equal(result.project.projectId, 'project_empty');
  assert.equal(result.project.revision, 0);
  assert.deepEqual(result.project.scenes, []);
  assert.deepEqual(result.project.entities, []);
  assert.deepEqual(result.project.assets, []);
  assert.equal(result.project.output.durationMs, 0);
  assert.equal(result.project.approval, null);
});

test('storyboard example keeps scenes, entities and references', () => {
  const { project, mode } = validated('storyboard');
  assert.equal(mode, 'editable');
  assert.equal(project.scenes.length, 2);
  assert.equal(project.output.durationMs, 12000);
  assert.deepEqual(
    project.scenes.map((scene) => [scene.sceneId, scene.startMs, scene.durationMs]),
    [
      ['scene_intro', 0, 6000],
      ['scene_layers', 6000, 6000],
    ],
  );
  const car = project.entities.find((entity) => entity.entityId === 'entity_car');
  assert.ok(car);
  assert.equal(car.definitionVersion, 1);
  const instances = project.scenes.flatMap((scene) =>
    scene.visual && 'components' in scene.visual
      ? scene.visual.components.filter((component) => component.entityId === 'entity_car')
      : [],
  );
  assert.equal(instances.length, 2);
  for (const instance of instances) assert.equal(instance.definitionVersion, car.definitionVersion);
});

test('serialize then parse is a deep-equal roundtrip for both examples', () => {
  for (const name of ['empty', 'storyboard']) {
    const { project } = validated(name);
    const text = serializeProject(project);
    const reparsed = parseProjectText(text);
    assert.equal(reparsed.ok, true, `${name} should reparse`);
    if (!reparsed.ok) return;
    assert.equal(reparsed.mode, 'editable');
    assert.deepEqual(reparsed.project, project, `${name} must roundtrip without changes`);
    assert.equal(serializeProject(reparsed.project), text, `${name} serialization is stable`);
  }
});

test('serializeProject writes 2-space indent, trailing newline and declared key order', () => {
  const { project } = validated('storyboard');
  const text = serializeProject(project);

  assert.ok(text.endsWith('\n'));
  assert.ok(!text.endsWith('\n\n'));
  assert.match(text, /^\{\n {2}"schemaVersion": 1,\n {2}"projectId": "project_rocks",\n/);

  const rootOrder = [
    'schemaVersion',
    'projectId',
    'revision',
    'title',
    'createdAt',
    'updatedAt',
    'idea',
    'locale',
    'styleId',
    'styleVersion',
    'seed',
    'output',
    'captionStyle',
    'entities',
    'scenes',
    'assets',
    'approval',
  ];
  let cursor = -1;
  for (const key of rootOrder) {
    const index = text.indexOf(`\n  "${key}":`);
    assert.ok(index > cursor, `root key ${key} must keep declared order`);
    cursor = index;
  }

  const sceneOrder = [
    'sceneId',
    'revision',
    'title',
    'startMs',
    'durationMs',
    'text',
    'visualIntent',
    'visual',
    'audio',
    'words',
    'mediaBindings',
  ];
  cursor = -1;
  for (const key of sceneOrder) {
    const index = text.indexOf(`\n      "${key}":`);
    assert.ok(index > cursor, `scene key ${key} must keep declared order`);
    cursor = index;
  }
});

test('parseProjectText accepts UTF-8 bytes and a BOM', () => {
  const bytes = fixtureBytes('empty');
  const fromBytes = parseProjectText(bytes);
  assert.equal(fromBytes.ok, true);

  const withBom = parseProjectText(`\uFEFF${fixtureText('empty')}`);
  assert.equal(withBom.ok, true);
  if (fromBytes.ok && withBom.ok) {
    assert.deepEqual(withBom.project, fromBytes.project);
  }
});

test('draft fixture with null visual, empty words and unused audio asset is valid', () => {
  const { project, mode } = validated('draft-partial');
  assert.equal(mode, 'editable');
  assert.equal(project.scenes.length, 1);
  const scene = project.scenes[0]!;
  assert.equal(scene.visual, null);
  assert.equal(scene.audio, null);
  assert.deepEqual(scene.words, []);
  assert.deepEqual(scene.mediaBindings, { audio: null, words: null });
  assert.equal(project.assets.length, 1);
  assert.equal(project.assets[0]!.sha256, null);
  assert.equal(project.assets[0]!.durationMs, 4000);
});

test('emptyProject returns a complete, valid, empty document', () => {
  const project = emptyProject({
    projectId: 'project_new',
    now: '2026-11-03T12:00:00Z',
    title: 'Nuevo proyecto',
  });

  assert.equal(project.schemaVersion, 1);
  assert.equal(project.revision, 0);
  assert.equal(project.title, 'Nuevo proyecto');
  assert.equal(project.createdAt, '2026-11-03T12:00:00Z');
  assert.equal(project.updatedAt, '2026-11-03T12:00:00Z');
  assert.deepEqual(project.scenes, []);
  assert.deepEqual(project.entities, []);
  assert.deepEqual(project.assets, []);
  assert.equal(project.approval, null);
  assert.equal(project.output.durationMs, 0);
  assert.equal(project.output.voiceMode, 'silent');
  assert.equal(project.captionStyle.anchor, 'upper');

  const result = validateProject(project);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test('emptyProject applies a default title and rejects an invalid clock', () => {
  const project = emptyProject({ projectId: 'project_default', now: '2026-11-03T00:00:00Z' });
  assert.ok(project.title.length > 0);

  assert.throws(
    () => emptyProject({ projectId: 'project_bad', now: '2026-11-03 00:00:00' }),
    TypeError,
  );
});
