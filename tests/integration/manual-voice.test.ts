import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { startCompanionServer } from '../../src/companion/server/http.ts';
import { bindingDigests } from '../../src/shared/digests.ts';
import { estimateWords } from '../../src/shared/voice/estimate.ts';
import { fixtureText } from '../helpers/fixtures.ts';
import { wavBytes, mp3Bytes } from '../helpers/media.ts';

test('manual voice HTTP: authenticated raw upload saves inspected duration, estimates, provenance and current bindings', async t => {
  const root = await mkdtemp(join(tmpdir(), 'manual-voice-'));
  const server = await startCompanionServer({ workspaceRoot: root });
  t.after(async () => { await server.close(); await rm(root, { recursive: true, force: true }); });
  const { projectId } = await server.store.importProject({ text: fixtureText('storyboard') });
  let current = await server.store.readProject(projectId);
  const sceneId = current.project.scenes[0]!.sceneId;
  const url = `${server.origin}/api/projects/${projectId}/scenes/${sceneId}/audio`;
  const headers = () => ({ authorization: `Bearer ${server.token}`, origin: server.origin,
    'content-type': 'audio/wav', 'x-expected-revision': String(current.revision),
    'x-expected-digest': current.digest, 'x-asset-license': encodeURIComponent('Permiso del autor – prueba') });
  const upload = (bytes = wavBytes({ durationMs: 2000 }), extra = {}, suffix = '') =>
    fetch(url + suffix, { method: 'PUT', headers: { ...headers(), ...extra }, body: new Uint8Array(bytes).buffer });
  const before = await readFile(join(root, projectId, 'project.json'));
  for (const [extra, expected] of [
    [{ authorization: '' }, 401], [{ origin: 'https://evil.test' }, 403], [{ origin: '' }, 403],
    [{ 'content-type': 'image/png' }, 415],
    [{ 'x-expected-revision': '' }, 400], [{ 'x-expected-revision': '1.5' }, 400],
    [{ 'x-expected-digest': '' }, 400], [{ 'x-asset-license': '' }, 400],
    [{ 'x-asset-license': '%FF' }, 400], [{ 'x-asset-license': '%0A' }, 400],
    [{ 'x-asset-license': 'a'.repeat(201) }, 400],
    [{ 'x-expected-revision': String(current.revision + 1) }, 409],
    [{ 'x-expected-digest': '0'.repeat(64) }, 409],
  ] as const) assert.equal((await upload(undefined, extra)).status, expected, JSON.stringify(extra));
  assert.equal((await upload(undefined, {}, '?align=vibi')).status, 501);
  assert.equal((await upload(undefined, {}, '?align=other')).status, 400);
  assert.equal((await upload(new Uint8Array([1, 2, 3]))).status, 415);
  assert.equal((await upload(wavBytes({ durationMs: 14800 }))).status, 422);
  assert.deepEqual(await readFile(join(root, projectId, 'project.json')), before);
  assert.deepEqual(await readdir(join(root, projectId, 'assets')), []);
  const response = await upload();
  assert.equal(response.status, 200, await response.clone().text());
  const result = await response.json() as any;
  current = await server.store.readProject(projectId);
  assert.deepEqual(result.opened, current);
  assert.equal(result.revision, current.revision);
  assert.equal(result.digest, current.digest);
  assert.equal(current.project.output.voiceMode, 'withVoice');
  const scene = current.project.scenes[0]!;
  assert.equal(scene.durationMs, 2300);
  assert.deepEqual(scene.words, estimateWords(scene.text, 2000));
  const asset = current.project.assets.find(a => a.assetId === scene.audio!.assetId)!;
  assert.equal(asset.durationMs, 2000);
  assert.deepEqual(asset.source, { origin: 'user', license: 'Permiso del autor – prueba', attribution: '' });
  const binding = (await bindingDigests(current.project)).scenes[0]!;
  assert.equal(scene.mediaBindings.audio!.inputDigest, binding.audioInputDigest);
  assert.equal(scene.mediaBindings.words!.inputDigest, binding.wordsInputDigest);
  assert.equal((await upload(mp3Bytes(80), { 'content-type': 'audio/mpeg' })).status, 200);
  current = await server.store.readProject(projectId);
  assert.equal((await upload(wavBytes({ durationMs: 500 }))).status, 200, 'short audio is not stretched to the scene minimum');
  current = await server.store.readProject(projectId);
  assert.ok(current.project.scenes[0]!.words.every(word => word.endMs <= 500));
  assert.equal(current.project.scenes[0]!.durationMs, 1000);
});

