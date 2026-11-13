import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyProject } from '../../src/shared/schema/empty.ts';
import { validateProject } from '../../src/shared/schema/validate.ts';
import { changeProjectStyle } from '../../studio/src/style-selection.ts';
import { parseProjectText } from '../../src/shared/schema/parse.ts';
import { canonicalize } from '../../src/shared/canonical.ts';
import { sha256Sync } from '../../src/shared/models/sha256-sync.ts';
import { fixtureText } from '../helpers/fixtures.ts';

const base = () => emptyProject({ projectId: 'test', now: '2026-01-01T00:00:00Z' });

test('explicit selection upgrades an editable 3D draft without changing its revision or unsaved content', () => {
  const draft = { ...base(), idea: 'Unsaved idea' };
  let confirmations = 0;
  const next = changeProjectStyle(draft, 'vector-2d', () => { confirmations++; return true; });
  assert.equal(confirmations, 0);
  assert.equal(next.schemaVersion, 3);
  assert.equal(next.styleId, 'vector-2d');
  assert.equal(next.revision, draft.revision);
  assert.equal(next.idea, draft.idea);
  assert.equal(validateProject(next).ok, true);
  assert.equal(changeProjectStyle(next, 'stylized-3d', () => false).schemaVersion, 3);
});

test('drawings require confirmation; cancellation preserves the draft and confirmation only clears visuals', () => {
  const visual = { kind: 'vector' as const, version: 1 as const, background: '#FFFFFF', layers: [] };
  const draft = { ...base(), schemaVersion: 3 as const, styleId: 'vector-2d', idea: 'Unsaved',
    output: { ...base().output, durationMs: 1000 },
    scenes: [{ sceneId: 'scene', revision: 4, title: 'Scene', startMs: 0, durationMs: 1000,
      text: 'Narration', visualIntent: 'Intent', visual, audio: null, words: [], mediaBindings: { audio: null, words: null } }] };
  const snapshot = structuredClone(draft);
  assert.equal(changeProjectStyle(draft, 'motion-graphics', count => { assert.equal(count, 1); return false; }), draft);
  assert.deepEqual(draft, snapshot);
  const next = changeProjectStyle(draft, 'motion-graphics', () => true);
  assert.deepEqual(next.scenes[0], { ...draft.scenes[0], visual: null, revision: 5 });
  assert.equal(next.idea, 'Unsaved');
  assert.equal(next.revision, draft.revision);
  assert.deepEqual(next.models, draft.models);
  assert.equal(validateProject(next).ok, true);
});

test('legacy unknown styles cannot become editable through selection', () => {
  const draft = { ...base(), styleId: 'vector-2d' };
  assert.equal(changeProjectStyle(draft, 'motion-graphics', () => true), draft);
});

test('3D conversion preserves model snapshots and all scene data except drawn visuals and their revisions', () => {
  const parsed = parseProjectText(fixtureText('storyboard'));
  assert.ok(parsed.ok);
  const model = { version: 1, name: 'Farol', semanticId: 'farol', parts: [
    { shape: 'box', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], color: '#ffffff' },
  ] };
  const draft = { ...parsed.project, models: [{ id: sha256Sync(canonicalize(model)), model }] };
  const checked = validateProject(draft);
  assert.ok(checked.ok, JSON.stringify(checked));
  const count = draft.scenes.filter(scene => scene.visual !== null).length;
  const next = changeProjectStyle(checked.project, 'vector-2d', actual => { assert.equal(actual, count); return true; });
  assert.deepEqual(next.models, checked.project.models);
  for (const [index, scene] of checked.project.scenes.entries()) {
    assert.deepEqual(next.scenes[index], scene.visual ? { ...scene, visual: null, revision: scene.revision + 1 } : scene);
  }
});
