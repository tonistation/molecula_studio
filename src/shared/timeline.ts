import { validateProject } from './schema/index.ts';
import type { Project } from './schema/types.ts';

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

/** Renderer-independent clock sample, not a ready-to-render visual state. */
export interface FrameSample {
  frameIndex: number;
  timeMs: number;
  sceneIndex: number;
  sceneId: string;
  sceneTimeMs: number;
  seed: number;
}

/**
 * Sample schema-1 data from scratch: no mutable cursor, deltas or random calls.
 * Validation keeps malformed layouts and inert styles out of future consumers;
 * missing visuals/media remain valid drafts, not evidence of render readiness.
 * Empty projects and the exclusive endpoint have no frame (RangeError).
 */
export function evaluateFrame(snapshot: Project, frameIndex: number): FrameSample {
  const timeMs = frameTimeMs(frameIndex, snapshot.output.fps);
  const validated = validateProject(snapshot);
  if (!validated.ok || validated.mode !== 'editable') {
    throw new RangeError('evaluateFrame: expected a valid editable schema-1 project');
  }
  const project = validated.project;
  if (frameIndex >= totalFrames(project.output.durationMs, project.output.fps)) {
    throw new RangeError('evaluateFrame: frameIndex is outside the project');
  }
  const sceneIndex = project.scenes.findIndex(scene =>
    timeMs >= scene.startMs && timeMs < scene.startMs + scene.durationMs);
  const scene = project.scenes[sceneIndex]!; // Validated scenes cover the whole timeline.
  return {
    frameIndex,
    timeMs,
    sceneIndex,
    sceneId: scene.sceneId,
    sceneTimeMs: timeMs - scene.startMs,
    seed: project.seed,
  };
}
