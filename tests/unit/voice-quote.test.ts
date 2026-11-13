import test from 'node:test';
import assert from 'node:assert/strict';
import { voiceQuote, matchesVoiceQuote } from '../../src/companion/providers/voice-quote.ts';
import { speechPayload } from '../../src/companion/providers/speech-payload.ts';

test('quote binds model, voice, scene, text, character count and directive', () => {
  const input = { provider: 'elevenlabs', modelId: 'eleven_v4', voiceId: 'voice', text: 'Hola', scope: 'scene/a' };
  const quote = voiceQuote(input);
  assert.equal(quote.characters, 44);
  assert.equal(quote.directive, 'neutral-latin-american-spanish-v1');
  assert.ok(matchesVoiceQuote(quote.fingerprint, input));
  for (const change of [{ modelId: 'eleven_multilingual_v2' }, { voiceId: 'other' }, { scope: 'scene/b' }, { text: 'Hola!' }, { provider: 'capcut' }]) {
    assert.equal(matchesVoiceQuote(quote.fingerprint, { ...input, ...change }), false);
  }
  assert.equal(matchesVoiceQuote(undefined, input), false);
  assert.equal(matchesVoiceQuote('0'.repeat(64), input), false);
});

test('quote fingerprint binds the exact submitted voice settings', () => {
  const input = { provider: 'elevenlabs', modelId: 'eleven_v4', voiceId: 'voice', text: 'Hola', scope: 'scene/a' };
  const payload = speechPayload(input);
  const quote = voiceQuote(input, payload);
  assert.equal(matchesVoiceQuote(quote.fingerprint, input, { ...payload, voice_settings: { ...payload.voice_settings, speed: 1.1 } }), false);
});
