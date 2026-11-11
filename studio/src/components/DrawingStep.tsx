import { buildKitPrompt } from '../../../src/shared/kit/prompt.ts';
import { parseKitResponse } from '../../../src/shared/kit/parse.ts';
import { applyKitScene } from '../../../src/shared/kit/apply.ts';
import { ManualResponse } from './ManualResponse.tsx';
import type { DraftStepProps } from './ScriptStep.tsx';
import { useState } from 'react';
import { api } from '../api.ts';
import { GenerationMode } from './GenerationMode.tsx';

export function DrawingStep({ draft, sceneId, disabled, onEdit, codexCapability = 'unavailable' }: DraftStepProps & { sceneId: string }) {
  const [mode, setMode] = useState<'auto' | 'manual'>('manual');
  const [generatedFrom, setGeneratedFrom] = useState<string | null>(null);
  const index = draft.scenes.findIndex(scene => scene.sceneId === sceneId);
  const scene = draft.scenes[index];
  if (!scene) return null;
  return <details className="drawing-step">
    <summary>{scene.visual ? 'Redibujar esta escena' : 'Dibujar esta escena'} · {mode === 'manual' ? 'manual' : 'auto'}</summary>
    <fieldset className="manual-fields" disabled={disabled}>
      <p className="muted small">Una respuesta por escena. Dibuja en orden para reutilizar los objetos anteriores. Aplicar solo cambia este dibujo, sin guardar.</p>
      <GenerationMode label="Modo de dibujo" mode={mode} onChange={value => { setMode(value); setGeneratedFrom(null); }} capability={codexCapability} />
      <ManualResponse key={`${mode}:${sceneId}:${scene.durationMs}`} label="Pegar escena" copyLabel="Copiar prompt de dibujo"
        generate={mode === 'auto' ? async signal => {
          setGeneratedFrom(JSON.stringify(draft));
          return JSON.stringify(await api.generateDrawing(draft, sceneId, signal), null, 2);
        } : undefined}
        buildPrompt={() => buildKitPrompt({
          scene: { title: scene.title, text: scene.text, visualIntent: scene.visualIntent, durationMs: scene.durationMs },
          previousScenes: draft.scenes.slice(0, index), references: draft.sources ?? [], targetVisual: scene.visual,
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
        apply={kit => { onEdit(project => {
          if (mode === 'auto' && generatedFrom !== JSON.stringify(project)) throw new Error('El borrador cambió durante la generación. Genera el dibujo de nuevo o usa el modo manual.');
          return applyKitScene(project, sceneId, kit);
        }); return true; }} />
    </fieldset>
  </details>;
}
