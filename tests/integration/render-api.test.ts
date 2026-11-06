import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startCompanionServer } from '../../src/companion/server/http.ts';
import { createRenderService } from '../../src/companion/render/render-service.ts';
import { fixtureText } from '../helpers/fixtures.ts';
import { wavBytes } from '../helpers/media.ts';
import { serializeProject } from '../../src/shared/schema/index.ts';

test('render HTTP: saved revision, authentication, global exclusion, progress, download and token expiry', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'render-api-')));
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let inputProps: any;
  const renderer = createRenderService({
    bundle: async () => '/bundle',
    selectComposition: async options => { inputProps = options.inputProps; return {} as never; },
    renderMedia: async options => {
      options.onProgress?.({ progress: 0.5 } as never);
      await gate;
      await writeFile(options.outputLocation!, 'complete video');
      return { buffer: null, slowestFrames: [], contentType: 'video/mp4' };
    },
  });
  const server = await startCompanionServer({ workspaceRoot: root, renderer });
  t.after(async () => { release(); await server.close(); await rm(root, { recursive: true, force: true }); });
  const imported = await server.store.importProject({ text: fixtureText('storyboard') });
  const id = imported.projectId;
  const read = await server.store.readProject(id);
  const original = await readFile(join(root, id, 'project.json'));
  const path = `/api/projects/${id}/renders`;
  const request = (url: string, method = 'GET', body?: unknown, headers = {}) => fetch(server.origin + url, {
    method, headers: { authorization: `Bearer ${server.token}`, origin: server.origin, 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  assert.equal((await fetch(server.origin + path)).status, 401);
  assert.equal((await request(path, 'POST', { expectedRevision: -1 })).status, 400);
  assert.equal((await request(path, 'POST', { expectedRevision: read.revision + 1 })).status, 409);
  assert.equal((await request(path, 'POST', { expectedRevision: read.revision }, { origin: 'https://evil.test' })).status, 403);
  const started = await request(path, 'POST', { expectedRevision: read.revision });
  assert.equal(started.status, 202);
  const { renderId } = await started.json() as any;
  assert.match(renderId, /^[a-z0-9_-]+$/);
  const other = await server.store.createProject();
  const duplicate = await request(`/api/projects/${other.projectId}/renders`, 'POST', { expectedRevision: other.revision });
  assert.equal(duplicate.status, 409);
  assert.match(await duplicate.text(), /Ya hay una exportación en curso/);
  for (let i = 0; i < 100 && inputProps === undefined; i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(inputProps.scenes[0].text, read.project.scenes[0]!.text);
  assert.equal((await request(`${path}/${renderId}/file`)).status, 409);
  assert.equal((await request(`/api/projects/${other.projectId}/renders/${renderId}`)).status, 404);
  const active = await (await request(`${path}/${renderId}`)).json() as any;
  assert.equal(active.status, 'rendering');
  assert.equal(active.progress, 0.5);
  assert.equal(JSON.stringify(active).includes('token'), false);
  release();
  let done: any;
  for (let i = 0; i < 100; i++) {
    done = await (await request(`${path}/${renderId}`)).json();
    if (done.status !== 'rendering') break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(done.status, 'completed');
  assert.equal(done.progress, 1);
  assert.ok(done.outputPath.startsWith(join(root, '.renders', id)));
  const file = await request(`${path}/${renderId}/file`);
  assert.equal(file.headers.get('content-type'), 'video/mp4');
  assert.match(file.headers.get('content-disposition')!, /attachment/);
  assert.equal(await file.text(), 'complete video');
  assert.deepEqual(await readFile(join(root, id, 'project.json')), original);
  await unlink(done.outputPath);
  await writeFile(join(root, 'external.mp4'), 'private');
  await symlink(join(root, 'external.mp4'), done.outputPath);
  assert.equal((await request(`${path}/${renderId}/file`)).status, 404, 'replaced output symlink is not downloadable');
});

test('render-assets: random per-render capability, manifest only, Host boundary, no API auth exemption and expiry on failure', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'render-assets-')));
  let release!: () => void;
  let entered!: () => void;
  let assetUrl = '';
  const gate = new Promise<void>(resolve => { release = resolve; });
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const tokens: string[] = [];
  const server = await startCompanionServer({ workspaceRoot: root, renderer: async options => {
    assetUrl = options.assetUrls!.voice!;
    tokens.push(new URL(assetUrl).pathname.split('/')[2]!);
    entered();
    await gate;
    if (tokens.length > 1) {
      const output = join(root, 'retry.mp4');
      await writeFile(output, 'complete video');
      return output;
    }
    throw new Error(`renderer error must not expose ${assetUrl}`);
  } });
  t.after(async () => { release(); await server.close(); await rm(root, { recursive: true, force: true }); });
  const source = JSON.parse(fixtureText('storyboard'));
  const bytes = wavBytes();
  source.output.voiceMode = 'withVoice';
  source.scenes[0].audio = { assetId: 'voice', offsetMs: 0, gainDb: 0 };
  source.assets = [{ assetId: 'voice', kind: 'audio', path: 'assets/voice.wav', mimeType: 'audio/wav',
    byteLength: bytes.length, sha256: null, durationMs: 1000,
    source: { origin: 'fixture', license: 'Synthetic test data', attribution: '' } }];
  const imported = await server.store.importProject({ text: JSON.stringify(source) });
  await server.store.relinkAsset({ projectId: imported.projectId, assetId: 'voice', bytes, mimeType: 'audio/wav' });
  const saved = await server.store.readProject(imported.projectId);
  const base = `/api/projects/${imported.projectId}/renders`;
  const headers = { authorization: `Bearer ${server.token}`, origin: server.origin, 'content-type': 'application/json' };
  const started = await fetch(server.origin + base, { method: 'POST', headers, body: JSON.stringify({ expectedRevision: saved.revision }) });
  assert.equal(started.status, 202);
  const { renderId } = await started.json() as any;
  await ready;
  assert.match(tokens[0]!, /^[a-f0-9]{64}$/);
  const response = await fetch(assetUrl, { headers: { origin: 'http://localhost:39999' } });
  assert.equal(response.status, 200, 'Remotion bundle origin needs no companion bearer token');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), Buffer.from(bytes));
  assert.equal((await fetch(assetUrl.replace('/voice', '/project_json'))).status, 404);
  assert.equal((await fetch(assetUrl.replace(tokens[0]!, '0'.repeat(64)))).status, 404);
  assert.equal((await fetch(`${server.origin}${base}/${renderId}?token=${tokens[0]}`)).status, 401);
  assert.equal((await fetch(assetUrl, { method: 'POST', headers: { origin: server.origin } })).status, 405);
  const badHost = await new Promise<number>(resolve => {
    const request = httpRequest(assetUrl, { headers: { host: 'evil.test' } }, response => { response.resume(); resolve(response.statusCode!); });
    request.end();
  });
  assert.equal(badHost, 403);
  await writeFile(join(root, imported.projectId, 'assets', 'voice.wav'), 'tampered');
  assert.equal((await fetch(assetUrl)).status, 409);
  await unlink(join(root, imported.projectId, 'assets', 'voice.wav'));
  await writeFile(join(root, 'outside.wav'), bytes);
  await symlink(join(root, 'outside.wav'), join(root, imported.projectId, 'assets', 'voice.wav'));
  const unsafe = await fetch(assetUrl);
  assert.equal(unsafe.status, 404, 'store treats a symlink asset as unavailable');
  assert.equal((await unsafe.text()).includes(root), false);
  assert.equal((await fetch(assetUrl + '/%2e%2e/project.json')).status, 404);
  release();
  let failed: any;
  for (let i = 0; i < 100; i++) {
    failed = await (await fetch(`${server.origin}${base}/${renderId}`, { headers })).json();
    if (failed.status === 'failed') break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(failed.status, 'failed');
  assert.match(failed.error, /No se pudo exportar/);
  assert.equal(JSON.stringify(failed).includes(tokens[0]!), false);
  assert.equal((await fetch(assetUrl)).status, 404);
  const retry = await fetch(server.origin + base, { method: 'POST', headers, body: JSON.stringify({ expectedRevision: saved.revision }) });
  assert.equal(retry.status, 202, 'failure releases admission');
  const retryId = (await retry.json() as any).renderId;
  let completed: any;
  for (let i = 0; i < 100; i++) {
    completed = await (await fetch(`${server.origin}${base}/${retryId}`, { headers })).json();
    if (completed.status === 'completed') break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(completed.status, 'completed');
  assert.equal((await fetch(assetUrl)).status, 404, 'capability also expires on success');
  assert.equal(tokens.length, 2);
  assert.notEqual(tokens[0], tokens[1]);
  assert.equal((await readFile(join(root, imported.projectId, 'project.json'), 'utf8')).includes(tokens[0]!), false);
});

