import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, writeFile, symlink, stat, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GeneratedVoiceSamples, sampleKey } from '../../src/companion/providers/generated-voice-samples.ts';
import { mp3Bytes } from '../helpers/media.ts';
import { createServer, request } from 'node:http';
import { startCompanionServer } from '../../src/companion/server/http.ts';
import { VOICE_SAMPLE_PHRASE } from '../../src/shared/voice/sample-phrase.ts';

test('generated samples reserve once, replay bytes, and retain ambiguous failures across restart', async t => {
  const root = await mkdtemp(join(tmpdir(), 'voice-samples-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const key = sampleKey('elevenlabs', 'voice', 'model');
  assert.notEqual(key, sampleKey('elevenlabs', 'voice', 'other'));
  assert.notEqual(key, sampleKey('capcut', 'voice', 'model'));
  const samples = new GeneratedVoiceSamples(root);
  assert.equal(await samples.get(key), null);
  await assert.rejects(() => access(join(root, '.voice-samples')), { code: 'ENOENT' });
  let calls = 0; let release!: () => void; let started!: () => void;
  const waiting = new Promise<void>(resolve => { started = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const bytes = mp3Bytes(80);
  const first = samples.generate(key, async () => { calls++; started(); await gate; return bytes; });
  await waiting;
  await assert.rejects(() => new GeneratedVoiceSamples(root).generate(key, async () => { calls++; return bytes; }), /anterior/);
  release(); assert.deepEqual(Buffer.from(await first), Buffer.from(bytes));
  assert.deepEqual(Buffer.from((await samples.get(key))!), Buffer.from(bytes));
  assert.deepEqual(Buffer.from(await samples.generate(key, async () => { calls++; return bytes; })), Buffer.from(bytes));
  assert.equal(calls, 1);
  const failed = sampleKey('elevenlabs', 'other', 'model');
  await assert.rejects(() => samples.generate(failed, async () => { calls++; throw new Error('disconnect'); }));
  await assert.rejects(() => new GeneratedVoiceSamples(root).generate(failed, async () => { calls++; return bytes; }), /anterior/);
  assert.equal(calls, 2);
  const files = await readdir(join(root, '.voice-samples'));
  assert.equal(files.length, 2);
  assert.equal((await stat(join(root, '.voice-samples'))).mode & 0o077, 0);
  assert.equal((await stat(join(root, '.voice-samples', key))).mode & 0o077, 0);
  await writeFile(join(root, '.voice-samples', key), 'malformed');
  await assert.rejects(() => samples.get(key), /anterior/);
});

test('MiniMax language preflight failure does not reserve or submit and permits a later valid attempt', async t => {
  const root = await mkdtemp(join(tmpdir(), 'sample-minimax-'));
  let valid = false; let posts = 0;
  const fake = createServer((req, res) => {
    if (req.url?.startsWith('/v1/minimax/system-voices')) { res.end(JSON.stringify({ voice_list: [{ voice_id: 'voice', voice_name: 'Voice' }], has_more: false })); return; }
    if (req.url === '/v1/languages?provider=minimax') { res.end(JSON.stringify(valid ? [{ code: 'Spanish', name: 'Spanish' }] : [])); return; }
    if (req.url === '/v1/text-to-speech/voice') { posts++; req.resume(); res.writeHead(202).end(JSON.stringify({ id: 'job' })); return; }
    if (req.url === '/v1/history/job') { res.end(JSON.stringify({ status: 'completed', result: { audio_url: `${base}/audio/job.mp3` } })); return; }
    if (req.url === '/audio/job.mp3') { res.end(mp3Bytes(80)); return; }
    res.writeHead(500).end();
  });
  await new Promise<void>(resolve => fake.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(fake.address() as { port: number }).port}`;
  const server = await startCompanionServer({ workspaceRoot: root, vibiOptions: { apiKey: 'fake-key', provider: 'minimax', voiceId: 'voice', modelId: 'model', baseUrl: base, pollIntervalMs: 1 } });
  t.after(async () => { await server.close(); await new Promise<void>(resolve => fake.close(() => resolve())); await rm(root, { recursive: true, force: true }); });
  const headers = { authorization: `Bearer ${server.token}`, origin: server.origin, 'content-type': 'application/json' };
  await fetch(`${server.origin}/api/vibi/voices`, { headers });
  const url = `${server.origin}/api/vibi/voices/minimax/voice/generated-sample`;
  const post = () => fetch(url, { method: 'POST', headers, body: '{"consent":true}' });
  const failed = await post(); assert.notEqual(failed.status, 200); assert.notEqual((await failed.json() as any).error.code, 'sample-unresolved');
  assert.equal(posts, 0); await assert.rejects(() => access(join(root, '.voice-samples')), { code: 'ENOENT' });
  valid = true; const good = await post(); assert.equal(good.status, 200, await good.text()); assert.equal(posts, 1);
});

test('catalog removal during a streamed confirmation body prevents TTS', async t => {
  const root = await mkdtemp(join(tmpdir(), 'sample-catalog-race-'));
  let listed = true; let posts = 0;
  const fake = createServer((req, res) => {
    if (req.url === '/v1/default-voices?page_size=30') { res.end(JSON.stringify({ voices: listed ? [{ voice_id: 'voice', name: 'Voice' }] : [], has_more: false })); return; }
    posts++; req.resume(); res.writeHead(500).end();
  });
  await new Promise<void>(resolve => fake.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(fake.address() as { port: number }).port}`;
  const server = await startCompanionServer({ workspaceRoot: root, vibiOptions: { apiKey: 'fake-key', voiceId: 'voice', baseUrl: base } });
  t.after(async () => { await server.close(); await new Promise<void>(resolve => fake.close(() => resolve())); await rm(root, { recursive: true, force: true }); });
  const headers = { authorization: `Bearer ${server.token}`, origin: server.origin, 'content-type': 'application/json' };
  await fetch(`${server.origin}/api/vibi/voices`, { headers });
  const url = `${server.origin}/api/vibi/voices/elevenlabs/voice/generated-sample`;
  let notify!: () => void; const begun = new Promise<void>(resolve => { notify = resolve; });
  server.server.prependOnceListener('request', notify);
  let finish!: (status: number | undefined) => void;
  const response = new Promise<number | undefined>(resolve => { finish = resolve; });
  const req = request(url, { method: 'POST', headers }, res => { res.resume(); finish(res.statusCode); });
  req.write('{"consent":'); await begun;
  listed = false; await fetch(`${server.origin}/api/vibi/voices`, { headers });
  req.end('true}');
  assert.ok([404, 409].includes((await response)!)); assert.equal(posts, 0);
  await assert.rejects(() => access(join(root, '.voice-samples')), { code: 'ENOENT' });
});

test('simultaneous first requests from distinct clients reserve only one paid task', async t => {
  const root = await mkdtemp(join(tmpdir(), 'sample-first-race-'));
  let languageRequests = 0; let posts = 0; let stt = 0;
  let bothReady!: () => void; let releaseLanguages!: () => void; let submitted!: () => void; let releaseTts!: () => void;
  const both = new Promise<void>(resolve => { bothReady = resolve; });
  const languageGate = new Promise<void>(resolve => { releaseLanguages = resolve; });
  const firstSubmitted = new Promise<void>(resolve => { submitted = resolve; });
  const ttsGate = new Promise<void>(resolve => { releaseTts = resolve; });
  const bytes = mp3Bytes(80);
  const fake = createServer(async (req, res) => {
    if (req.url?.startsWith('/v1/minimax/system-voices')) { res.end(JSON.stringify({ voice_list: [{ voice_id: 'voice', voice_name: 'Voice' }], has_more: false })); return; }
    if (req.url === '/v1/languages?provider=minimax') {
      languageRequests++; if (languageRequests === 2) bothReady();
      await languageGate; res.end(JSON.stringify([{ code: 'Spanish', name: 'Spanish' }])); return;
    }
    if (req.url === '/v1/text-to-speech/voice') { posts++; req.resume(); submitted(); await ttsGate; res.writeHead(202).end(JSON.stringify({ id: 'job' })); return; }
    if (req.url === '/v1/history/job') { res.end(JSON.stringify({ status: 'completed', result: { audio_url: `${base}/audio/job.mp3` } })); return; }
    if (req.url === '/audio/job.mp3') { res.end(bytes); return; }
    stt++; res.writeHead(500).end();
  });
  await new Promise<void>(resolve => fake.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(fake.address() as { port: number }).port}`;
  const server = await startCompanionServer({ workspaceRoot: root, vibiOptions: { apiKey: 'fake-key', provider: 'minimax', voiceId: 'voice', modelId: 'model', baseUrl: base, pollIntervalMs: 1 } });
  t.after(async () => { releaseLanguages(); releaseTts(); await server.close(); await new Promise<void>(resolve => fake.close(() => resolve())); await rm(root, { recursive: true, force: true }); });
  const headers = { authorization: `Bearer ${server.token}`, origin: server.origin, 'content-type': 'application/json' };
  await fetch(`${server.origin}/api/vibi/voices`, { headers });
  const url = `${server.origin}/api/vibi/voices/minimax/voice/generated-sample`;
  const post = () => fetch(url, { method: 'POST', headers: { ...headers, connection: 'close' }, body: '{"consent":true}' });
  const first = post(); const second = post();
  await both;
  await assert.rejects(() => access(join(root, '.voice-samples')), { code: 'ENOENT' });
  releaseLanguages(); await firstSubmitted;
  const blocked = await Promise.race([first, second]);
  assert.equal(blocked.status, 409); assert.equal((await blocked.json() as any).error.code, 'sample-unresolved');
  assert.equal(posts, 1); assert.equal(stt, 0);
  releaseTts();
  const results = await Promise.all([first, second]);
  const success = results.find(result => result.status === 200); assert.ok(success);
  assert.deepEqual(Buffer.from(await success.arrayBuffer()), Buffer.from(bytes));
  const cached = await fetch(url, { headers }); assert.equal(cached.status, 200);
  assert.deepEqual(Buffer.from(await cached.arrayBuffer()), Buffer.from(bytes));
  assert.equal(posts, 1); assert.equal(stt, 0);
});

test('sample cache rejects symlinked directory and invalid provider audio without a second attempt', async t => {
  const root = await mkdtemp(join(tmpdir(), 'voice-symlink-'));
  const outside = await mkdtemp(join(tmpdir(), 'voice-outside-'));
  t.after(async () => { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); });
  const key = sampleKey('elevenlabs', 'voice', 'model');
  await symlink(outside, join(root, '.voice-samples'));
  let calls = 0;
  await assert.rejects(() => new GeneratedVoiceSamples(root).generate(key, async () => { calls++; return mp3Bytes(80); }));
  assert.equal(calls, 0); assert.deepEqual(await readdir(outside), []);
  await rm(join(root, '.voice-samples'));
  const cache = new GeneratedVoiceSamples(root);
  await assert.rejects(() => cache.generate(key, async () => { calls++; return Buffer.from('invalid'); }));
  await assert.rejects(() => cache.generate(key, async () => { calls++; return mp3Bytes(80); }), /anterior/);
  assert.equal(calls, 1);
});

test('failed final catalog check removes only the pre-submit reservation and permits retry', async t => {
  const root = await mkdtemp(join(tmpdir(), 'sample-validation-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cache = new GeneratedVoiceSamples(root);
  const key = sampleKey('elevenlabs', 'voice', 'model');
  let checks = 0; let calls = 0;
  await assert.rejects(() => cache.generate(key, async () => { calls++; return mp3Bytes(80); }, () => {
    if (++checks === 2) throw new Error('catalog changed');
  }), /catalog changed/);
  assert.equal(calls, 0); assert.equal(await cache.get(key), null);
  const result = await cache.generate(key, async () => { calls++; return mp3Bytes(80); });
  assert.equal(result.length, mp3Bytes(80).length); assert.equal(calls, 1);
});

test('cancellation during reservation removes only its own marker before synthesis', async t => {
  const root = await mkdtemp(join(tmpdir(), 'sample-reservation-abort-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cache = new GeneratedVoiceSamples(root);
  const key = sampleKey('elevenlabs', 'voice', 'model');
  const other = sampleKey('elevenlabs', 'other', 'model');
  await assert.rejects(() => cache.generate(other, async () => { throw new Error('unknown outcome'); }));
  const controller = new AbortController(); let checks = 0; let submissions = 0;
  await assert.rejects(() => cache.generate(key, async () => {
    controller.signal.throwIfAborted(); submissions++; return mp3Bytes(80);
  }, () => { if (++checks === 1) queueMicrotask(() => controller.abort()); }, controller.signal));
  assert.equal(submissions, 0);
  assert.equal(await cache.get(key), null);
  await assert.rejects(() => cache.get(other), /anterior/);
  assert.equal(submissions, 0, 'cancellation never triggers a retry');
  const result = await cache.generate(key, async () => { submissions++; return mp3Bytes(80); });
  assert.equal(result.length, mp3Bytes(80).length); assert.equal(submissions, 1);
});

test('HTTP disconnect during reservation does not submit TTS and a later explicit request succeeds', async t => {
  const root = await mkdtemp(join(tmpdir(), 'sample-http-reservation-abort-'));
  let reserved!: () => void; let release!: () => void; let cleaned!: () => void; let disconnected!: () => void;
  const reservationReached = new Promise<void>(resolve => { reserved = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const cleanupFinished = new Promise<void>(resolve => { cleaned = resolve; });
  const responseClosed = new Promise<void>(resolve => { disconnected = resolve; });
  let pause = true; let posts = 0; let stt = 0;
  const bytes = mp3Bytes(80);
  const fake = createServer((req, res) => {
    if (req.url === '/v1/default-voices?page_size=30') { res.end(JSON.stringify({ voices: [{ voice_id: 'voice', name: 'Voice' }], has_more: false })); return; }
    if (req.url === '/v1/text-to-speech/voice') { posts++; req.resume(); res.writeHead(202).end(JSON.stringify({ id: 'job' })); return; }
    if (req.url === '/v1/history/job') { res.end(JSON.stringify({ status: 'completed', result: { audio_url: `${base}/audio/job.mp3` } })); return; }
    if (req.url === '/audio/job.mp3') { res.end(bytes); return; }
    stt++; res.writeHead(500).end();
  });
  await new Promise<void>(resolve => fake.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(fake.address() as { port: number }).port}`;
  const server = await startCompanionServer({ workspaceRoot: root, vibiOptions: { apiKey: 'fake-key', voiceId: 'voice', baseUrl: base, pollIntervalMs: 1 },
    sampleReservationTestHooks: { afterReservation: async () => { if (pause) { pause = false; reserved(); await gate; } }, afterCleanup: cleaned } });
  t.after(async () => { release(); await server.close(); await new Promise<void>(resolve => fake.close(() => resolve())); await rm(root, { recursive: true, force: true }); });
  const headers = { authorization: `Bearer ${server.token}`, origin: server.origin, 'content-type': 'application/json' };
  await fetch(`${server.origin}/api/vibi/voices`, { headers });
  const url = `${server.origin}/api/vibi/voices/elevenlabs/voice/generated-sample`;
  server.server.once('request', (_req, res) => res.once('close', disconnected));
  const controller = new AbortController();
  const cancelled = fetch(url, { method: 'POST', headers, body: '{"consent":true}', signal: controller.signal }).catch(() => null);
  await reservationReached;
  controller.abort(); await cancelled; await responseClosed;
  release(); await cleanupFinished;
  assert.equal(posts, 0); assert.equal(stt, 0);
  assert.equal((await fetch(url, { headers })).status, 404);
  assert.equal(posts, 0, 'there is no automatic retry');
  const retry = await fetch(url, { method: 'POST', headers, body: '{"consent":true}' });
  assert.equal(retry.status, 200, await retry.clone().text());
  assert.deepEqual(Buffer.from(await retry.arrayBuffer()), Buffer.from(bytes));
  assert.equal(posts, 1); assert.equal(stt, 0);
});

test('HTTP samples require catalog and consent, never invoke STT, and retain abort reservations after restart', async t => {
  const root = await mkdtemp(join(tmpdir(), 'voice-http-sample-'));
  let posts = 0; let stt = 0; let hold = false; let notify!: () => void;
  const submitted = new Promise<void>(resolve => { notify = resolve; });
  const bytes = mp3Bytes(80);
  const fake = createServer(async (req, res) => {
    if (req.url === '/v1/default-voices?page_size=30') { res.end(JSON.stringify({ voices: [{ voice_id: 'voice', name: 'Voice' }, { voice_id: 'other', name: 'Other' }], has_more: false })); return; }
    if (req.url?.startsWith('/v1/text-to-speech/')) {
      posts++; const chunks = []; for await (const chunk of req) chunks.push(chunk);
      assert.equal(JSON.parse(Buffer.concat(chunks).toString()).text, VOICE_SAMPLE_PHRASE);
      res.writeHead(202).end(JSON.stringify({ id: 'job' })); if (hold) notify(); return;
    }
    if (req.url === '/v1/history/job') { if (hold) return; res.end(JSON.stringify({ status: 'completed', result: { audio_url: `${base}/audio/job.mp3` } })); return; }
    if (req.url === '/audio/job.mp3') { res.end(bytes); return; }
    stt++; res.writeHead(500).end();
  });
  await new Promise<void>(resolve => fake.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(fake.address() as { port: number }).port}`;
  const options = { workspaceRoot: root, vibiOptions: { apiKey: 'fake-key', voiceId: 'default', baseUrl: base, pollIntervalMs: 1, timeoutMs: 1000 } };
  let server = await startCompanionServer(options);
  t.after(async () => { await server.close(); await new Promise<void>(resolve => fake.close(() => resolve())); await rm(root, { recursive: true, force: true }); });
  const headers = () => ({ authorization: `Bearer ${server.token}`, origin: server.origin, 'content-type': 'application/json' });
  const path = (voice = 'voice') => `${server.origin}/api/vibi/voices/elevenlabs/${voice}/generated-sample`;
  const post = (voice = 'voice', body: unknown = { consent: true }, signal?: AbortSignal) => fetch(path(voice), { method: 'POST', headers: headers(), body: JSON.stringify(body), signal });
  assert.equal((await post()).status, 400);
  await fetch(`${server.origin}/api/vibi/voices`, { headers: headers() });
  assert.equal((await fetch(path(), { headers: { ...headers(), authorization: '' } })).status, 401);
  const hostStatus = await new Promise<number | undefined>((resolve, reject) => {
    const req = request(path(), { headers: { ...headers(), host: 'evil.test' } }, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject); req.end();
  });
  assert.equal(hostStatus, 403);
  assert.equal((await fetch(path(), { method: 'POST', headers: { ...headers(), origin: 'https://evil.test' }, body: '{"consent":true}' })).status, 403);
  assert.equal((await post('voice', { consent: false })).status, 400);
  assert.equal((await post('voice', { consent: true, text: 'secret' })).status, 400);
  assert.equal((await post('unknown')).status, 400);
  assert.equal((await fetch(path(), { headers: headers() })).status, 404);
  await assert.rejects(() => access(join(root, '.voice-samples')), { code: 'ENOENT' });
  assert.equal(posts, 0);
  const generated = await post(); assert.equal(generated.status, 200, await generated.clone().text());
  assert.deepEqual(Buffer.from(await generated.arrayBuffer()), Buffer.from(bytes));
  assert.equal((await post()).status, 200);
  assert.equal((await fetch(path(), { headers: headers() })).status, 200);
  assert.equal(posts, 1); assert.equal(stt, 0);
  hold = true;
  const controller = new AbortController();
  const waiting = post('other', { consent: true }, controller.signal).catch(() => null);
  await submitted;
  assert.equal((await post('other')).status, 409);
  controller.abort(); await waiting;
  await server.close();
  server = await startCompanionServer(options);
  await fetch(`${server.origin}/api/vibi/voices`, { headers: headers() });
  assert.equal((await fetch(path(), { headers: headers() })).status, 200);
  const unresolved = await post('other'); assert.equal(unresolved.status, 409);
  assert.match(await unresolved.text(), /anterior/);
  assert.equal(posts, 2); assert.equal(stt, 0);
});

test('a submitted TTS timeout retains its reservation after restart', async t => {
  const root = await mkdtemp(join(tmpdir(), 'sample-timeout-'));
  let posts = 0; let stt = 0;
  const fake = createServer((req, res) => {
    if (req.url === '/v1/default-voices?page_size=30') { res.end(JSON.stringify({ voices: [{ voice_id: 'voice', name: 'Voice' }], has_more: false })); return; }
    if (req.url === '/v1/text-to-speech/voice') { posts++; req.resume(); res.writeHead(202).end(JSON.stringify({ id: 'job' })); return; }
    if (req.url === '/v1/history/job') return;
    stt++; res.writeHead(500).end();
  });
  await new Promise<void>(resolve => fake.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(fake.address() as { port: number }).port}`;
  const options = { workspaceRoot: root, vibiOptions: { apiKey: 'fake-key', voiceId: 'voice', baseUrl: base, pollIntervalMs: 1, timeoutMs: 500 } };
  let server = await startCompanionServer(options);
  t.after(async () => { await server.close(); await new Promise<void>(resolve => fake.close(() => resolve())); await rm(root, { recursive: true, force: true }); });
  const headers = () => ({ authorization: `Bearer ${server.token}`, origin: server.origin, 'content-type': 'application/json' });
  const url = () => `${server.origin}/api/vibi/voices/elevenlabs/voice/generated-sample`;
  const post = () => fetch(url(), { method: 'POST', headers: headers(), body: '{"consent":true}' });
  await fetch(`${server.origin}/api/vibi/voices`, { headers: headers() });
  const timedOut = await post(); assert.equal(timedOut.status, 409); assert.equal((await timedOut.json() as any).error.code, 'sample-unresolved');
  assert.equal(posts, 1);
  await server.close(); server = await startCompanionServer(options);
  await fetch(`${server.origin}/api/vibi/voices`, { headers: headers() });
  const blocked = await post(); assert.equal(blocked.status, 409); assert.equal((await blocked.json() as any).error.code, 'sample-unresolved');
  assert.equal(posts, 1); assert.equal(stt, 0);
});
