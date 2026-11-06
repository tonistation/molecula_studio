import type { Word } from '../schema/types.ts';
import { estimateWords } from './estimate.ts';

export const ALIGNMENT_WARNING = 'La transcripción o sus tiempos no coinciden con la narración. Se guardaron subtítulos estimados, no alineación real.';

// Only edge punctuation is cosmetic. Keep accents, internal punctuation and numbers meaningful.
function comparable(text: string): string {
  return text.normalize('NFC').toLocaleLowerCase('es').replace(/^[¿¡"'“”‘’«(\[]+|[!?.,;:…"'“”‘’»)\]]+$/gu, '');
}

/** Retains scene text; never reorders, clips or partially trusts an STT transcript. */
export function sttWordsToWords(sttWords: unknown, sceneText: string, durationMs: number, onWarning?: (warning: string) => void): Word[] {
  const estimated = estimateWords(sceneText, durationMs);
  const fallback = () => { onWarning?.(ALIGNMENT_WARNING); return estimated; };
  if (!Array.isArray(sttWords) || sttWords.length > 5000) return fallback();
  const spoken = sttWords.filter(item => item !== null && typeof item === 'object' && item.type === 'word');
  if (spoken.length !== estimated.length) return fallback();
  const words: Word[] = [];
  let previousEnd = 0;
  let previousRawEnd = 0;
  for (let index = 0; index < spoken.length; index++) {
    const item = spoken[index];
    const text = estimated[index]!.text;
    if (typeof item.text !== 'string' || !comparable(text) || comparable(item.text) !== comparable(text)
      || typeof item.start !== 'number' || typeof item.end !== 'number'
      || !Number.isFinite(item.start) || !Number.isFinite(item.end)
      || item.start < previousRawEnd || item.end <= item.start || item.end * 1000 > durationMs) return fallback();
    const startMs = Math.round(item.start * 1000);
    const endMs = Math.round(item.end * 1000);
    if (startMs < previousEnd || endMs <= startMs || endMs > durationMs) return fallback();
    words.push({ text, startMs, endMs, emphasis: false });
    previousEnd = endMs;
    previousRawEnd = item.end;
  }
  return words;
}
