import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startCompanionServer } from '../../src/companion/server/http.ts';
import { validateProject } from '../../src/shared/schema/validate.ts';
import { applyKitSceneWithModels } from '../../src/shared/kit/apply.ts';
import { fixtureJson } from '../helpers/fixtures.ts';
import { fakeCodex } from '../helpers/fake-codex.ts';
import { canonicalize } from '../../src/shared/canonical.ts';
import { sha256Sync } from '../../src/shared/models/sha256-sync.ts';
import { ModelLibrary } from '../../src/companion/store/model-library.ts';

test('pagination reaches every catalog entry without accepting invalid offsets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'model-pages-'));
  const library = new ModelLibrary(root);
  const models = Array.from({ length: 65 }, (_, i) => ({ version: 1, name: `Model ${i}`, semanticId: `model-${i}`, parts: [{ shape: 'sphere', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], color: '#ffffff' }] }));
  await library.putMany(models.slice(0, 64));
  await library.putMany(models.slice(64));
  const server = await startCompanionServer({ workspaceRoot: root });
  try {
    const headers = { origin: server.origin, authorization: `Bearer ${server.token}` };
    const first = await (await fetch(server.origin + '/api/models', { headers })).json();
    assert.match(first.revision, /^[0-9a-f]{64}$/);
    const second = await (await fetch(server.origin + `/api/models?offset=64&expectedRevision=${first.revision}`, { headers })).json();
    assert.equal(first.models.length, 64);
    assert.equal(first.hasMore, true);
    assert.equal(second.models.length, 1);
    assert.equal(second.hasMore, false);
    assert.deepEqual([...first.models, ...second.models], await library.list());
    let suffix = 0;
    let insertion = { ...models[0]!, name: `Inserted ${suffix}`, semanticId: `inserted-${suffix}` };
    while (sha256Sync(canonicalize(insertion)) >= first.models[63].id) {
      suffix++;
      insertion = { ...models[0]!, name: `Inserted ${suffix}`, semanticId: `inserted-${suffix}` };
    }
    await library.put(models[0]);
    assert.equal((await (await fetch(server.origin + '/api/models', { headers })).json()).revision, first.revision);
    await library.put(insertion);
    assert.equal((await fetch(server.origin + `/api/models?offset=64&expectedRevision=${first.revision}`, { headers })).status, 409);
    assert.equal((await fetch(server.origin + '/api/models?offset=64', { headers })).status, 400);
    assert.equal((await fetch(server.origin + '/api/models?offset=999999999999999999999', { headers })).status, 400);
    const unsafe = await fetch(server.origin + '/api/models?q=private-secret', { headers });
    assert.equal(unsafe.status, 400);
    assert.ok(!(await unsafe.text()).includes('private-secret'));
  } finally { await server.close(); await rm(root, { recursive: true, force: true }); }
});

test('model drawing reuses a portable project snapshot with an empty workspace catalog', async () => {
  const fake = await fakeCodex('fixture-invalid');
  const root = await mkdtemp(join(tmpdir(), 'portable-model-'));
  fake.env.FAKE_CODEX_FIXTURE = join(fake.root, 'fixture.json');
  const server = await startCompanionServer({ workspaceRoot: root, codexOptions: { env: fake.env, tempRoot: fake.root } });
  try {
    const valid = validateProject(fixtureJson('storyboard'));
    assert.ok(valid.ok);
    const project = valid.project;
    const model = { version: 1, name: 'Farol', semanticId: 'farol', parts: [{ shape: 'sphere', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], color: '#ffffff' }] };
    const snapshot = { id: sha256Sync(canonicalize(model)), model };
    const scene = structuredClone(project.scenes[0]!.visual!);
    assert.ok('kind' in scene);
    scene.objects.push({ id: 'farol', type: 'model', params: { modelId: snapshot.id }, position: [0, 0, 0], rotation: [0, 0, 0], scale: 1, color: '#ffffff', animations: [] });
    const imported = applyKitSceneWithModels(project, project.scenes[0]!.sceneId, scene, [snapshot]);
    const before = JSON.stringify(imported);
    await writeFile(fake.env.FAKE_CODEX_FIXTURE, JSON.stringify({ scene, models: [] }));
    const headers = { origin: server.origin, authorization: `Bearer ${server.token}`, 'content-type': 'application/json' };
    const response = await fetch(server.origin + '/api/drawing/generate', { method: 'POST', headers, body: JSON.stringify({ project: imported, sceneId: imported.scenes[0]!.sceneId, modelMode: true }) });
    assert.equal(response.status, 200, await response.clone().text());
    assert.deepEqual((await response.json()).models, [snapshot]);
    assert.equal(JSON.stringify(imported), before);
  } finally { await server.close(); await rm(root, { recursive: true, force: true }); await fake.cleanup(); }
});

