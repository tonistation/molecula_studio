import { validateVisual } from '../vector/validate.ts';
import type { MotionVisual } from './types.ts';
import type { Issue } from '../schema/types.ts';

export function validateMotionVisual(value: unknown, durationMs: number): { ok: true; visual: MotionVisual } | { ok: false; issues: Issue[] } {
  return validateVisual(value, durationMs, 'motion') as { ok: true; visual: MotionVisual } | { ok: false; issues: Issue[] };
}
