/**
 * Frame clock shared by preview and export.
 *
 * Storage unit is integer milliseconds; per-frame time is never snapped to an
 * integer, so repeated evaluation of the same frame yields the same state.
 */

export function totalFrames(durationMs: number, fps: number): number {
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    throw new RangeError('totalFrames: durationMs must be a finite number >= 0');
  }
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new RangeError('totalFrames: fps must be a finite number > 0');
  }
  return Math.ceil((durationMs * fps) / 1000);
}

export function frameTimeMs(frameIndex: number, fps: number): number {
  if (!Number.isSafeInteger(frameIndex) || frameIndex < 0) {
    throw new RangeError('frameTimeMs: frameIndex must be a safe integer >= 0');
  }
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new RangeError('frameTimeMs: fps must be a finite number > 0');
  }
  return (frameIndex * 1000) / fps;
}
