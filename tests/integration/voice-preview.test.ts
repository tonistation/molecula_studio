import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { vibiVoicePreview } from '../../src/companion/providers/vibi.ts';
import { startCompanionServer } from '../../src/companion/server/http.ts';
import { mp3Bytes } from '../helpers/media.ts';

test('public CDN sample requests never receive Vibi credentials and fail closed on headers, signatures, size and redirects', async t => {
  const original = globalThis.fetch;
  const bytes = mp3Bytes(5);
  const options = { apiKey: 'test-private-only' };
  let response = () => new Response(new Uint8Array(bytes), { headers: { 'content-type': 'audio/mpeg' } });
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    calls++; assert.equal(init.redirect, 'error'); assert.equal(init.credentials, 'omit');
    assert.equal(new Headers(init.headers).get('xi-api-key'), null);
    assert.equal(new Headers(init.headers).get('authorization'), null);
    assert.equal(url, 'https://storage.googleapis.com/eleven-public-prod/audio/aria.mp3');
    return response();
  });
  t.after(() => { globalThis.fetch = original; });
  const sample = () => vibiVoicePreview('elevenlabs', 'aria', 'https://storage.googleapis.com/eleven-public-prod/audio/aria.mp3', options);
  assert.deepEqual(Buffer.from((await sample()).bytes), Buffer.from(bytes));
  for (const make of [() => new Response(new Uint8Array(bytes), { status: 302, headers: { location: 'https://evil.test', 'content-type': 'audio/mpeg' } }),
    () => new Response('PRIVATE html', { headers: { 'content-type': 'text/html' } }),
    () => new Response('not mp3', { headers: { 'content-type': 'audio/mpeg' } }),
    () => new Response(new Uint8Array(5 * 1024 * 1024 + 1), { headers: { 'content-type': 'audio/mpeg' } })]) {
    response = make; await assert.rejects(sample(), error => { assert.doesNotMatch(String(error), /test-private-only|PRIVATE html|evil\.test/); return true; });
  }
  const before = calls;
  await assert.rejects(vibiVoicePreview('elevenlabs', 'aria', 'https://evil.test/voice.mp3', options));
  assert.equal(calls, before);
});

