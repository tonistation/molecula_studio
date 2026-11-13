import { parseFlatResponse } from '../flat/parse.ts';
import type { MotionVisual } from './types.ts';
export function parseMotionResponse(text: string, durationMs: number): { ok: true; visual: MotionVisual } | { ok: false; errors: string[] } {
  return parseFlatResponse(text, durationMs, 'motion') as { ok: true; visual: MotionVisual } | { ok: false; errors: string[] };
}
