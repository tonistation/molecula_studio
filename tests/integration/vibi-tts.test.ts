import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { synthesizeSpeech, vibiCredits, voiceConfiguration, VibiError } from '../../src/companion/providers/vibi.ts';
import { SPANISH_ACCENT_PREFIX } from '../../src/shared/voice/speech-input.ts';

test('v4 sends the Spanish accent directive without changing the source narration', async t => {
  let submitted: Record<string, unknown> | undefined;
  const server = createServer(async (req, res) => {
    if (req.method === 'POST') {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      submitted = JSON.parse(Buffer.concat(chunks).toString());
      res.writeHead(202).end(JSON.stringify({ id: 'job' }));
    } else if (req.url === '/audio/job.mp3') res.end('audio');
    else res.end(JSON.stringify({ status: 'completed', result: { audio_url: `${base}/audio/job.mp3` } }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const text = 'Hola mundo';
  await synthesizeSpeech(text, { apiKey: 'fake', voiceId: 'voice', provider: 'elevenlabs', modelId: 'eleven_v4', baseUrl: base, pollIntervalMs: 1 });
  assert.equal(submitted?.text, `${SPANISH_ACCENT_PREFIX}${text}`);
  assert.equal(submitted?.language_code, 'es');
  assert.equal(text, 'Hola mundo');
});

test('Vibi TTS submits once with safe defaults, sequential polls and same-key same-origin download; credits sanitize profile', async t => {
  let polls = 0; let posts = 0;
  const paths: string[] = [];
  const server = createServer(async (req, res) => {
    assert.equal(req.headers['xi-api-key'], 'fake-key'); paths.push(req.url!);
    if (req.method === 'POST') {
      posts++;
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      assert.equal(req.url, '/v1/text-to-speech/voice-1');
      assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString()), { text: 'Hola mundo', language_code: 'es', provider: 'elevenlabs',
        model_id: 'eleven_multilingual_v2', voice_settings: { stability: 0.5, similarity_boost: 0.75, speed: 1 } });
      res.writeHead(202).end(JSON.stringify({ id: 'job-1' }));
    } else if (req.url?.startsWith('/v1/history/')) {
      polls++; res.end(JSON.stringify(polls < 3 ? { status: polls === 1 ? 'pending' : 'processing' } : { status: 'completed', result: { audio_url: `${base}/audio/job-1.mp3` } }));
    } else if (req.url === '/v1/auth/me') res.end(JSON.stringify({ credit_balance: 1234, email: 'PRIVATE', api_key: 'fake-key' }));
    else res.end(Buffer.from([1, 2, 3]));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const options = { apiKey: 'fake-key', voiceId: 'voice-1', provider: 'elevenlabs', modelId: 'eleven_multilingual_v2', baseUrl: base, pollIntervalMs: 1 };
  const result = await synthesizeSpeech('Hola mundo', options);
  assert.deepEqual([...result.bytes], [1, 2, 3]); assert.equal(result.attribution, 'elevenlabs/voice-1');
  assert.equal(posts, 1); assert.equal(polls, 3); assert.equal(paths.includes('/v1/auth/me'), false);
  assert.deepEqual(await vibiCredits(options), { credits: 1234 });
});

test('MiniMax verifies Spanish against languages before spending; missing model/provider/voice rejected without requests', async t => {
  let confirmed = true; let posts = 0; let provider = 'minimax';
  const server = createServer(async (req, res) => {
    if (req.url?.startsWith('/v1/languages')) { res.end(JSON.stringify(confirmed ? [{ code: 'Spanish', name: 'Spanish' }] : [{ code: 'English', name: 'English' }])); return; }
    if (req.method === 'POST') {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString()); posts++;
      assert.equal(body.language_code, provider === 'minimax' ? 'Spanish' : 'es');
      assert.equal(body.text, 'Hola');
      assert.deepEqual(body.voice_settings, { speed: 1, pitch: 0 });
      res.writeHead(202).end(JSON.stringify({ id: 'job' }));
    } else if (req.url === '/audio/job.mp3') res.end('audio');
    else res.end(JSON.stringify({ status: 'completed', result: { audio_url: `${base}/audio/job.mp3` } }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const options = { apiKey: 'fake', voiceId: 'voice', provider, modelId: 'speech-2.8-turbo', baseUrl: base, pollIntervalMs: 1 };
  await synthesizeSpeech('Hola', options); assert.equal(posts, 1);
  confirmed = false; await assert.rejects(synthesizeSpeech('Hola', options), /no confirmó Spanish/); assert.equal(posts, 1);
  provider = 'capcut'; await synthesizeSpeech('Hola', { ...options, provider, modelId: 'capcut' }); assert.equal(posts, 2);
  for (const patch of [{ voiceId: '' }, { voiceId: '../bad' }, { provider: 'unknown' }, { modelId: '' }]) {
    assert.throws(() => voiceConfiguration({ ...options, ...patch }), VibiError);
  }
});

test('TTS never downloads untrusted URLs or follows redirects; bounded failures/cancellation have no diagnostics or retries', async t => {
  let mode = ''; let posts = 0; let downloads = 0; let leaked = 0;
  const logs: unknown[] = [];
  for (const method of ['log', 'warn', 'error'] as const) t.mock.method(console, method, (...args: unknown[]) => logs.push(args));
  const sink = createServer((req, res) => { leaked++; req.resume(); res.end('leak'); });
  await new Promise<void>(resolve => sink.listen(0, '127.0.0.1', resolve));
  const sinkUrl = `http://127.0.0.1:${(sink.address() as { port: number }).port}`;
  const server = createServer((req, res) => {
    req.resume();
    if (req.method === 'POST') {
      posts++;
      if (mode === 'submit-redirect') { res.writeHead(307, { location: sinkUrl }).end(); return; }
      if (mode === 'http') { res.writeHead(401).end('fake-key PRIVATE'); return; }
      res.writeHead(202).end(JSON.stringify({ id: mode === 'bad-id' ? '../bad' : 'job' })); return;
    }
    if (req.url === '/audio/job.mp3') {
      downloads++;
      if (mode === 'download-redirect') { res.writeHead(302, { location: sinkUrl }).end(); return; }
      if (mode === 'large-audio') { res.end(Buffer.alloc(50 * 1024 * 1024 + 1)); return; }
      if (mode === 'stalled-audio') { res.write('a'); return; }
      res.end(); return;
    }
    if (mode === 'stalled-json') { res.write('{'); return; }
    if (mode === 'large-json') { res.end('x'.repeat(2 * 1024 * 1024 + 1)); return; }
    const audioUrl = mode.startsWith('url:') ? mode.slice(4) : `${base}/audio/job.mp3`;
    res.end(JSON.stringify(mode === 'failed' ? { status: 'failed', error: 'fake-key PRIVATE' } : mode === 'pending' ? { status: 'pending' }
      : mode === 'bad-status' ? { status: 'unexpected' } : { status: 'completed', result: { audio_url: audioUrl } }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await Promise.all([new Promise<void>(r => server.close(() => r())), new Promise<void>(r => sink.close(() => r()))]); });
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const options = { apiKey: 'fake-key', voiceId: 'voice', provider: 'elevenlabs', modelId: 'model', baseUrl: base, pollIntervalMs: 1, timeoutMs: 250 };
  for (mode of [`url:${sinkUrl}/audio/job.mp3`, `url:https://evil.test/audio/job.mp3`, `url:${base}/v1/auth/me`,
    `url:${base}/audio/job.mp3?secret=1`, `url:${base}/audio/job.mp3#x`, `url:${base.replace('http://', 'http://u:p@')}/audio/job.mp3`,
    'failed', 'bad-id', 'bad-status', 'http', 'submit-redirect', 'download-redirect', 'large-json', 'large-audio', 'stalled-json', 'stalled-audio', 'pending', 'empty-audio']) {
    const before = posts;
    await assert.rejects(synthesizeSpeech('Hola', options), (error: unknown) => {
      assert.ok(error instanceof VibiError); assert.doesNotMatch(String(error), /fake-key|PRIVATE|evil.test/); return true;
    });
    assert.equal(posts, before + 1);
  }
  const before = posts;
  await assert.rejects(synthesizeSpeech('Hola', options, AbortSignal.abort())); assert.equal(posts, before);
  assert.equal(leaked, 0); assert.ok(downloads > 0); assert.deepEqual(logs, []);
});