test('render admission is atomic and keeps the accepted saved document when disk changes during bundling', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'render-admission-')));
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let received: any;
  const renderer = createRenderService({
    bundle: async () => { await gate; return '/bundle'; },
    selectComposition: async options => { received = options.inputProps; return {} as never; },
    renderMedia: async options => {
      await writeFile(options.outputLocation!, 'video');
      return { buffer: null, slowestFrames: [], contentType: 'video/mp4' };
    },
  });
  const server = await startCompanionServer({ workspaceRoot: root, renderer });
  t.after(async () => { release(); await server.close(); await rm(root, { recursive: true, force: true }); });
  const imported = await server.store.importProject({ text: fixtureText('storyboard') });
  const saved = await server.store.readProject(imported.projectId);
  const url = `${server.origin}/api/projects/${imported.projectId}/renders`;
  const headers = { authorization: `Bearer ${server.token}`, origin: server.origin, 'content-type': 'application/json' };
  const start = () => fetch(url, { method: 'POST', headers, body: JSON.stringify({ expectedRevision: saved.revision }) });
  const results = await Promise.all([start(), start()]);
  assert.deepEqual(results.map(result => result.status).sort(), [202, 409]);
  const renderId = (await results.find(result => result.status === 202)!.json() as any).renderId;
  const changed = structuredClone(saved.project);
  changed.scenes[0]!.text = 'Cambio posterior en disco';
  const changedBytes = serializeProject(changed);
  await writeFile(join(root, imported.projectId, 'project.json'), changedBytes);
  release();
  let done: any;
  for (let i = 0; i < 100; i++) {
    done = await (await fetch(`${url}/${renderId}`, { headers })).json();
    if (done.status !== 'rendering') break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(done.status, 'completed');
  assert.equal(received.scenes[0].text, saved.project.scenes[0]!.text);
  assert.equal(await readFile(join(root, imported.projectId, 'project.json'), 'utf8'), changedBytes);
  const empty = await server.store.createProject();
  const rejected = await fetch(`${server.origin}/api/projects/${empty.projectId}/renders`, {
    method: 'POST', headers, body: JSON.stringify({ expectedRevision: empty.revision }),
  });
  assert.equal(rejected.status, 422);
  assert.match(await rejected.text(), /al menos una escena/);
});
