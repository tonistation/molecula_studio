import test from 'node:test';
import assert from 'node:assert/strict';
import { bindingDigests, sha256Hex } from '../../src/shared/digests.ts';
import { canonicalize } from '../../src/shared/canonical.ts';
import { parseProjectText, serializeProject, validateProject } from '../../src/shared/schema/index.ts';
import { projectToVideoProps } from '../../src/shared/video-props.ts';
import { fixtureText } from '../helpers/fixtures.ts';

const model = { version: 1, name: 'Brain', semanticId: 'brain', parts: [
  { shape: 'sphere', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], color: '#ffffff' },
] };
const id = await sha256Hex(canonicalize(model));

function legacy() {
  const result = parseProjectText(fixtureText('storyboard'));
  assert.ok(result.ok);
  return result.project;
}

function withModels(): any {
  const project = legacy();
  const result: any = structuredClone(project);
  result.models = [{ id, model: structuredClone(model) }];
  for (const scene of result.scenes) {
    scene.visual.objects.push({ id: 'model_one', type: 'model', params: { modelId: id },
      position: [0, 0, 0], rotation: [0, 0, 0], scale: 1, color: '#ffffff', animations: [] });
  }
  return result;
}

test('requires registered snapshots for references in every scene', () => {
  const project = withModels();
  delete project.models;
  const result = validateProject(project);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.issues.filter(i => i.code === 'reference').length, 2);
});

test('rejects malformed snapshots and model references, unknown fields and URLs', () => {
  for (const mutate of [
    (p: any) => { p.models[0].model.parts[0].shape = 'script'; },
    (p: any) => { p.models[0].model.url = 'https://example.com'; },
    (p: any) => { p.models[0].id = 'invalid'; },
    (p: any) => { p.models.push(structuredClone(p.models[0])); },
    (p: any) => { p.scenes[0].visual.objects.at(-1).params.extra = 'code'; },
    (p: any) => { p.scenes[0].visual.objects.at(-1).params.modelId = 'https://example.com'; },
  ]) {
    const project = withModels(); mutate(project);
    assert.equal(validateProject(project).ok, false);
  }
});

test('preserves snapshots, cross-scene references and video props without mutation', () => {
  const input = withModels();
  const before = structuredClone(input);
  const validated = validateProject(input);
  assert.ok(validated.ok, validated.ok ? '' : JSON.stringify(validated.issues));
  assert.deepEqual(input, before);
  const parsed = parseProjectText(serializeProject(validated.project));
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.project, validated.project);
  const props = projectToVideoProps(parsed.project, {});
  assert.deepEqual(props.models, input.models);
  assert.equal(props.scenes.length, 2);
  assert.deepEqual(input, before);
});

test('old projects retain serialization and content digest; snapshot changes invalidate approval', async () => {
  const old = legacy();
  const oldText = serializeProject(old);
  const oldDigest = (await bindingDigests(old)).contentDigest;
  const roundtrip = parseProjectText(oldText);
  assert.ok(roundtrip.ok);
  assert.equal(serializeProject(roundtrip.project), oldText);
  assert.equal((await bindingDigests(roundtrip.project)).contentDigest, oldDigest);
  assert.equal(Object.hasOwn(roundtrip.project, 'models'), false);
  const input = withModels();
  const first = validateProject(input);
  assert.ok(first.ok);
  const digest = (await bindingDigests(first.project)).contentDigest;
  input.approval = { contentDigest: digest, approvedRevision: input.revision, approvedAt: input.updatedAt };
  input.models[0].model.parts[0].color = '#000000';
  const changedId = await sha256Hex(canonicalize(input.models[0].model));
  input.models[0].id = changedId;
  for (const scene of input.scenes) scene.visual.objects.at(-1).params.modelId = changedId;
  const changed = validateProject(input);
  assert.ok(changed.ok);
  assert.notEqual((await bindingDigests(changed.project)).contentDigest, changed.project.approval!.contentDigest);
});

test('content digests reject forged snapshot IDs', async () => {
  const project = withModels();
  project.models[0].model.name = 'Forged';
  assert.equal(validateProject(project).ok, true); // Structural validation alone is not authentication.
  await assert.rejects(bindingDigests(project), /integridad de los modelos/);
});