test('manual voice HTTP: refuses missing scene, foreign Host, missing Origin and oversized body without modifying disk', async t => {
  const root = await mkdtemp(join(tmpdir(), 'manual-voice-'));
  const server = await startCompanionServer({ workspaceRoot: root });
  t.after(async () => { await server.close(); await rm(root, { recursive: true, force: true }); });
  const created = await server.store.createProject();
  const response = await fetch(`${server.origin}/api/projects/${created.projectId}/scenes/missing/audio`, {
    method: 'PUT', headers: { authorization: `Bearer ${server.token}`, origin: server.origin,
      'content-type': 'audio/wav', 'x-expected-revision': String(created.revision),
      'x-expected-digest': created.digest, 'x-asset-license': 'Own test' }, body: new Uint8Array(wavBytes()).buffer,
  });
  assert.equal(response.status, 404);
  assert.equal((await server.store.readProject(created.projectId)).digest, created.digest);
  const imported = await server.store.importProject({ text: fixtureText('storyboard') });
  const current = await server.store.readProject(imported.projectId);
  const path = `/api/projects/${imported.projectId}/scenes/${current.project.scenes[0]!.sceneId}/audio`;
  const headers = { authorization: `Bearer ${server.token}`, origin: server.origin,
    'content-type': 'audio/wav', 'x-expected-revision': String(current.revision),
    'x-expected-digest': current.digest, 'x-asset-license': 'Own test' };
  const raw = (overrides: Record<string, string | undefined>) => new Promise<number>((resolve, reject) => {
    const req = httpRequest(server.origin + path, { method: 'PUT', headers: Object.fromEntries(Object.entries({ ...headers, ...overrides }).filter(([, value]) => value !== undefined)) }, res => {
      res.resume(); res.on('end', () => resolve(res.statusCode!));
    });
    req.on('error', reject); req.end();
  });
  assert.equal(await raw({ host: 'evil.test' }), 403);
  assert.equal(await raw({ origin: undefined }), 403);
  assert.equal(await raw({ 'content-length': String(52_428_801) }), 413);
  assert.equal((await server.store.readProject(imported.projectId)).digest, current.digest);
  assert.deepEqual(await readdir(join(root, imported.projectId, 'assets')), []);
});

test('manual voice HTTP: concurrent saved-revision uploads have one winner and estimates reject unrepresentable narration atomically', async t => {
  const root = await mkdtemp(join(tmpdir(), 'manual-voice-'));
  const server = await startCompanionServer({ workspaceRoot: root });
  t.after(async () => { await server.close(); await rm(root, { recursive: true, force: true }); });
  const { projectId } = await server.store.importProject({ text: fixtureText('storyboard') });
  let current = await server.store.readProject(projectId);
  const url = `${server.origin}/api/projects/${projectId}/scenes/${current.project.scenes[0]!.sceneId}/audio`;
  const upload = (method = 'PUT', body: ArrayBuffer | undefined = new Uint8Array(wavBytes()).buffer) => fetch(url, {
    method, headers: { authorization: `Bearer ${server.token}`, origin: server.origin, 'content-type': 'audio/wav',
      'x-expected-revision': String(current.revision), 'x-expected-digest': current.digest, 'x-asset-license': 'Own test' }, body,
  });
  assert.equal((await upload('POST')).status, 405);
  assert.equal((await upload('PUT', new ArrayBuffer(0))).status, 400);
  const responses = await Promise.all([upload(), upload()]);
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
  current = await server.store.readProject(projectId);
  assert.equal((await readdir(join(root, projectId, 'assets'))).length, 1);
  const changed = structuredClone(current.project);
  changed.scenes[0]!.text = 'x'.repeat(81);
  changed.revision += 1;
  await server.store.saveProject({ projectId, project: changed, expectedRevision: current.revision,
    expectedDigest: current.digest, operationId: crypto.randomUUID() });
  current = await server.store.readProject(projectId);
  const before = await readFile(join(root, projectId, 'project.json'));
  assert.equal((await upload()).status, 422);
  assert.deepEqual(await readFile(join(root, projectId, 'project.json')), before);
  assert.equal((await readdir(join(root, projectId, 'assets'))).length, 1);
});
