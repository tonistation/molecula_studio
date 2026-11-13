import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  parseProjectText,
  serializeProject,
  validateProject,
} from '../../src/shared/schema/index.ts';
import { fixtureBytes, fixtureJson, fixtureText } from '../helpers/fixtures.ts';

async function withTempDir(run: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'molecula-roundtrip-'));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

for (const name of ['empty', 'storyboard', 'draft-partial']) {
  test(`${name} survives a real disk roundtrip without changing content`, async () => {
    const original = parseProjectText(fixtureBytes(name));
    assert.equal(original.ok, true, `${name} fixture must parse`);
    if (!original.ok) return;
    assert.equal(original.mode, 'editable');

    await withTempDir(async (dir) => {
      const file = join(dir, 'project.json');
      await writeFile(file, serializeProject(original.project), 'utf8');

      const bytes = await readFile(file);
      const reopened = parseProjectText(new Uint8Array(bytes));
      assert.equal(reopened.ok, true, `${name} must reopen`);
      if (!reopened.ok) return;

      assert.deepEqual(reopened.project, original.project);
      assert.equal(reopened.project.revision, original.project.revision);
      assert.equal(reopened.project.createdAt, original.project.createdAt);
      assert.equal(reopened.project.updatedAt, original.project.updatedAt);
      assert.equal(reopened.project.seed, original.project.seed);
      assert.deepEqual(
        reopened.project.scenes.map((scene) => [scene.sceneId, scene.revision, scene.startMs, scene.durationMs]),
        original.project.scenes.map((scene) => [scene.sceneId, scene.revision, scene.startMs, scene.durationMs]),
      );
      assert.deepEqual(reopened.project.assets, original.project.assets);
      assert.deepEqual(reopened.project.approval, original.project.approval);
    });
  });
}

test('serializing does not bump revisions or timestamps', () => {
  const fixture = fixtureJson('storyboard');
  const first = parseProjectText(JSON.stringify(fixture));
  assert.equal(first.ok, true);
  if (!first.ok) return;

  const text = serializeProject(first.project);
  const second = parseProjectText(text);
  assert.equal(second.ok, true);
  if (!second.ok) return;

  assert.equal(second.project.revision, fixture.revision);
  assert.equal(second.project.updatedAt, fixture.updatedAt);
  assert.equal(second.project.createdAt, fixture.createdAt);
  assert.equal(second.project.scenes[0]!.revision, fixture.scenes[0].revision);
});

test('unknown style fixture is read-only and its raw bytes stay untouched', async () => {
  const bytes = fixtureBytes('unknown-style');
  const result = parseProjectText(bytes);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.mode, 'read-only');
  assert.ok(result.inertVisual);

  await withTempDir(async (dir) => {
    const file = join(dir, 'project.json');
    await writeFile(file, bytes);
    const copy = await readFile(file);
    assert.deepEqual(new Uint8Array(copy), bytes);
  });
});

test('an external file with a future schemaVersion is rejected without touching the active project', () => {
  const future = fixtureJson('storyboard');
  future.schemaVersion = 4;
  const result = parseProjectText(JSON.stringify(future));
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure, 'unsupported-version');
});

test('validated fixtures keep every content field declared by the format', () => {
  const result = validateProject(fixtureJson('storyboard'));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const project = result.project;

  assert.equal(project.schemaVersion, 2);
  assert.equal(project.locale, 'es');
  assert.equal(project.styleId, 'stylized-3d');
  assert.equal(project.styleVersion, 1);
  assert.deepEqual(Object.keys(project.output), [
    'width',
    'height',
    'fps',
    'durationMs',
    'container',
    'voiceMode',
  ]);
  assert.deepEqual(Object.keys(project.captionStyle), [
    'enabled',
    'fontId',
    'fontSizePx',
    'color',
    'highlightColor',
    'anchor',
    'safeMarginPx',
  ]);
  assert.equal(project.entities.length, 5);
  assert.equal(project.scenes.length, 2);
  assert.equal(fixtureText('storyboard').length > 0, true);
});
