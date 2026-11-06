import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { vibiVoices } from '../../src/companion/providers/vibi.ts';

test('voice catalogs use documented provider paths, sanitize metadata and work without a default voice', async t => {
  const paths: string[] = [];
  let payload: unknown;
  const fake = createServer((req, res) => {
    assert.equal(req.headers['xi-api-key'], 'test-key');
    paths.push(req.url!); res.end(JSON.stringify(payload));
  });
  await new Promise<void>(resolve => fake.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => fake.close(() => resolve())));
  const base = { apiKey: 'test-key', voiceId: '', baseUrl: `http://127.0.0.1:${(fake.address() as { port: number }).port}` };
  for (const provider of ['elevenlabs', 'capcut', 'minimax']) {
    const row = { voice_id: 'known-id', name: 'Voz', voice_name: 'Voz', preview_url: 'https://private.test', api_key: 'PRIVATE' };
    payload = { [provider === 'elevenlabs' ? 'voices' : 'voice_list']: [row], has_more: true };
    assert.deepEqual(await vibiVoices({ ...base, provider, modelId: provider === 'minimax' ? 'operator-model' : undefined }),
      { provider, voices: [{ voiceId: 'known-id', name: 'Voz' }], hasMore: true });
  }
  assert.deepEqual(paths, ['/v1/default-voices?page_size=30', '/v1/capcut/system-voices?page=1&page_size=30&language=es',
    '/v1/minimax/system-voices?page=1&page_size=30&language=Spanish']);
  for (const voices of [[null], [{ voice_id: '../escape', name: 'Bad' }], [{ voice_id: 'id', name: 'Bad\nname' }],
    [{ voice_id: 'id', name: ' ' }], [{ voice_id: 'id', name: 'a' }, { voice_id: 'id', name: 'b' }], Array(31).fill({ voice_id: 'id', name: 'a' })]) {
    payload = { voices, has_more: false };
    await assert.rejects(vibiVoices({ ...base, provider: 'elevenlabs' }), { code: 'vibi-response' });
  }
  payload = { voices: [], has_more: false };
  assert.deepEqual(await vibiVoices({ ...base, provider: 'elevenlabs' }), { provider: 'elevenlabs', voices: [], hasMore: false });
  const calls = paths.length;
  await assert.rejects(vibiVoices({ ...base, apiKey: '', provider: 'elevenlabs' }), { code: 'vibi-unavailable' });
  await assert.rejects(vibiVoices({ ...base, provider: 'minimax', modelId: '' }), { code: 'vibi-config' });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(vibiVoices({ ...base, provider: 'elevenlabs' }, controller.signal), { code: 'vibi-cancelled' });
  assert.equal(paths.length, calls, 'invalid configuration and cancellation make no requests');
});
