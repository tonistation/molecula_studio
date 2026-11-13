import { parseFlatResponse } from '../flat/parse.ts';
import type { VectorVisual } from './types.ts';
export function parseVectorResponse(text: string, durationMs: number): { ok: true; visual: VectorVisual } | { ok: false; errors: string[] } {
  return parseFlatResponse(text, durationMs, 'vector') as { ok: true; visual: VectorVisual } | { ok: false; errors: string[] };
}
