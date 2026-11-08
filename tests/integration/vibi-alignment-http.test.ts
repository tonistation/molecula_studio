import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { Worker } from 'node:worker_threads';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startCompanionServer } from '../../src/companion/server/http.ts';
import { fixtureText } from '../helpers/fixtures.ts';
import { wavBytes } from '../helpers/media.ts';
import { bindingDigests } from '../../src/shared/digests.ts';
import { estimateWords } from '../../src/shared/voice/estimate.ts';

for (const action of ['disconnect', 'save'] as const) {
  test(`manual alignment never submits STT after ${action} during worker inspection`, { timeout: 15000 }, async t => {
    const root = await mkdtemp(join(tmpdir(), 'vibi-pre-submit-'));
    let posts = 0;
    const provider = createServer((req, res) => {
      req.resume();
      if (req.method === 'POST') posts++;
      res.writeHead(500).end();
    });
    await new Promise<void>(resolve => provider.listen(0, '127.0.0.1', resolve));
    const companion = await startCompanionServer({ workspaceRoot: root, vibiOptions: {
      apiKey: 'fake-only-key', baseUrl: `http://127.0.0.1:${(provider.address() as { port: number }).port}`,
    } });
    t.after(async () => { await companion.close(); await new Promise<void>(resolve => provider.close(() => resolve())); await rm(root, { recursive: true, force: true }); });
    const { projectId } = await companion.store.importProject({ text: fixtureText('storyboard') });
    const current = await companion.store.readProject(projectId);
    const projectDir = join(root, projectId);
    const snapshot = async () => {
      const entries = await readdir(projectDir, { recursive: true, withFileTypes: true });
      return Promise.all(entries.filter(entry => entry.isFile()).sort((a, b) => join(a.parentPath, a.name).localeCompare(join(b.parentPath, b.name))).map(async entry => {
        const path = join(entry.parentPath, entry.name);
        return [path, await readFile(path)] as const;
      }));
    };
    let release!: () => void; let inspected!: () => void; let closed!: () => void; let cleaned!: () => void;
    const inspection = new Promise<void>(resolve => { inspected = resolve; });
    const disconnected = new Promise<void>(resolve => { closed = resolve; });
    const cleanup = new Promise<void>(resolve => { cleaned = resolve; });
    const once = Worker.prototype.once;
    let released = false;
    let exit: (() => void) | undefined;
    // Hold inspection callbacks, not native worker shutdown, until the race is committed.
    t.mock.method(Worker.prototype, 'once', function (this: Worker, event: string | symbol, listener: (...args: unknown[]) => void) {
      if (event === 'message') return once.call(this, event, (...args: unknown[]) => {
        release = () => { released = true; listener(...args); exit?.(); };
        inspected();
      });
      if (event === 'exit' && !released) return once.call(this, event, (...args: unknown[]) => {
        if (released) listener(...args);
        else exit = () => listener(...args);
      });
      return once.call(this, event, listener);
    });
    companion.server.on('request', (_req, res) => {
      res.once('close', closed);
      const removeListener = res.removeListener;
      t.mock.method(res, 'removeListener', function (this: typeof res, event: string | symbol, listener: (...args: unknown[]) => void) {
        const result = removeListener.call(this, event, listener);
        if (event === 'close' && listener.name === 'cancel') cleaned();
        return result;
      });
    });
    const controller = new AbortController();
    const response = fetch(`${companion.origin}/api/projects/${projectId}/scenes/${current.project.scenes[0]!.sceneId}/audio?align=vibi`, {
      method: 'PUT', signal: controller.signal, headers: { authorization: `Bearer ${companion.token}`, origin: companion.origin,
        'content-type': 'audio/wav', 'x-expected-revision': String(current.revision), 'x-expected-digest': current.digest,
        'x-asset-license': 'Own test', 'x-vibi-consent': '1' }, body: new Uint8Array(wavBytes({ durationMs: 2000 })).buffer,
    });
    await inspection;
    if (action === 'disconnect') {
      controller.abort(); await assert.rejects(response); await disconnected;
    } else {
      await companion.store.saveProject({ projectId, project: { ...current.project, revision: current.revision + 1, idea: 'Concurrent winner' },
        expectedRevision: current.revision, expectedDigest: current.digest, operationId: 'inspection-winner' });
    }
    const winner = await snapshot();
    release();
    if (action === 'save') {
      const result = await response;
      assert.equal(result.status, 409, await result.text());
    }
    await cleanup;
    assert.equal(posts, 0);
    assert.deepEqual(await snapshot(), winner);
    if (action === 'disconnect') assert.equal((await companion.store.readProject(projectId)).digest, current.digest);
  });
}