test('manual model publication requires authentication and verifies the whole batch', async () => {
  const root = await mkdtemp(join(tmpdir(), 'manual-models-'));
  const server = await startCompanionServer({ workspaceRoot: root });
  try {
    const model = { version: 1, name: 'Farol', semanticId: 'farol', parts: [{ shape: 'sphere', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], color: '#ffffff' }] };
    const snapshot = { id: sha256Sync(canonicalize(model)), model };
    const headers = { origin: server.origin, authorization: `Bearer ${server.token}`, 'content-type': 'application/json' };
    const post = (body: unknown, h = headers) => fetch(server.origin + '/api/models/resolve', { method: 'POST', headers: h, body: JSON.stringify(body) });
    assert.equal((await post({ models: [snapshot] }, { ...headers, authorization: 'Bearer wrong' })).status, 401);
    assert.equal((await post({ models: [snapshot] }, { ...headers, origin: 'https://invalid.example' })).status, 403);
    assert.equal((await post({ models: [snapshot] }, { ...headers, origin: '' })).status, 403);
    assert.equal((await post({ models: [{ ...snapshot, id: '0'.repeat(64) }] })).status, 400);
    assert.equal((await post({ models: [{ ...snapshot, extra: true }] })).status, 400);
    assert.equal((await post({ models: [snapshot], extra: true })).status, 400);
    await assert.rejects(readFile(join(root, '.models')), { code: 'ENOENT' });
    assert.equal((await post({ models: [snapshot] })).status, 200);
    assert.deepEqual((await (await fetch(server.origin + '/api/models', { headers })).json()).models, [snapshot]);
  } finally { await server.close(); await rm(root, { recursive: true, force: true }); }
});