test('sample proxy uses authenticated catalog IDs, preserves Host/Origin/token, cancels and bounds local downloads with zero paid tasks', async t => {
  const root = await mkdtemp(join(tmpdir(), 'voice-sample-'));
  const bytes = mp3Bytes(5);
  let samples = 0; let posts = 0; let mode = 'valid'; let catalogMode = 'valid';
  const fake = createServer((req, res) => {
    assert.equal(req.headers['xi-api-key'], 'fake-sample-key');
    if (req.method === 'POST') { posts++; res.writeHead(500).end(); return; }
    if (req.url?.startsWith('/v1/capcut/system-voices')) {
      res.end(JSON.stringify({ voice_list: [{ voice_id: '123', name: 'Muestra', language: 'es', gender: 'Female',
        preview_url: catalogMode === 'valid' ? `${base}/v1/capcut/voices/123/preview` : 'http://127.0.0.1:1/secrets' }], has_more: false })); return;
    }
    assert.equal(req.url, '/v1/capcut/voices/123/preview'); samples++;
    if (mode === 'timeout') return;
    if (mode === 'stalled-body') { res.writeHead(200, { 'content-type': 'audio/mpeg' }); res.write(bytes.subarray(0, 4)); return; }
    if (mode === 'redirect') { res.writeHead(302, { location: `${base}/v1/auth/me` }).end(); return; }
    if (mode === 'http') { res.writeHead(404).end('PRIVATE provider body'); return; }
    if (mode === 'mime' || mode === 'unknown-mime') { res.writeHead(200, { 'content-type': mode === 'mime' ? 'Text/HTML; charset=utf-8' : 'private/secret-value' }).end('PRIVATE provider body'); return; }
    if (mode === 'signature') { res.writeHead(200, { 'content-type': 'audio/mpeg' }).end('PRIVATE invalid bytes'); return; }
    if (mode === 'size') { res.writeHead(200, { 'content-type': 'audio/mpeg' }).end(Buffer.alloc(5 * 1024 * 1024 + 1)); return; }
    if (mode === 'network') { res.destroy(new Error('PRIVATE upstream URL')); return; }
    res.writeHead(200, { 'content-type': 'audio/mpeg' }); res.end(bytes);
  });
  await new Promise<void>(resolve => fake.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(fake.address() as { port: number }).port}`;
  const companion = await startCompanionServer({ workspaceRoot: root, vibiOptions: { apiKey: 'fake-sample-key', provider: 'capcut', baseUrl: base, timeoutMs: 200 } });
  t.after(async () => { await companion.close(); fake.closeAllConnections(); await new Promise<void>(resolve => fake.close(() => resolve())); await rm(root, { recursive: true, force: true }); });
  const url = `${companion.origin}/api/vibi/voices/capcut/123/preview`;
  const headers = { authorization: `Bearer ${companion.token}`, origin: companion.origin };
  assert.equal((await fetch(url)).status, 401);
  assert.equal((await fetch(url, { headers: { ...headers, origin: 'https://evil.test' } })).status, 403);
  assert.equal(await new Promise<number>(resolve => {
    const req = request(url, { headers: { ...headers, host: 'evil.test' } }, res => { res.resume(); resolve(res.statusCode!); }); req.end();
  }), 403);
  assert.equal((await fetch(url, { headers })).status, 404);
  const load = () => fetch(`${companion.origin}/api/vibi/voices`, { headers });
  assert.deepEqual(await (await load()).json(), { provider: 'capcut', voices: [{ voiceId: '123', name: 'Muestra', language: 'Español', gender: 'Femenina', previewAvailable: true }], hasMore: false });
  assert.equal((await fetch(url.replace('/123/', '/unknown/'), { headers })).status, 404);
  assert.equal((await fetch(url.replace('/capcut/', '/elevenlabs/'), { headers })).status, 404);
  const result = await fetch(url + '?url=http://127.0.0.1:1/secret', { headers });
  assert.equal(result.status, 200); assert.equal(result.headers.get('content-type'), 'audio/mpeg');
  assert.equal(result.headers.get('cache-control'), 'no-store'); assert.equal(result.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(Buffer.from(await result.arrayBuffer()), Buffer.from(bytes));
  for (const [failure, diagnostic] of [
    ['http', { reason: 'http-rejection', status: 404 }],
    ['mime', { reason: 'mime-rejection', mimeType: 'text/html' }],
    ['unknown-mime', { reason: 'mime-rejection', mimeType: 'unknown' }],
    ['signature', { reason: 'signature-rejection' }], ['size', { reason: 'size-limit' }],
    ['network', { reason: 'network' }], ['timeout', { reason: 'timeout' }],
  ] as const) {
    mode = failure;
    const response = await fetch(url, { headers });
    assert.equal(response.status, failure === 'timeout' ? 504 : 502);
    const body = await response.json() as { error: { previewDiagnostic?: unknown } };
    assert.deepEqual(body.error.previewDiagnostic, diagnostic);
    assert.doesNotMatch(JSON.stringify(body), /PRIVATE|secret-value|fake-sample-key|https?:|consumiendo/);
  }
  mode = 'redirect'; assert.equal((await fetch(url, { headers })).status, 502);
  mode = 'timeout'; const timeout = await fetch(url, { headers }); assert.equal(timeout.status, 504);
  assert.doesNotMatch(await timeout.text(), /fake-sample-key|consumiendo/);
  mode = 'stalled-body'; assert.equal((await fetch(url, { headers })).status, 504, 'deadline includes the response body');
  const controller = new AbortController();
  const pending = fetch(url, { headers, signal: controller.signal });
  await new Promise(resolve => setTimeout(resolve, 20)); controller.abort(); await assert.rejects(pending);
  catalogMode = 'malicious'; assert.equal((await load()).status, 200);
  const before = samples; assert.equal((await fetch(url, { headers })).status, 404); assert.equal(samples, before);
  assert.equal(posts, 0);
});
