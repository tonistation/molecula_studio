import type { Output } from '../schema/types.ts';

/** The enclosing scene Sequence owns the timeline boundary; offset trims the source. */
export function sceneAudioPlayback(scene: { audioUrl: string | null; gainDb: number; audioOffsetMs: number }, voiceMode: Output['voiceMode'], fps: number) {
  if (voiceMode === 'silent' || scene.audioUrl === null) return null;
  return { src: scene.audioUrl, volume: 10 ** (scene.gainDb / 20), trimBefore: Math.round(scene.audioOffsetMs * fps / 1000) };
}
