/// <reference lib="dom" />
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, fetchAssetBlobUrl, fetchVoiceSample } from '../../studio/src/api.ts';

function mockDocument(t: TestContext): void {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    querySelector: () => ({ content: 'local-token' }),
  } });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'document', previous);
    else Reflect.deleteProperty(globalThis, 'document');
  });
}

test('asset client fetches with bearer auth and owns an explicitly revocable blob URL', async (t) => {
  t.mock.method(globalThis, 'fetch', async (path: string, init: RequestInit) => {
    assert.equal(path, '/api/projects/p-preview/assets/voz');
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer local-token');
    return new Response(new Uint8Array([1, 2, 255]), { headers: { 'content-type': 'audio/wav' } });
  });
  t.mock.method(URL, 'createObjectURL', (blob: Blob) => {
    assert.equal(blob.type, 'audio/wav');
    assert.equal(blob.size, 3);
    return 'blob:preview';
  });
  const revoke = t.mock.method(URL, 'revokeObjectURL', () => {});
  mockDocument(t);
  const asset = await fetchAssetBlobUrl('p-preview', 'voz');
  assert.equal(asset.url, 'blob:preview');
  assert.equal(revoke.mock.callCount(), 0);
  asset.revoke(); // The caller invokes this from unmount/project-change cleanup.
  asset.revoke();
  assert.equal(revoke.mock.callCount(), 1);
  assert.equal(revoke.mock.calls[0]?.arguments[0], 'blob:preview');
});

test('asset client parses API errors without allocating a blob URL', async (t) => {
  mockDocument(t);
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({
    error: { code: 'asset-not-found', message: 'Missing asset' },
  }), { status: 404 }));
  const create = t.mock.method(URL, 'createObjectURL', () => 'unused');
  await assert.rejects(fetchAssetBlobUrl('p-preview', 'voz'), (error: unknown) =>
    error instanceof ApiError && error.status === 404 && error.code === 'asset-not-found');
  assert.equal(create.mock.callCount(), 0);
});

test('asset client cannot allocate a late URL after caller cleanup aborts a pending blob', async (t) => {
  const controller = new AbortController();
  mockDocument(t);
  t.mock.method(globalThis, 'fetch', async (_path: string, init: RequestInit) => {
    assert.equal(init.signal, controller.signal);
    const response = new Response('audio');
    t.mock.method(response, 'blob', async () => {
      controller.abort();
      return new Blob(['audio']);
    });
    return response;
  });
  const create = t.mock.method(URL, 'createObjectURL', () => 'unused');
  await assert.rejects(fetchAssetBlobUrl('p-preview', 'voz', controller.signal), { name: 'AbortError' });
  assert.equal(create.mock.callCount(), 0);
});

test('sample client authenticates only the same-origin ID route and releases its blob once', async t => {
  mockDocument(t);
  const controller = new AbortController();
  t.mock.method(globalThis, 'fetch', async (path: string, init: RequestInit) => {
    assert.equal(path, '/api/vibi/voices/capcut/123/preview');
    assert.equal(init.signal, controller.signal);
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer local-token');
    return new Response('fixture', { headers: { 'content-type': 'audio/wav' } });
  });
  t.mock.method(URL, 'createObjectURL', () => 'blob:sample');
  const revoke = t.mock.method(URL, 'revokeObjectURL', () => {});
  const sample = await fetchVoiceSample('capcut', '123', controller.signal);
  assert.equal(sample.url, 'blob:sample'); sample.revoke(); sample.revoke();
  assert.equal(revoke.mock.callCount(), 1);
});

test('sample cancellation cannot allocate a late blob, including an already aborted click', async t => {
  mockDocument(t);
  const controller = new AbortController();
  const request = t.mock.method(globalThis, 'fetch', async () => {
    const response = new Response('fixture');
    t.mock.method(response, 'blob', async () => { controller.abort(); return new Blob(['late']); });
    return response;
  });
  const create = t.mock.method(URL, 'createObjectURL', () => 'unused');
  await assert.rejects(fetchVoiceSample('capcut', '123', controller.signal), { name: 'AbortError' });
  await assert.rejects(fetchVoiceSample('capcut', '123', controller.signal), { name: 'AbortError' });
  assert.equal(create.mock.callCount(), 0); assert.equal(request.mock.callCount(), 1);
});

test('unavailable sample preserves the safe HTTP feedback and allocates no URL', async t => {
  mockDocument(t);
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ error: { code: 'voice-preview-unavailable', message: 'Muestra no disponible.' } }), { status: 404 }));
  const create = t.mock.method(URL, 'createObjectURL', () => 'unused');
  await assert.rejects(fetchVoiceSample('capcut', '123', new AbortController().signal), { code: 'voice-preview-unavailable', status: 404 });
  assert.equal(create.mock.callCount(), 0);
});
