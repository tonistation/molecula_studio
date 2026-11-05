import type { KitObject, KitScene } from '../kit/types.ts';
import type { Entity, LegacyProject, Project, StylizedVisual } from './types.ts';

/** Converts validated v1 data only. Validation of both versions belongs to validateProject. */
export function migrateV1Project(source: LegacyProject): Project {
  const project = structuredClone(source);
  const entities = new Map(project.entities.map(entity => [entity.entityId, entity]));
  return {
    ...project,
    schemaVersion: 2,
    scenes: project.scenes.map(scene => ({ ...scene,
      visual: scene.visual === null || 'inert' in scene.visual
        ? scene.visual : migrateVisual(scene.visual, entities, project.seed),
    })),
  };
}

function migrateVisual(visual: StylizedVisual, entities: Map<string, Entity>, seed: number): KitScene {
  const first = visual.camera.keyframes[0]!;
  const last = visual.camera.keyframes.at(-1)!;
  return {
    kind: 'kit', kitVersion: 1,
    palette: { background: visual.background, preset: visual.palette },
    sky: { top: visual.background, bottom: visual.background, sun: null, clouds: [] },
    environment: { seed, terrain: null, water: null },
    objects: visual.components.map(component => {
      const entity = entities.get(component.entityId)!;
      const identity = entity.identity;
      const color = identity.type === 'rockLayers' ? identity.props.colors[0]!
        : identity.type === 'character' || identity.type === 'car' ? identity.props.bodyColor : identity.props.color;
      return {
        id: component.componentId, type: identity.type,
        params: { proportions: identity.proportions, ...identity.props },
        position: component.position, rotation: component.rotation, scale: component.scale,
        color, seed: entity.seed, animations: [],
        legacy: { entityId: component.entityId, definitionVersion: component.definitionVersion,
          motion: component.motion, state: component.state },
      } as KitObject;
    }),
    particles: [], labels: [], overlays: [],
    camera: { move: visual.camera.keyframes.length === 1 ? 'static' : 'pan', from: first.position,
      to: last.position, target: first.target, easing: 'linear', keyframes: visual.camera.keyframes },
  };
}
