import type { Project } from '../schema/types.ts';
import { validateProject } from '../schema/validate.ts';
import { validateKitScene } from './validate.ts';

/** Pure draft update: only the target visual and its scene revision change. */
export function applyKitScene(project: Project, sceneId: string, kit: unknown): Project {
  const input = validateProject(project);
  if (!input.ok || input.mode !== 'editable') throw new Error('El proyecto no es válido o es de solo lectura.');
  const target = project.scenes.find(scene => scene.sceneId === sceneId);
  if (!target) throw new Error('No se encontró la escena para dibujar.');
  const drawing = validateKitScene(kit, { durationMs: target.durationMs,
    entities: new Map(project.entities.map(entity => [entity.entityId, entity])) });
  if (!drawing.ok) throw new Error('La escena dibujada no es válida para su duración o sus referencias.');
  const candidate = { ...project, scenes: project.scenes.map(scene => scene.sceneId === sceneId
    ? { ...scene, visual: drawing.scene, revision: scene.revision + 1 } : scene) };
  const result = validateProject(candidate);
  if (!result.ok) throw new Error('El dibujo no produce un proyecto válido.');
  return result.project;
}
