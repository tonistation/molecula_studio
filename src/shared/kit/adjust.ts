import type { Project } from '../schema/types.ts';
import type { KitCamera, KitScene } from './types.ts';
import { validateKitScene } from './validate.ts';
import { applyKitScene } from './apply.ts';

export type SceneAdjustment =
  | { type: 'color'; field: 'background' | 'skyTop' | 'skyBottom' | 'terrain' | 'water'; value: string }
  | { type: 'camera'; camera: KitCamera; convertKeyframes?: boolean }
  | { type: 'labels'; labels: KitScene['labels'] };

/** Reuses the drawing boundary: never repairs data or mutates the draft. */
export function adjustKitScene(project: Project, sceneId: string, adjustment: SceneAdjustment): Project {
  const scene = project.scenes.find(item => item.sceneId === sceneId);
  if (!scene?.visual || !('kind' in scene.visual) || scene.visual.kind !== 'kit') throw new Error('La escena necesita un dibujo del kit para ajustar sus propiedades.');
  const kit = structuredClone(scene.visual);
  if (adjustment.type === 'color') {
    if (adjustment.field === 'background') kit.palette.background = adjustment.value;
    else if (adjustment.field === 'skyTop') kit.sky.top = adjustment.value;
    else if (adjustment.field === 'skyBottom') kit.sky.bottom = adjustment.value;
    else {
      const surface = kit.environment[adjustment.field];
      if (!surface) throw new Error('La escena no contiene esa superficie. Redibuja para añadirla.');
      surface.color = adjustment.value;
    }
  } else if (adjustment.type === 'camera') {
    if (kit.camera.keyframes && !adjustment.convertKeyframes) throw new Error('Conserva la pista de cámara o sustitúyela explícitamente antes de cambiar su movimiento.');
    kit.camera = structuredClone(adjustment.camera);
  } else kit.labels = structuredClone(adjustment.labels);
  const result = validateKitScene(kit, { durationMs: scene.durationMs,
    entities: new Map(project.entities.map(entity => [entity.entityId, entity])) });
  if (!result.ok) throw new Error('Ajuste inválido: usa colores #RRGGBB, cámara válida y hasta 6 rótulos de 1–120 caracteres anclados a objetos existentes. El borrador se conserva.');
  return applyKitScene(project, sceneId, result.scene);
}
