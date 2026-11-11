import type { Project } from '../schema/types.ts';
import { validateProject } from '../schema/validate.ts';
import { validateKitScene } from './validate.ts';
import { verifyModelSnapshotsSync } from '../models/integrity.ts';
import { canonicalize } from '../canonical.ts';

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

/** Apply a scene and verified portable model snapshots as one draft update. */
export function applyKitSceneWithModels(project: Project, sceneId: string, kit: unknown, models: unknown): Project {
  const input = validateProject(project);
  if (!input.ok || input.mode !== 'editable') throw new Error('El proyecto no es válido o es de solo lectura.');
  const existing = verifyModelSnapshotsSync(input.project.models ?? []);
  const incoming = verifyModelSnapshotsSync(models);
  if (!existing || !incoming) throw new Error('No se pudo verificar la integridad de los modelos.');
  const merged = new Map(existing.map(snapshot => [snapshot.id, snapshot]));
  for (const snapshot of incoming) {
    const previous = merged.get(snapshot.id);
    if (previous && canonicalize(previous.model) !== canonicalize(snapshot.model)) {
      throw new Error('Los modelos contienen IDs incompatibles.');
    }
    merged.set(snapshot.id, snapshot);
  }
  const snapshots = [...merged.values()];
  const verified = verifyModelSnapshotsSync(snapshots);
  if (!verified) throw new Error('El proyecto supera el límite de modelos.');
  return applyKitScene({ ...input.project, ...(verified.length ? { models: verified } : {}) }, sceneId, kit);
}
