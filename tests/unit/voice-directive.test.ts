import test from 'node:test';
import assert from 'node:assert/strict';
import { speechInput, SPANISH_ACCENT_PREFIX } from '../../src/shared/voice/speech-input.ts';
import { sttWordsToWords } from '../../src/shared/voice/alignment.ts';

test('accent directive is limited to Spanish ElevenLabs v4 and counts every sent character', () => {
  assert.equal(speechInput('Hola', 'elevenlabs', 'eleven_v4', 'es'), `${SPANISH_ACCENT_PREFIX}Hola`);
  for (const [provider, model, locale] of [['elevenlabs', 'eleven_v4', 'en'], ['elevenlabs', 'eleven_multilingual_v2', 'es'], ['capcut', 'eleven_v4', 'es']]) {
    assert.equal(speechInput('Hola', provider!, model!, locale!), 'Hola');
  }
});

test('extra spoken directive words produce an honest alignment warning', () => {
  const warnings: string[] = [];
  const words = sttWordsToWords([{ type: 'word', text: 'neutral', start: 0, end: 0.2 }, { type: 'word', text: 'Hola', start: 0.3, end: 0.7 }], 'Hola', 1000, warning => warnings.push(warning));
  assert.equal(words[0]?.text, 'Hola');
  assert.match(warnings[0]!, /subtítulos estimados/);
});
