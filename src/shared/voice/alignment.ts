import type { Word } from '../schema/types.ts';
import { estimateWords } from './estimate.ts';

export const ALIGNMENT_WARNING = 'La transcripción o sus tiempos no coinciden con la narración. Se guardaron subtítulos estimados, no alineación real.';

const REASONS = {
  'invalid-response': 'La respuesta no contiene una lista de palabras válida.',
  'entry-limit': 'La transcripción supera el límite de 5000 entradas.',
  'word-count-mismatch': 'La cantidad de palabras transcritas no coincide con la narración.',
  'text-mismatch': 'Una palabra transcrita no coincide con la narración.',
  'invalid-time': 'Una palabra tiene tiempos ausentes o no numéricos finitos.',
  'negative-time': 'Una palabra tiene tiempos negativos.',
  'invalid-interval': 'Una palabra termina antes de empezar o tiene duración nula.',
  'overlap': 'Los tiempos de palabras se solapan o están fuera de orden.',
  'out-of-range': 'Una palabra supera la duración del audio.',
  'rounding-collapse': 'Un intervalo de palabra no se puede representar en milisegundos.',
} as const;

export type AlignmentReason = keyof typeof REASONS;
export type AlignmentKind = 'aligned' | 'partial' | 'estimated';

/** Legacy `alignment` remains estimated whenever any word is estimated. */
export function alignmentKind(diagnostic?: AlignmentDiagnostic): AlignmentKind {
  return diagnostic ? diagnostic.repairedWordCount ? 'partial' : 'estimated' : 'aligned';
}

/** Ephemeral allowlist: never include provider text, URLs or raw timestamps. */
export interface AlignmentDiagnostic {
  reason: AlignmentReason;
  expectedWordCount: number;
  durationMs: number;
  receivedEntryCount?: number;
  spokenWordCount?: number;
  /** Zero-based index in the filtered word list, not the provider entry list. */
  wordIndex?: number;
  /** Present only for successful bounded partial recovery; never persisted. */
  repairedWordCount?: number;
}

// Only edge punctuation is cosmetic. Keep accents, internal punctuation and numbers meaningful.
function comparable(text: string): string {
  return text.normalize('NFC').toLocaleLowerCase('es').replace(/^[¿¡"'“”‘’«(\[]+|[!?.,;:…"'“”‘’»)\]]+$/gu, '');
}

/** Retains exact matching words and valid anchors; estimates only safe nonpositive spans. */
export function sttWordsToWords(sttWords: unknown, sceneText: string, durationMs: number,
  onWarning?: (warning: string) => void, onDiagnostic?: (diagnostic: AlignmentDiagnostic) => void): Word[] {
  const estimated = estimateWords(sceneText, durationMs);
  const counts = { expectedWordCount: estimated.length, durationMs } as Pick<AlignmentDiagnostic, 'expectedWordCount' | 'durationMs' | 'receivedEntryCount' | 'spokenWordCount'>;
  const fallback = (reason: AlignmentReason, wordIndex?: number) => {
    onDiagnostic?.({ reason, ...counts, ...(wordIndex === undefined ? {} : { wordIndex }) });
    onWarning?.(`${REASONS[reason]} [${reason}] Se guardaron subtítulos estimados, no alineación real.`);
    return estimated;
  };
  if (!Array.isArray(sttWords)) return fallback('invalid-response');
  // Reject before filtering; do not traverse or report unbounded provider arrays.
  if (sttWords.length > 5000) return fallback('entry-limit');
  const spoken = sttWords.filter(item => item !== null && typeof item === 'object' && item.type === 'word');
  counts.receivedEntryCount = sttWords.length;
  counts.spokenWordCount = spoken.length;
  if (spoken.length !== estimated.length) return fallback('word-count-mismatch');
  const words: (Word | null)[] = [];
  let firstInvalid: number | undefined;
  let repairedWordCount = 0;
  let previousEnd = 0;
  let previousRawEnd = 0;
  for (let index = 0; index < spoken.length; index++) {
    const item = spoken[index];
    const text = estimated[index]!.text;
    if (typeof item.text !== 'string' || !comparable(text) || comparable(item.text) !== comparable(text)) return fallback('text-mismatch', index);
    if (typeof item.start !== 'number' || typeof item.end !== 'number'
      || !Number.isFinite(item.start) || !Number.isFinite(item.end)) return fallback('invalid-time', index);
    if (item.start < 0 || item.end < 0) return fallback('negative-time', index);
    // Even defective durations must have finite, nonnegative endpoints inside the audio.
    if (item.start * 1000 > durationMs || item.end * 1000 > durationMs) return fallback('out-of-range', index);
    if (item.end <= item.start) {
      firstInvalid ??= index;
      words.push(null);
      continue;
    }
    if (item.start < previousRawEnd) return fallback('overlap', index);
    const startMs = Math.round(item.start * 1000);
    const endMs = Math.round(item.end * 1000);
    if (startMs < previousEnd || endMs <= startMs || endMs > durationMs) return fallback('rounding-collapse', index);
    words.push({ text, startMs, endMs, emphasis: false });
    previousEnd = endMs;
    previousRawEnd = item.end;
  }
  if (firstInvalid === undefined) return words as Word[];
  if (!words.some(word => word !== null)) return fallback('invalid-interval', firstInvalid);
  for (let index = 0; index < words.length;) {
    if (words[index]) { index++; continue; }
    const start = index;
    while (index < words.length && !words[index]) index++;
    const left = words[start - 1]?.endMs ?? 0;
    const right = words[index]?.startMs ?? durationMs;
    if (right - left < index - start) return fallback('invalid-interval', firstInvalid);
    const repair = estimateWords(estimated.slice(start, index).map(word => word.text).join(' '), right - left);
    repair.forEach((word, offset) => { words[start + offset] = { ...word, startMs: word.startMs + left, endMs: word.endMs + left }; });
    repairedWordCount += repair.length;
  }
  onDiagnostic?.({ reason: 'invalid-interval', ...counts, wordIndex: firstInvalid, repairedWordCount });
  onWarning?.(`Alineación parcial: se conservaron los tiempos válidos; ${repairedWordCount} palabras con tiempos estimados. [invalid-interval]`);
  return words as Word[];
}
