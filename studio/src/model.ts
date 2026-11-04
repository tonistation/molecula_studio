import type { Project, Scene } from '../../src/shared/schema/types.ts';
import { LIMITS } from '../../src/shared/schema/limits.ts';
import { serializeProject } from '../../src/shared/schema/serialize.ts';

/** Milliseconds multiple required by the schema grid. */
const STEP_MS = LIMITS.timeStepMs;
const DEFAULT_SCENE_MS = 4000;
const MIN_SCENE_MS = LIMITS.minSceneMs;
const MAX_SCENE_MS = LIMITS.maxSceneMs;

export function newSceneId(): string {
  return `s-${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
}

export function createScene(index: number): Scene {
  return {
    sceneId: newSceneId(),
    revision: 0,
    title: `Escena ${index + 1}`,
    startMs: 0,
    durationMs: DEFAULT_SCENE_MS,
    text: '',
    visualIntent: '',
    visual: null,
    audio: null,
    words: [],
    mediaBindings: { audio: null, words: null },
  };
}

/**
 * Recomputes contiguous `startMs` and the project duration. The schema
 * requires scenes to start exactly where the previous one ends and the sum to
 * match `output.durationMs`.
 */
export function relayout(scenes: Scene[]): { scenes: Scene[]; durationMs: number } {
  let start = 0;
  const next = scenes.map((scene) => {
    const laidOut: Scene = { ...scene, startMs: start };
    start += scene.durationMs;
    return laidOut;
  });
  return { scenes: next, durationMs: start };
}

export function withScenes(project: Project, scenes: Scene[]): Project {
  const { scenes: laidOut, durationMs } = relayout(scenes);
  return { ...project, scenes: laidOut, output: { ...project.output, durationMs } };
}

export function clampSceneMs(ms: number): number {
  const bounded = Math.min(MAX_SCENE_MS, Math.max(MIN_SCENE_MS, Math.round(ms)));
  return Math.round(bounded / STEP_MS) * STEP_MS;
}

export function sceneSeconds(durationMs: number): string {
  return (durationMs / 1000).toFixed(1).replace(/\.0$/, '');
}

export function parseSceneSeconds(value: string): number | null {
  const seconds = Number(value.replace(',', '.'));
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return clampSceneMs(seconds * 1000);
}

export function titleOrFallback(title: string): string {
  const trimmed = title.trim();
  return trimmed.length === 0 ? 'Proyecto sin título' : trimmed.slice(0, 120);
}

export function slugFilename(title: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase();
  return slug.length === 0 ? 'proyecto' : slug.slice(0, 60);
}

/** Download metadata describes this snapshot, never the canonical write state. */
export function snapshotTimestamp(project: Project, now = new Date().toISOString()): string {
  return new Date(Math.max(Date.parse(now), Date.parse(project.updatedAt))).toISOString();
}

export function downloadSnapshot(project: Project, dirty: boolean, now = new Date().toISOString()): Project {
  const changed = dirty || project.approval !== null;
  return { ...project, title: titleOrFallback(project.title), approval: null,
    revision: changed ? project.revision + 1 : project.revision,
    updatedAt: changed ? snapshotTimestamp(project, now) : project.updatedAt };
}

export function downloadJson(project: Project, raw?: string): void {
  const text = raw ?? serializeProject(project);
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${slugFilename(project.title)}.json`;
  anchor.rel = 'noopener';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function sceneHasContent(scene: Scene): boolean {
  return scene.text.trim().length > 0 || scene.visualIntent.trim().length > 0;
}
