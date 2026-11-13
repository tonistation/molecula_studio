import type { Project } from '../schema/types.ts';
import { validateProject } from '../schema/validate.ts';
import { parseFlatResponse } from './parse.ts';

export function applyFlatVisual(project: Project, sceneId: string, visual: unknown, kind: 'vector' | 'motion'): Project {
  const input = validateProject(project);
  if (!input.ok || input.mode !== 'editable' || input.project.schemaVersion !== 3 || input.project.styleId !== (kind === 'vector' ? 'vector-2d' : 'motion-graphics')) throw new Error('El proyecto no es válido, es de solo lectura o tiene otro estilo.');
  const scene = input.project.scenes.find(item => item.sceneId === sceneId);
  if (!scene) throw new Error('No se encontró la escena para dibujar.');
  // Validate before serialization so accessors and cycles cannot execute or escape inspection.
  const candidate = { ...input.project, scenes: input.project.scenes.map(item => item.sceneId === sceneId ? { ...item, visual, revision: item.revision + 1 } : item) };
  const result = validateProject(candidate);
  if (!result.ok || result.mode !== 'editable') throw new Error('El dibujo no produce un proyecto válido.');
  const parsed = parseFlatResponse(JSON.stringify(result.project.scenes.find(item => item.sceneId === sceneId)!.visual), scene.durationMs, kind);
  if (!parsed.ok) throw new Error('El dibujo no es válido para esta escena.');
  return result.project;
}