test('manual Vibi alignment requires consent, saves authoritative words/bindings, warns on mismatch and preserves disk on failure', async t => {
  const root = await mkdtemp(join(tmpdir(), 'vibi-http-'));
  let mode = 'match'; let posts = 0; let tokens: string[] = [];
  const provider = createServer(async (req, res) => {
    assert.equal(req.headers['xi-api-key'], 'fake-only-key');
    req.resume();
    if (req.method === 'POST') { posts++; res.writeHead(202).end(JSON.stringify({ task_id: 'task-1' })); }
    else res.end(JSON.stringify(mode === 'fail' ? { status: 'failed', detail_error: 'fake-only-key SECRET-TEXT' } : {
      status: 'completed', result: { words: (mode === 'match' ? tokens : [...tokens, 'extra']).map((text, i) => ({ text,
        start: i * 0.1, end: (i + 1) * 0.1, type: 'word' })) },
    }));
  });
  await new Promise<void>(resolve => provider.listen(0, '127.0.0.1', resolve));
  const companion = await startCompanionServer({ workspaceRoot: root, codexOptions: { env: { PATH: '' } },
    vibiOptions: { apiKey: 'fake-only-key', baseUrl: `http://127.0.0.1:${(provider.address() as { port: number }).port}`, pollIntervalMs: 2 } });
  t.after(async () => { await companion.close(); await new Promise<void>(resolve => provider.close(() => resolve())); await rm(root, { recursive: true, force: true }); });
  const { projectId } = await companion.store.importProject({ text: fixtureText('storyboard') });
  let current = await companion.store.readProject(projectId);
  const scene = current.project.scenes[0]!;
  tokens = scene.text.match(/\S+/gu)!;
  const url = `${companion.origin}/api/projects/${projectId}/scenes/${scene.sceneId}/audio?align=vibi`;
  const upload = (extra: Record<string, string> = {}) => fetch(url, { method: 'PUT', headers: {
    authorization: `Bearer ${companion.token}`, origin: companion.origin, 'content-type': 'audio/wav',
    'x-expected-revision': String(current.revision), 'x-expected-digest': current.digest,
    'x-asset-license': 'Own test', 'x-vibi-consent': '1', ...extra }, body: new Uint8Array(wavBytes({ durationMs: 2000 })).buffer });
  assert.equal((await upload({ 'x-vibi-consent': '' })).status, 400); assert.equal(posts, 0);
  assert.equal((await upload({ 'x-expected-digest': '0'.repeat(64) })).status, 409); assert.equal(posts, 0);
  const capability = await fetch(`${companion.origin}/api/capabilities`, { headers: { authorization: `Bearer ${companion.token}` } });
  assert.deepEqual(await capability.json(), { codex: false, vibi: true, vibiVoiceConfigured: false }); assert.equal(posts, 0);
  const good = await upload(); assert.equal(good.status, 200, await good.clone().text());
  const body = await good.json() as any; assert.equal(body.alignment, 'vibi'); assert.deepEqual(body.warnings, []);
  assert.equal(body.alignmentDiagnostic, undefined);
  current = await companion.store.readProject(projectId);
  assert.equal(current.project.scenes[0]!.words[0]!.endMs, 100);
  assert.equal(current.project.scenes[0]!.words[0]!.text, tokens[0]);
  assert.equal(current.project.scenes[0]!.mediaBindings.words!.inputDigest, (await bindingDigests(current.project)).scenes[0]!.wordsInputDigest);
  mode = 'mismatch';
  const fallback = await upload(); assert.equal(fallback.status, 200);
  const fallbackBody = await fallback.json() as any; assert.equal(fallbackBody.alignment, 'estimated'); assert.equal(fallbackBody.warnings.length, 1);
  assert.deepEqual(fallbackBody.alignmentDiagnostic, { reason: 'word-count-mismatch', expectedWordCount: tokens.length,
    receivedEntryCount: tokens.length + 1, spokenWordCount: tokens.length + 1, durationMs: 2000 });
  assert.match(fallbackBody.warnings[0], /\[word-count-mismatch\]/);
  current = await companion.store.readProject(projectId);
  assert.deepEqual(current.project.scenes[0]!.words, estimateWords(scene.text, 2000));
  const before = await readFile(join(root, projectId, 'project.json'));
  assert.doesNotMatch(before.toString(), /alignmentDiagnostic|spokenWordCount|word-count-mismatch/);
  mode = 'fail'; const failure = await upload(); assert.equal(failure.status, 502);
  assert.doesNotMatch(await failure.text(), /fake-only-key|SECRET-TEXT/);
  assert.deepEqual(await readFile(join(root, projectId, 'project.json')), before);
  assert.doesNotMatch(before.toString(), /fake-only-key/); assert.equal(posts, 3);
});

test('disconnecting an accepted paid alignment aborts local polling and leaves the saved project unchanged', async t => {
  const root = await mkdtemp(join(tmpdir(), 'vibi-abort-'));
  let notifyPoll!: () => void;
  let notifyClosed!: () => void;
  const polling = new Promise<void>(resolve => { notifyPoll = resolve; });
  const closed = new Promise<void>(resolve => { notifyClosed = resolve; });
  const provider = createServer((req, res) => {
    req.resume();
    if (req.method === 'POST') res.writeHead(202).end(JSON.stringify({ task_id: 'pending-task' }));
    else { res.once('close', notifyClosed); notifyPoll(); }
  });
  await new Promise<void>(resolve => provider.listen(0, '127.0.0.1', resolve));
  const companion = await startCompanionServer({ workspaceRoot: root, vibiOptions: {
    apiKey: 'fake-cancel-key', baseUrl: `http://127.0.0.1:${(provider.address() as { port: number }).port}`, pollIntervalMs: 2, timeoutMs: 1000,
  } });
  t.after(async () => { await companion.close(); await new Promise<void>(resolve => provider.close(() => resolve())); await rm(root, { recursive: true, force: true }); });
  const { projectId } = await companion.store.importProject({ text: fixtureText('storyboard') });
  const current = await companion.store.readProject(projectId);
  const controller = new AbortController();
  const response = fetch(`${companion.origin}/api/projects/${projectId}/scenes/${current.project.scenes[0]!.sceneId}/audio?align=vibi`, {
    method: 'PUT', signal: controller.signal, headers: { authorization: `Bearer ${companion.token}`, origin: companion.origin,
      'content-type': 'audio/wav', 'x-expected-revision': String(current.revision), 'x-expected-digest': current.digest,
      'x-asset-license': 'Own test', 'x-vibi-consent': '1' }, body: new Uint8Array(wavBytes()).buffer,
  });
  await polling; controller.abort();
  await assert.rejects(response);
  await closed;
  assert.equal((await companion.store.readProject(projectId)).digest, current.digest);
});
