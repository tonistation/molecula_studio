import test from 'node:test';
import assert from 'node:assert/strict';
import { voiceDetails, publicPreviewUrl } from '../../src/companion/providers/voice-catalog.ts';

test('documented provider metadata is optional, bounded plain text; names never imply accents', () => {
  assert.deepEqual(voiceDetails('elevenlabs', { name: 'Mexican narrator' }), {});
  assert.deepEqual(voiceDetails('elevenlabs', { language: 'es', accent: 'mexican', gender: 'female', descriptive: 'warm', description: 'Una voz clara.', country: 'Mexico' }),
    { language: 'Español', accent: 'Mexicano', gender: 'Femenina', style: 'Cálida', description: 'Una voz clara.' });
  assert.deepEqual(voiceDetails('minimax', { tag_list: ['Spanish', 'Female', 'Young', 'ES-Mexican'], description: 'Clara' }),
    { language: 'Español', gender: 'Femenina', accent: 'ES-Mexican', description: 'Clara' });
  assert.deepEqual(voiceDetails('capcut', { language: 'es', gender: 'Male', tags: ['male', 'steady', 'narration'] }),
    { language: 'Español', gender: 'Masculina', style: 'Estable' });
  assert.deepEqual(voiceDetails('elevenlabs', { language: 'en', accent: 'american', verified_languages: [{ language_id: 'es', accent: 'Mexican', locale: 'es-MX' }] }),
    { language: 'Español', accent: 'Mexicano' });
  assert.deepEqual(voiceDetails('elevenlabs', { language: 'en', accent: 'american', verified_languages: [{ language_id: 'es', locale: 'es-MX' }] }),
    { language: 'Español' });
  for (const provider of ['elevenlabs', 'minimax', 'capcut']) assert.deepEqual(voiceDetails(provider, {}), {});
  assert.deepEqual(voiceDetails('elevenlabs', { language: '<script>', accent: 'a\nb', gender: {}, descriptive: 'x'.repeat(121), description: 'https://private.test' }), {});
  assert.deepEqual(voiceDetails('elevenlabs', { language: '__proto__', accent: 'constructor' }), { language: '__proto__', accent: 'constructor' });
});

test('sample URLs accept only documented exact CDN buckets/paths or the selected CapCut voice', () => {
  const google = 'https://storage.googleapis.com/eleven-public-prod/audio/aria.mp3';
  assert.equal(publicPreviewUrl('elevenlabs', 'aria', google), google);
  const premade = 'https://storage.googleapis.com/eleven-public-prod/premade/voices/aria/d6905d7a-dd26-4187-bfff-1bd3a5ea7cac.mp3';
  assert.equal(publicPreviewUrl('elevenlabs', 'aria', premade), premade);
  const mini = 'https://cdn.hailuoai.video/moss/voice_sample/xxx.mp3';
  assert.equal(publicPreviewUrl('minimax', 'id', mini), mini);
  const cap = 'https://api.vibi.pro/v1/capcut/voices/123/preview';
  assert.equal(publicPreviewUrl('capcut', '123', cap), cap);
  for (const url of ['http://127.0.0.1/a.mp3', 'https://storage.googleapis.com/other/audio/a.mp3', google + '?key=secret', google + '#hash',
    google.replace('storage.googleapis.com', 'storage.googleapis.com.evil.test'), google.replace('https://', 'https://user@'),
    'https://storage.googleapis.com/eleven-public-prod/audio/%2e%2e/x.mp3', cap.replace('/123/', '/456/'), 'https://api.vibi.pro/v1/auth/me']) {
    for (const provider of ['elevenlabs', 'minimax', 'capcut']) assert.equal(publicPreviewUrl(provider, '123', url), undefined);
  }
});
