import type { Word } from '../../shared/schema/types.ts';

export interface Phrase {
  words: readonly Word[];
  startMs: number;
  endMs: number;
}

/** Short deterministic pages; retain supplied timestamps and emphasis exactly. */
export function captionPhrases(words: readonly Word[]): Phrase[] {
  const phrases: Phrase[] = [];
  let start = 0;
  while (start < words.length) {
    let count = Math.min(5, words.length - start);
    // Avoid an orphan final word when there is enough narration to form two phrases.
    if (words.length - start === 6) count = 4;
    for (let offset = 1; offset < count - 1; offset++) {
      if (/[.!?…]$/u.test(words[start + offset]!.text) && words.length - start - offset - 1 !== 1) {
        count = offset + 1;
        break;
      }
    }
    const page = words.slice(start, start + count);
    phrases.push({ words: page, startMs: page[0]!.startMs, endMs: page.at(-1)!.endMs });
    start += count;
  }
  return phrases;
}

export function phraseAt(phrases: readonly Phrase[], ms: number): Phrase | null {
  return phrases.find(phrase => ms >= phrase.startMs && ms < phrase.endMs) ?? null;
}

/** Bound unusually dense phrases vertically without measuring after paint. */
export function captionFontSize(words: readonly Word[], requested: number, width: number, height: number): number {
  const characters = words.reduce((sum, word) => sum + Array.from(word.text).length + 1, 0);
  return Math.min(requested, Math.sqrt(width * height / (Math.max(1, characters) * 2.4)));
}
