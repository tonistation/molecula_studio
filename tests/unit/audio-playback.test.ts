import test from 'node:test';
import assert from 'node:assert/strict';
import { sceneAudioPlayback } from '../../src/shared/voice/playback.ts';

test('audio policy excludes silent and missing media, converts dB without clamping, and trims source offset in frames', () => {
  const scene = { audioUrl: 'blob:voice', gainDb: -6, audioOffsetMs: 500 };
  assert.equal(sceneAudioPlayback(scene, 'silent', 30), null);
  assert.equal(sceneAudioPlayback({ ...scene, audioUrl: null }, 'withVoice', 30), null);
  assert.deepEqual(sceneAudioPlayback(scene, 'withVoice', 30), {
    src: 'blob:voice', volume: 10 ** (-6 / 20), trimBefore: 15,
  });
  assert.equal(sceneAudioPlayback({ ...scene, gainDb: 6 }, 'withVoice', 30)!.volume, 10 ** (6 / 20));
});
