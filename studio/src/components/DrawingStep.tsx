import { buildKitPrompt } from '../../../src/shared/kit/prompt.ts';
import { parseKitResponse } from '../../../src/shared/kit/parse.ts';
import { applyKitScene } from '../../../src/shared/kit/apply.ts';
import { ManualResponse } from './ManualResponse.tsx';
import type { DraftStepProps } from './ScriptStep.tsx';

export function DrawingStep({ draft, sceneId, disabled, onEdit }: DraftStepProps & { sceneId: string }) {
  const index = draft.scenes.findIndex(scene => scene.sceneId === sceneId);
  const scene = draft.scenes[index];
  if (!scene) return null;
  return <details className="drawing-step">
    <summary>{scene.visual ? 'Redibujar esta escena' : 'Dibujar esta escena'} · manual</summary>
    <fieldset className="manual-fields" disabled={disabled}>
      <p className="muted small">Una respuesta por escena. Dibuja en orden para reutilizar los objetos anteriores. Aplicar solo cambia este dibujo, sin guardar.</p>
      <ManualResponse key={`${sceneId}:${scene.durationMs}`} label="Pegar escena" copyLabel="Copiar prompt de dibujo"
        buildPrompt={() => buildKitPrompt({
          scene: { title: scene.title, text: scene.text, visualIntent: scene.visualIntent, durationMs: scene.durationMs },
          previousScenes: draft.scenes.slice(0, index), references: draft.sources ?? [],
        })}
        parse={text => {
          const result = parseKitResponse(text, { durationMs: scene.durationMs,
            entities: new Map(draft.entities.map(entity => [entity.entityId, entity])) });
          return result.ok ? { ok: true, value: result.scene } : result;
        }}
        review={kit => <section aria-label="Revisión del dibujo">
          <p>{kit.objects.length} objetos · {kit.labels.length} rótulos · {kit.particles.length} sistemas de partículas</p>
          <p>Cámara: {kit.camera.move}</p>
          <ul>{kit.objects.map(object => <li key={object.id}>{object.id} · {object.type}</li>)}</ul>
          <p>Se reemplazará únicamente el dibujo de «{scene.title}».</p>
        </section>}
        apply={kit => { onEdit(project => applyKitScene(project, sceneId, kit)); return true; }} />
    </fieldset>
  </details>;
}
