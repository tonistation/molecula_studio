import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { transcribeAudio, VibiError } from '../../src/companion/providers/vibi.ts';

test('Vibi multipart 202 → pending → processing → completed uses auth on every request and polls without retries', async t => {
  let polls = 0;
  const seen: string[] = [];
  const server = createServer(async (req, res) => {
    assert.equal(req.headers['xi-api-key'], 'test-only-key');
    seen.push(req.method!);
    res.setHeader('content-type', 'application/json');
    if (req.method === 'POST') {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const form = await new Response(Buffer.concat(chunks), { headers: { 'content-type': req.headers['content-type']! } }).formData();
      assert.equal(form.get('language_code'), 'es'); assert.equal(form.get('timestamps_granularity'), 'word');
      assert.equal(form.get('tag_audio_events'), 'false');
      assert.deepEqual([...new Uint8Array(await (form.get('file') as File).arrayBuffer())], [1, 2, 3]);
      res.writeHead(202).end(JSON.stringify({ task_id: 'task-1', status: 'pending' }));
    } else {
      assert.equal(req.url, '/v1/speech-to-text/task-1');
      polls++;
      res.end(JSON.stringify(polls < 3 ? { status: polls === 1 ? 'pending' : 'processing' } : {
        status: 'completed', result: { words: [{ text: 'Hola', type: 'word', start: 0.119, end: 0.319 }] },
      }));
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const words = await transcribeAudio(new Uint8Array([1, 2, 3]), 'audio/wav', { apiKey: 'test-only-key', baseUrl, pollIntervalMs: 2 });
  assert.deepEqual(words, [{ text: 'Hola', type: 'word', start: 0.119, end: 0.319 }]);
  assert.deepEqual(seen, ['POST', 'GET', 'GET', 'GET']);
});

test('Vibi bounds time/body, rejects malformed statuses, redirects and errors; never exposes raw detail_error/key/transcript', async t => {
  let mode = 'failed'; let posts = 0;
  let onPoll: (() => void) | undefined;
  const logs: unknown[][] = [];
  for (const method of ['log', 'warn', 'error'] as const) t.mock.method(console, method, (...args: unknown[]) => logs.push(args));
  const server = createServer((req, res) => {
    req.resume();
    if (req.method === 'POST') {
      posts++;
      if (mode === 'http') { res.writeHead(401).end('test-key private transcript'); return; }
      if (mode === 'redirect') { res.writeHead(307, { location: 'http://127.0.0.1:1/leak' }).end(); return; }
      res.writeHead(202).end(JSON.stringify({ task_id: mode === 'id' ? '../bad' : 'task-2' })); return;
    }
    onPoll?.();
    if (mode === 'get-http') { res.writeHead(429).end('test-key private transcript'); return; }
    if (mode === 'stalled-body') { res.write('{'); return; }
    res.end(mode === 'oversize' ? 'x'.repeat(2 * 1024 * 1024 + 1) : mode === 'malformed' ? '{' : JSON.stringify(
      mode === 'failed' ? { status: 'failed', detail_error: 'test-key private transcript' } :
        mode === 'complete' ? { status: 'completed', result: {} } :
          { status: mode === 'unknown' ? 'surprise' : 'pending' }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const options = { apiKey: 'test-key', baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}`, pollIntervalMs: 2, timeoutMs: 80 };
  for (mode of ['failed', 'http', 'get-http', 'redirect', 'id', 'unknown', 'malformed', 'complete', 'oversize', 'timeout', 'stalled-body']) {
    const before = posts;
    await assert.rejects(transcribeAudio(new Uint8Array([1]), 'audio/mpeg', options), (error: unknown) => {
      assert.ok(error instanceof VibiError); assert.doesNotMatch(String(error), /test-key|private transcript/); return true;
    });
    assert.equal(posts, before + 1);
  }
  const controller = new AbortController();
  const pending = transcribeAudio(new Uint8Array([1]), 'audio/wav', { ...options, pollIntervalMs: 2000 }, controller.signal);
  controller.abort();
  await assert.rejects(pending, (error: unknown) => error instanceof VibiError && error.code === 'vibi-cancelled');
  const inFlight = new AbortController();
  mode = 'timeout'; onPoll = () => inFlight.abort();
  await assert.rejects(transcribeAudio(new Uint8Array([1]), 'audio/wav', options, inFlight.signal),
    (error: unknown) => error instanceof VibiError && error.code === 'vibi-cancelled');
  onPoll = undefined;
  const before = posts;
  await assert.rejects(transcribeAudio(new Uint8Array([1]), 'audio/wav', options, AbortSignal.abort()));
  assert.equal(posts, before, 'pre-cancelled operations never submit');
  await assert.rejects(transcribeAudio(new Uint8Array([1]), 'audio/wav', { apiKey: '' }), /clave/i);
  await assert.rejects(transcribeAudio(new Uint8Array([1]), 'audio/wav', { ...options, baseUrl: 'https://evil.test' }), /local/i);
  assert.deepEqual(logs, []);
});
