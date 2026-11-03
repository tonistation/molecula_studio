import { SCHEMA_VERSION } from './limits.ts';
import { validateProject } from './validate.ts';
import type { Project } from './types.ts';

export interface EmptyProjectArgs {
  projectId: string;
  now: string;
  title?: string;
}

/**
 * Creates a complete, empty schema-1 document: no scenes, no entities, no
 * assets and zero duration. The document is validated before returning so a
 * broken default can never reach the store.
 */
export function emptyProject(args: EmptyProjectArgs): Project {
  const project: Project = {
    schemaVersion: SCHEMA_VERSION,
    projectId: args.projectId,
    revision: 0,
    title: args.title ?? 'Proyecto sin título',
    createdAt: args.now,
    updatedAt: args.now,
    idea: '',
    locale: 'es',
    styleId: 'stylized-3d',
    styleVersion: 1,
    seed: 0,
    output: {
      width: 1080,
      height: 1920,
      fps: 30,
      durationMs: 0,
      container: 'mp4',
      voiceMode: 'silent',
    },
    captionStyle: {
      enabled: true,
      fontId: 'builtin-sans-heavy-v1',
      fontSizePx: 72,
      color: '#FFFFFF',
      highlightColor: '#FFD54A',
      anchor: 'upper',
      safeMarginPx: 120,
    },
    entities: [],
    scenes: [],
    assets: [],
    approval: null,
  };

  const result = validateProject(project);
  if (!result.ok) {
    throw new TypeError(`emptyProject produced an invalid document: ${JSON.stringify(result.issues)}`);
  }
  return project;
}
