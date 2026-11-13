import test from 'node:test';
import assert from 'node:assert/strict';
import { parseProjectText, serializeProject, validateProject } from '../../src/shared/schema/index.ts';
import { fixtureText, fixtureJson } from '../helpers/fixtures.ts';
import { bindingDigests } from '../../src/shared/digests.ts';
import type { Project } from '../../src/shared/schema/types.ts';

test('migrates a v1 storyboard to schema 2 and keeps the result stable on reopen', () => {
  const source = fixtureText('storyboard');
  const parsed = parseProjectText(source);
  assert.ok(parsed.ok);
  assert.equal(parsed.project.schemaVersion, 2);
  for (const scene of parsed.project.scenes) {
    assert.ok(scene.visual);
    assert.equal((scene.visual as unknown as { kind: string }).kind, 'kit');
  }
  const reopened = parseProjectText(serializeProject(parsed.project));
  assert.ok(reopened.ok);
  assert.deepEqual(reopened.project, parsed.project);
});

test('serialization orders kit fields independently of input property order', () => {
  const source = parseProjectText(fixtureText('storyboard'));
  assert.ok(source.ok);
  const reverse = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(reverse);
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reverse(child)]));
    }
    return value;
  };
  const reordered = validateProject(reverse(source.project));
  assert.ok(reordered.ok);
  assert.equal(serializeProject(reordered.project), serializeProject(source.project));
});

test('a migrated legacy object cannot bypass identity, version or parameter validation', () => {
  const parsed = parseProjectText(fixtureText('storyboard'));
  assert.ok(parsed.ok);
  for (const change of [
    (object: any) => { object.legacy.entityId = 'missing'; },
    (object: any) => { object.legacy.definitionVersion += 1; },
    (object: any) => { object.legacy.extra = 'untrusted'; },
    (object: any) => { object.params.bodyColor = '#FFFFFF'; },
    (object: any) => { object.seed += 1; },
    (object: any) => { object.color = '#FFFFFF'; },
  ]) {
    const project: Project = structuredClone(parsed.project);
    const visual = project.scenes[0]!.visual;
    assert.ok(visual && 'kind' in visual && visual.kind === 'kit');
    change(visual.objects[0]);
    const result = validateProject(project);
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.issues.some(issue => issue.path.includes('objects[0]')));
  }
});

test('migration retains every camera keyframe, identity, instance and historical media binding', async () => {
  const source = fixtureJson('storyboard');
  source.scenes[0].visual.palette = 'dark';
  source.scenes[0].visual.camera.keyframes.splice(1, 0, {
    atMs: 2100, position: [2, 3, 9], target: [1, 1, 0], fovDeg: 62,
  });
  const before = structuredClone(source);
  const parsed = validateProject(source);
  assert.ok(parsed.ok);
  assert.deepEqual(source, before);
  assert.equal(parsed.project.schemaVersion, 2);
  assert.equal(parsed.project.revision, source.revision);
  assert.equal(parsed.project.createdAt, source.createdAt);
  assert.equal(parsed.project.updatedAt, source.updatedAt);
  assert.deepEqual(parsed.project.entities, source.entities);
  for (const [index, scene] of parsed.project.scenes.entries()) {
    const original = source.scenes[index];
    assert.ok(scene.visual && 'kind' in scene.visual && scene.visual.kind === 'kit');
    assert.deepEqual(scene.visual.camera.keyframes, original.visual.camera.keyframes);
    assert.equal(scene.visual.palette.preset, original.visual.palette);
    assert.equal(scene.visual.palette.background, original.visual.background);
    assert.deepEqual(scene.mediaBindings, original.mediaBindings);
    for (const [objectIndex, object] of scene.visual.objects.entries()) {
      const component = original.visual.components[objectIndex];
      const entity = source.entities.find((item: { entityId: string }) => item.entityId === component.entityId);
      assert.equal(object.id, component.componentId);
      assert.equal(object.type, entity.identity.type);
      assert.deepEqual(object.legacy, { entityId: component.entityId,
        definitionVersion: component.definitionVersion, motion: component.motion, state: component.state });
      assert.deepEqual(object.params, { proportions: entity.identity.proportions, ...entity.identity.props });
      assert.equal(object.seed, entity.seed);
      assert.deepEqual(object.position, component.position);
      assert.deepEqual(object.rotation, component.rotation);
      assert.equal(object.scale, component.scale);
    }
  }
  const migratedBindings = await bindingDigests(parsed.project);
  const originalBindings = await bindingDigests(source);
  assert.deepEqual(migratedBindings.scenes, originalBindings.scenes);
});

test('keeps unknown style payload opaque across migration and rejects reserved code for every version/style', () => {
  const source = fixtureJson('unknown-style');
  const migrated = parseProjectText(JSON.stringify(source));
  assert.ok(migrated.ok);
  assert.equal(migrated.mode, 'read-only');
  assert.deepEqual(migrated.project.scenes[0]!.visual, { inert: source.scenes[0].visual });
  const reopened = parseProjectText(serializeProject(migrated.project));
  assert.deepEqual(reopened, migrated);
  for (const schemaVersion of [1, 2]) {
    for (const styleId of ['stylized-3d', 'unknown-style']) {
      const malicious = { ...source, schemaVersion, styleId };
      malicious.scenes = [{ ...source.scenes[0], visual: { kind: 'code', source: 'alert(1)' } }];
      const result = parseProjectText(JSON.stringify(malicious));
      assert.equal(result.ok, false);
      if (!result.ok) assert.ok(result.issues.some(issue => issue.path.includes('visual')));
    }
  }
});

test('unknown-style migration rejects non-JSON direct input without throwing or executing accessors', () => {
  for (const schemaVersion of [1, 2]) {
    for (const payload of [{ callback() {} }, { source: undefined }, { source: 1n }, { source: Symbol('code') }, { layers: Array(1) }]) {
      const project = { ...fixtureJson('unknown-style'), schemaVersion };
      project.scenes[0].visual = payload;
      let result: ReturnType<typeof validateProject> | undefined;
      assert.doesNotThrow(() => { result = validateProject(project); });
      assert.equal(result?.ok, false);
    }
    let called = false;
    const payload = Object.defineProperty({}, 'source', { enumerable: true, get() { called = true; throw new Error('must not execute'); } });
    const project = { ...fixtureJson('unknown-style'), schemaVersion };
    project.scenes[0].visual = payload;
    assert.doesNotThrow(() => assert.equal(validateProject(project).ok, false));
    assert.equal(called, false);
    const hidden = Object.defineProperty({ ...fixtureJson('unknown-style'), schemaVersion }, 'schemaVersion',
      { enumerable: false, get() { called = true; throw new Error('must not execute'); } });
    assert.doesNotThrow(() => assert.equal(validateProject(hidden).ok, false));
    assert.equal(called, false);
  }
});

test('migration preserves historical approval but does not approve the migrated content', async () => {
  const source = JSON.parse(fixtureText('storyboard'));
  const legacyDigest = (await bindingDigests(source)).contentDigest;
  source.approval = {
    contentDigest: legacyDigest,
    approvedRevision: source.revision,
    approvedAt: source.updatedAt,
  };
  const migrated = parseProjectText(JSON.stringify(source));
  assert.ok(migrated.ok);
  assert.equal(migrated.project.schemaVersion, 2);
  assert.deepEqual(migrated.project.approval, source.approval);
  assert.notEqual((await bindingDigests(migrated.project)).contentDigest, legacyDigest);
});
