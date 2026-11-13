import type { Project } from '../../src/shared/schema/types.ts';
import { validateProject } from '../../src/shared/schema/validate.ts';

export type SelectableStyle = 'stylized-3d' | 'vector-2d' | 'motion-graphics';

export function isSupportedStyle(project: Project): boolean {
  return project.styleVersion === 1 && (project.styleId === 'stylized-3d'
    || (project.schemaVersion === 3 && (project.styleId === 'vector-2d' || project.styleId === 'motion-graphics')));
}

/** A style change never upgrades an opaque legacy project or mutates the input. */
export function changeProjectStyle(project: Project, styleId: SelectableStyle, confirm: (count: number) => boolean): Project {
  if (!isSupportedStyle(project) || project.styleId === styleId) return project;
  const current = validateProject(project);
  if (!current.ok) throw new Error('No se puede cambiar el estilo con los datos actuales del proyecto.');
  if (current.mode !== 'editable') return project;
  const count = project.scenes.filter(scene => scene.visual !== null).length;
  const next: Project = { ...project, schemaVersion: 3, styleId, styleVersion: 1,
    scenes: project.scenes.map(scene => scene.visual === null ? scene : { ...scene, visual: null, revision: scene.revision + 1 }) };
  const checked = validateProject(next);
  if (!checked.ok || checked.mode !== 'editable') throw new Error('No se puede cambiar el estilo con los datos actuales del proyecto.');
  if (count && !confirm(count)) return project;
  return next;
}
