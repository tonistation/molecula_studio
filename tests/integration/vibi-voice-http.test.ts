import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startCompanionServer } from '../../src/companion/server/http.ts';
import { fixtureText } from '../helpers/fixtures.ts';
import { mp3Bytes } from '../helpers/media.ts';
import { bindingDigests } from '../../src/shared/digests.ts';

test('automatic voice boundary saves MP3/STT/bindings and source; consent, auth, stale revision and duplicates never spend', async t => {
  const root = await mkdtemp(join(tmpdir(), 'vibi-voice-'));
  let posts = 0; let stts = 0; let accounts = 0; let catalogs = 0; let fail = false; let words: string[] = [];
  let chosenUrl = ''; let mismatch = false; let partial = false;
  let hook: ((stage: 'tts' | 'stt') => Promise<void>) | undefined;
  let bytes = mp3Bytes(80);
  const fake = createServer(async (req, res) => {
    assert.equal(req.headers['xi-api-key'], 'fake-only-key');
    if (req.url === '/v1/default-voices?page_size=30') {
      catalogs++; res.end(JSON.stringify({ voices: [{ voice_id: 'alternate', name: 'Narradora', preview_url: 'https://private.test', api_key: 'PRIVATE' }], has_more: true })); return;
    }
    if (req.url === '/v1/auth/me') { accounts++; res.end(JSON.stringify({ credit_balance: 50, email: 'PRIVATE', api_key: 'fake-only-key' })); return; }
    if (req.method === 'POST') {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      if (req.url?.includes('text-to-speech')) {
        posts++; chosenUrl = req.url!; words = JSON.parse(Buffer.concat(chunks).toString()).text.match(/\S+/gu);
        res.writeHead(202).end(JSON.stringify({ id: 'tts' }));
      } else {
        stts++;
        const form = await new Response(Buffer.concat(chunks), { headers: { 'content-type': req.headers['content-type']! } }).formData();
        assert.deepEqual(Buffer.from(await (form.get('file') as File).arrayBuffer()), Buffer.from(bytes));
        res.writeHead(202).end(JSON.stringify({ task_id: 'stt' }));
      }
    } else if (req.url === '/audio/tts.mp3') res.end(bytes);
    else if (req.url === '/v1/history/tts') {
      await hook?.('tts');
      res.end(JSON.stringify(fail ? { status: 'failed', error: 'fake-only-key PRIVATE' } : { status: 'completed', result: { audio_url: `${base}/audio/tts.mp3` } }));
    } else {
      await hook?.('stt');
      res.end(JSON.stringify({ status: 'completed', result: { words: words.map((text, i) => ({ text: mismatch && i === 0 ? 'PRIVATE fake-only-key https://secret.test' : text, type: 'word', start: i * 0.1, end: partial && i >= words.length - 2 ? i * 0.1 : (i + 1) * 0.1 })) } }));
    }
  });
  await new Promise<void>(resolve => fake.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(fake.address() as { port: number }).port}`;
  const companion = await startCompanionServer({ workspaceRoot: root, codexOptions: { env: { PATH: '' } },
    vibiOptions: { apiKey: 'fake-only-key', voiceId: 'test-voice', baseUrl: base, pollIntervalMs: 1 } });
  t.after(async () => { await companion.close(); await new Promise<void>(resolve => fake.close(() => resolve())); await rm(root, { recursive: true, force: true }); });
  const { projectId } = await companion.store.importProject({ text: fixtureText('storyboard') });
  let current = await companion.store.readProject(projectId);
  const sceneId = current.project.scenes[0]!.sceneId;
  const file = join(root, projectId, 'project.json');
  const headers = { authorization: `Bearer ${companion.token}`, origin: companion.origin, 'content-type': 'application/json' };
  const url = `${companion.origin}/api/projects/${projectId}/scenes/${sceneId}/voice`;
  const generate = (patch: Record<string, unknown> = {}, extra = headers, signal?: AbortSignal) => fetch(url, { method: 'POST', headers: extra, signal,
    body: JSON.stringify({ expectedRevision: current.revision, expectedDigest: current.digest, consent: true, ...patch }) });
  assert.equal((await generate({ consent: false })).status, 400);
  assert.equal((await generate({}, { ...headers, authorization: '' })).status, 401);
  assert.equal((await generate({}, { ...headers, origin: 'https://evil.test' })).status, 403);
  assert.equal((await generate({ expectedRevision: current.revision + 1 })).status, 409);
  assert.equal((await generate({ expectedDigest: '0'.repeat(64) })).status, 409);
  assert.equal((await generate({ provider: 'untrusted-override' })).status, 400);
  const missing = await fetch(url.replace(`/scenes/${sceneId}/`, '/scenes/missing/'), { method: 'POST', headers,
    body: JSON.stringify({ expectedRevision: current.revision, expectedDigest: current.digest, consent: true }) });
  assert.equal(missing.status, 404);
  assert.equal(posts, 0); assert.equal(accounts, 0);
  const selection = { provider: 'elevenlabs', voiceId: 'alternate' };
  assert.equal((await generate(selection)).status, 400, 'unknown IDs rejected before catalog load');
  const catalogUrl = `${companion.origin}/api/vibi/voices`;
  assert.equal((await fetch(catalogUrl)).status, 401);
  assert.equal(catalogs, 0);
  const catalog = await fetch(catalogUrl, { headers });
  assert.equal(catalog.status, 200);
  assert.deepEqual(await catalog.json(), { provider: 'elevenlabs', voices: [{ voiceId: 'alternate', name: 'Narradora' }], hasMore: true });
  assert.equal(catalogs, 1);
  for (const patch of [{ provider: 'capcut', voiceId: 'alternate' }, { voiceId: 'alternate' }, { provider: 'elevenlabs' },
    { ...selection, voiceId: '../alternate' }, { ...selection, voiceId: 'unknown' }, { ...selection, modelId: 'override' }]) {
    assert.equal((await generate(patch)).status, 400);
  }
  assert.equal(posts, 0);
  const balance = await fetch(`${companion.origin}/api/vibi/credits`, { headers });
  assert.deepEqual(await balance.json(), { credits: 50 }); assert.equal(accounts, 1);
  let release!: () => void; let notify!: () => void;
  const waiting = new Promise<void>(resolve => { notify = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  hook = async stage => { if (stage === 'tts') { notify(); await gate; } };
  const first = generate(); await waiting;
  assert.equal((await generate()).status, 409); assert.equal(posts, 1);
  release();
  const good = await first; assert.equal(good.status, 200, await good.clone().text());
  const body = await good.json() as any; assert.equal(body.alignment, 'vibi'); assert.deepEqual(body.warnings, []);
  assert.equal(body.alignmentDiagnostic, undefined);
  assert.equal(body.alignmentKind, 'aligned');
  current = await companion.store.readProject(projectId);
  const saved = current.project.scenes[0]!;
  assert.equal(saved.words[0]!.endMs, 100);
  assert.equal(saved.words[0]!.text, words[0]);
  const digests = (await bindingDigests(current.project)).scenes[0]!;
  assert.equal(saved.mediaBindings.words!.inputDigest, digests.wordsInputDigest);
  assert.equal(saved.mediaBindings.audio!.inputDigest, digests.audioInputDigest);
  const asset = current.project.assets.find(item => item.assetId === saved.audio!.assetId)!;
  assert.equal(chosenUrl, '/v1/text-to-speech/test-voice');
  assert.deepEqual(asset.source, { origin: 'provider', license: 'Vibi – según plan', attribution: 'elevenlabs/test-voice' });
  assert.deepEqual((await companion.store.readAsset(projectId, asset.assetId)).bytes, bytes);
  assert.doesNotMatch(await readFile(file, 'utf8'), /fake-only-key|PRIVATE/);
  hook = undefined;
  const chosen = await generate(selection);
  assert.equal(chosen.status, 200, await chosen.clone().text());
  current = await companion.store.readProject(projectId);
  assert.equal(chosenUrl, '/v1/text-to-speech/alternate');
  const chosenAsset = current.project.assets.find(item => item.assetId === current.project.scenes[0]!.audio!.assetId)!;
  assert.equal(chosenAsset.source.attribution, 'elevenlabs/alternate');
  const anchors = current.project.scenes[0]!.words.slice(0, -2);
  const revision = current.revision;
  partial = true;
  const mixed = await generate(); assert.equal(mixed.status, 200, await mixed.clone().text());
  const mixedBody = await mixed.json() as any;
  assert.equal(mixedBody.alignment, 'estimated'); assert.equal(mixedBody.alignmentKind, 'partial');
  assert.equal(mixedBody.alignmentDiagnostic.repairedWordCount, 2);
  assert.match(mixedBody.warnings[0], /Alineación parcial:.*2 palabras con tiempos estimados/);
  current = await companion.store.readProject(projectId);
  assert.equal(current.revision, revision + 1);
  const mixedScene = current.project.scenes[0]!;
  assert.deepEqual(mixedScene.words.slice(0, -2), anchors);
  assert.equal(mixedScene.words.at(-2)!.startMs, anchors.at(-1)!.endMs);
  assert.ok(mixedScene.words.at(-1)!.endMs <= asset.durationMs!);
  const mixedDigests = (await bindingDigests(current.project)).scenes[0]!;
  assert.equal(mixedScene.mediaBindings.words!.inputDigest, mixedDigests.wordsInputDigest);
  assert.equal(mixedScene.mediaBindings.audio!.inputDigest, mixedDigests.audioInputDigest);
  assert.deepEqual(current.project.assets.find(item => item.assetId === mixedScene.audio!.assetId)!.source, asset.source);
  assert.doesNotMatch(await readFile(file, 'utf8'), /alignmentKind|repairedWordCount|alignmentDiagnostic/);
  partial = false;
  mismatch = true;
  const estimated = await generate(); assert.equal(estimated.status, 200);
  const fallback = await estimated.json() as any;
  assert.equal(fallback.alignment, 'estimated');
  assert.equal(fallback.alignmentKind, 'estimated');
  assert.deepEqual(fallback.alignmentDiagnostic, { reason: 'text-mismatch', expectedWordCount: words.length,
    receivedEntryCount: words.length, spokenWordCount: words.length, durationMs: asset.durationMs, wordIndex: 0 });
  assert.match(fallback.warnings[0], /\[text-mismatch\]/);
  assert.doesNotMatch(JSON.stringify(fallback), /fake-only-key|PRIVATE|secret.test/);
  current = await companion.store.readProject(projectId);
  const fallbackDigests = (await bindingDigests(current.project)).scenes[0]!;
  assert.equal(current.project.scenes[0]!.mediaBindings.words!.inputDigest, fallbackDigests.wordsInputDigest);
  assert.doesNotMatch(await readFile(file, 'utf8'), /alignmentDiagnostic|text-mismatch|fake-only-key|PRIVATE/);
  mismatch = false;
  const before = await readFile(file);
  fail = true; hook = undefined;
  const failed = await generate(); assert.equal(failed.status, 502); assert.doesNotMatch(await failed.text(), /fake-only-key|PRIVATE/);
  assert.deepEqual(await readFile(file), before);
  fail = false;
  bytes = mp3Bytes(600);
  const sttBeforeLong = stts;
  assert.equal((await generate()).status, 422); assert.equal(stts, sttBeforeLong);
  assert.deepEqual(await readFile(file), before); bytes = mp3Bytes(80);
  for (const stage of ['tts', 'stt'] as const) {
    const original = await readFile(file, 'utf8'); const count = stts;
    hook = async at => { if (at === stage) await writeFile(file, original + '\n'); };
    const conflict = await generate(); assert.equal(conflict.status, 409, await conflict.text());
    assert.equal(await readFile(file, 'utf8'), original + '\n');
    assert.equal(stts, count + (stage === 'stt' ? 1 : 0));
    current = await companion.store.readProject(projectId);
  }
});

test('automatic voice disconnect stops local polling without publishing audio', async t => {
  const root = await mkdtemp(join(tmpdir(), 'voice-cancel-'));
  let notify!: () => void; let closed!: () => void;
  const polling = new Promise<void>(resolve => { notify = resolve; });
  const disconnected = new Promise<void>(resolve => { closed = resolve; });
  const fake = createServer((req, res) => {
    req.resume();
    if (req.method === 'POST') res.writeHead(202).end(JSON.stringify({ id: 'task' }));
    else { res.once('close', closed); notify(); }
  });
  await new Promise<void>(resolve => fake.listen(0, '127.0.0.1', resolve));
  const companion = await startCompanionServer({ workspaceRoot: root, vibiOptions: { apiKey: 'fake-only', voiceId: 'voice',
    baseUrl: `http://127.0.0.1:${(fake.address() as { port: number }).port}`, pollIntervalMs: 1, timeoutMs: 1000 } });
  t.after(async () => { await companion.close(); await new Promise<void>(r => fake.close(() => r())); await rm(root, { recursive: true, force: true }); });
  const { projectId } = await companion.store.importProject({ text: fixtureText('storyboard') });
  const current = await companion.store.readProject(projectId);
  const controller = new AbortController();
  const response = fetch(`${companion.origin}/api/projects/${projectId}/scenes/${current.project.scenes[0]!.sceneId}/voice`, { method: 'POST', signal: controller.signal,
    headers: { authorization: `Bearer ${companion.token}`, origin: companion.origin, 'content-type': 'application/json' },
    body: JSON.stringify({ expectedRevision: current.revision, expectedDigest: current.digest, consent: true }) });
  await polling; controller.abort(); await assert.rejects(response); await disconnected;
  assert.equal((await companion.store.readProject(projectId)).digest, current.digest);
});