test('authenticated model drawing publishes validated catalog and reuses it across projects', async () => {
  const fake = await fakeCodex('fixture-invalid');
  const root = await mkdtemp(join(tmpdir(), 'model-drawing-'));
  fake.env.FAKE_CODEX_FIXTURE = join(fake.root, 'fixture.json');
  const server = await startCompanionServer({ workspaceRoot: root, codexOptions: { env: fake.env, tempRoot: fake.root } });
  try {
    const validated = validateProject(fixtureJson('storyboard'));
    assert.ok(validated.ok);
    const project = validated.project;
    const scene = structuredClone(project.scenes[0]!.visual!);
    assert.ok('kind' in scene);
    scene.objects.push({ id: 'farol', type: 'model', params: { modelId: 'new-farol' }, position: [0, 0, 0], rotation: [0, 0, 0], scale: 1, color: '#ffffff', animations: [] });
    const model = { version: 1, name: 'Farol', semanticId: 'farol', parts: [{ shape: 'sphere', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], color: '#ffffff' }] };
    await writeFile(fake.env.FAKE_CODEX_FIXTURE, JSON.stringify({ scene, models: [{ alias: 'new-farol', model }] }));
    const headers = { origin: server.origin, authorization: `Bearer ${server.token}`, 'content-type': 'application/json' };
    const send = (value: unknown) => fetch(server.origin + '/api/drawing/generate', { method: 'POST', headers, body: JSON.stringify(value) });
    const input = { project, sceneId: project.scenes[0]!.sceneId, modelMode: true };
    assert.equal((await fetch(server.origin + '/api/models')).status, 401);
    assert.equal((await send({ ...input, extra: true })).status, 400);
    const first = await send(input);
    assert.equal(first.status, 200, await first.clone().text());
    const bundle = await first.json();
    assert.equal(bundle.models.length, 1);
    assert.equal(applyKitSceneWithModels(project, input.sceneId, bundle.scene, bundle.models).models?.[0]?.id, bundle.models[0].id);
    const catalogResponse = await fetch(server.origin + '/api/models', { headers });
    assert.deepEqual((await catalogResponse.json()).models, bundle.models);
    const saved = await readFile(join(root, '.models'), 'utf8');
    (scene.objects.at(-1)!.params as { modelId: string }).modelId = bundle.models[0].id;
    await writeFile(fake.env.FAKE_CODEX_FIXTURE, JSON.stringify({ scene, models: [] }));
    const secondProject = structuredClone(project);
    secondProject.projectId = 'second-project';
    const second = await send({ ...input, project: secondProject });
    assert.equal(second.status, 200, await second.clone().text());
    assert.deepEqual((await second.json()).models, bundle.models);
    const records = (await readFile(fake.env.FAKE_CODEX_RECORD, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    assert.equal(records.length, 2);
    for (const record of records) assert.ok(record.input.endsWith(JSON.stringify(record.schema)));
    assert.ok(records[1].input.includes(bundle.models[0].id));
    (scene.objects.at(-1)!.params as { modelId: string }).modelId = '0'.repeat(64);
    await writeFile(fake.env.FAKE_CODEX_FIXTURE, JSON.stringify({ scene, models: [] }));
    assert.equal((await send(input)).status, 502);
    assert.equal(await readFile(join(root, '.models'), 'utf8'), saved);
    fake.env.FAKE_CODEX_MODE = 'success';
    const legacy = await send({ project, sceneId: input.sceneId });
    assert.equal(legacy.status, 200);
    assert.equal((await legacy.json()).kind, 'kit');
  } finally { await server.close(); await rm(root, { recursive: true, force: true }); await fake.cleanup(); }
});

test('cancelled generation and failed catalog publication do not publish a batch', async () => {
  const fake = await fakeCodex('fixture-invalid');
  const root = await mkdtemp(join(tmpdir(), 'model-drawing-cancel-'));
  fake.env.FAKE_CODEX_FIXTURE = join(fake.root, 'fixture.json');
  let release!: () => void;
  let reached!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const cleaning = new Promise<void>(resolve => { reached = resolve; });
  let block = true;
  const server = await startCompanionServer({ workspaceRoot: root, codexOptions: { env: fake.env, tempRoot: fake.root,
    beforeCleanup: async () => { if (block) { block = false; reached(); await barrier; } } } });
  try {
    const validated = validateProject(fixtureJson('storyboard'));
    assert.ok(validated.ok);
    const project = validated.project;
    const scene = structuredClone(project.scenes[0]!.visual!);
    assert.ok('kind' in scene);
    scene.objects.push({ id: 'farol', type: 'model', params: { modelId: 'new-farol' }, position: [0, 0, 0], rotation: [0, 0, 0], scale: 1, color: '#ffffff', animations: [] });
    const model = { version: 1, name: 'Farol', semanticId: 'farol', parts: [{ shape: 'sphere', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], color: '#ffffff' }] };
    await writeFile(fake.env.FAKE_CODEX_FIXTURE, JSON.stringify({ scene, models: [{ alias: 'new-farol', model }] }));
    const headers = { origin: server.origin, authorization: `Bearer ${server.token}`, 'content-type': 'application/json' };
    const body = JSON.stringify({ project, sceneId: project.scenes[0]!.sceneId, modelMode: true });
    const abort = new AbortController();
    const pending = fetch(server.origin + '/api/drawing/generate', { method: 'POST', headers, body, signal: abort.signal }).catch(() => null);
    await cleaning;
    abort.abort();
    await pending;
    release();
    // Wait for admission to be released after subprocess cleanup.
    let response: Response;
    do { response = await fetch(server.origin + '/api/drawing/generate', { method: 'POST', headers, body: '{}' }); } while (response.status === 409);
    assert.equal(response.status, 400);
    await assert.rejects(readFile(join(root, '.models')), { code: 'ENOENT' });
    await mkdir(join(root, '.models'));
    const failure = await fetch(server.origin + '/api/drawing/generate', { method: 'POST', headers, body });
    assert.equal(failure.status, 500);
    assert.deepEqual((await (await fetch(server.origin + '/api/models', { headers })).json()).error.code, 'internal-error');
  } finally { release(); await server.close(); await rm(root, { recursive: true, force: true }); await fake.cleanup(); }
});
