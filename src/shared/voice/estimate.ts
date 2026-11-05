import { LIMITS } from '../schema/limits.ts';
import type { Word } from '../schema/types.ts';

/** Estimates scene-local milliseconds; rejects overflow rather than dropping narration. */
export function estimateWords(text: string, durationMs: number): Word[] {
  if (!Number.isInteger(durationMs) || durationMs < LIMITS.minSceneMs || durationMs > LIMITS.maxSceneMs) {
    throw new RangeError('La duración debe estar entre 1000 y 15000 ms enteros.');
  }
  if (Array.from(text).length > LIMITS.maxSceneText) throw new RangeError('El texto supera el límite de la escena.');
  const tokens = text.match(/\S+/gu) ?? [];
  if (tokens.length > LIMITS.maxWordsPerScene) throw new RangeError('Hay demasiadas palabras en la escena.');
  if (tokens.some(token => Array.from(token).length > 80)) throw new RangeError('Cada palabra admite hasta 80 caracteres.');
  if (!tokens.length) return [];

  const segments = tokens.map(token => ({
    speech: Math.max(1, Array.from(token.replace(/\p{P}/gu, '')).length),
    pause: /[.!?…][\p{Pe}\p{Pf}"']*$/u.test(token) ? 4 : /[,;:][\p{Pe}\p{Pf}"']*$/u.test(token) ? 2 : 0,
  }));
  const totalWeight = segments.reduce((sum, segment) => sum + segment.speech + segment.pause, 0);
  // Reserve one millisecond per word before proportional rounding, even at the 300-word limit.
  const available = durationMs - tokens.length;
  let consumedWeight = 0;
  return tokens.map((token, index) => {
    const segment = segments[index]!;
    const startMs = index + Math.round(available * consumedWeight / totalWeight);
    consumedWeight += segment.speech;
    const endMs = index + 1 + Math.round(available * consumedWeight / totalWeight);
    consumedWeight += segment.pause;
    return { text: token, startMs, endMs, emphasis: false };
  });
}
