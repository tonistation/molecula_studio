import { useRef, useState } from 'react';
import { buildVectorPrompt } from '../../../src/shared/vector/prompt.ts';
import { buildMotionPrompt } from '../../../src/shared/motion/prompt.ts';
import { parseVectorResponse } from '../../../src/shared/vector/parse.ts';
import { parseMotionResponse } from '../../../src/shared/motion/parse.ts';
import { applyVectorVisual } from '../../../src/shared/vector/apply.ts';
import { applyMotionVisual } from '../../../src/shared/motion/apply.ts';
import type { VectorVisual } from '../../../src/shared/vector/types.ts';
import type { MotionVisual } from '../../../src/shared/motion/types.ts';
import { DRAWING_TIMEOUT_MS } from '../../../src/shared/generation-timeouts.ts';
import { api } from '../api.ts';
import { GenerationMode } from './GenerationMode.tsx';
import { ManualResponse } from './ManualResponse.tsx';
import type { DraftStepProps } from './ScriptStep.tsx';

export function FlatDrawingStep({ draft, sceneId, disabled, onEdit, codexCapability = 'unavailable' }: DraftStepProps & { sceneId: string }) {
  const [mode, setMode] = useState<'manual' | 'auto'>('manual');
  const promptDraft = useRef<string | null>(null);
  const generatedDraft = useRef<string | null>(null);
  const index = draft.scenes.findIndex(scene => scene.sceneId === sceneId);
  const scene = draft.scenes[index];
  if (!scene) return null;
  const vector = draft.styleId === 'vector-2d';
  return <details className="drawing-step">
    <summary>{scene.visual ? 'Redibujar esta escena' : 'Dibujar esta escena'} · {mode === 'manual' ? 'manual' : 'auto'}</summary>
    <fieldset className="manual-fields" disabled={disabled}>
      <p className="muted small">{vector ? 'Ilustración 2D vectorial' : 'Motion graphics'}: una respuesta por escena. Dibuje en orden para mantener continuidad. Aplicar no guarda.</p>
      <GenerationMode label="Modo de dibujo" mode={mode} onChange={value => { setMode(value); promptDraft.current = null; generatedDraft.current = null; }} capability={codexCapability} />
      <ManualResponse<{ visual: VectorVisual | MotionVisual; reviewedFrom: string }> key={`${mode}:${sceneId}:${scene.durationMs}`} label="Pegar escena" copyLabel="Copiar prompt de dibujo" timeoutMs={DRAWING_TIMEOUT_MS}
        generate={mode === 'auto' ? async signal => {
          generatedDraft.current = JSON.stringify(draft);
          return JSON.stringify(await api.generateFlatDrawing(draft, sceneId, signal), null, 2);
        } : undefined}
        buildPrompt={() => {
          promptDraft.current = JSON.stringify(draft);
          const input = { scene: { title: scene.title, text: scene.text, visualIntent: scene.visualIntent, durationMs: scene.durationMs }, previousScenes: draft.scenes.slice(0, index) };
          return vector ? buildVectorPrompt(input) : buildMotionPrompt(input);
        }}
        parse={text => {
          const reviewedFrom = JSON.stringify(draft);
          if (mode === 'manual' && promptDraft.current !== null && promptDraft.current !== reviewedFrom) return { ok: false, errors: ['El borrador cambió desde que copiaste el prompt. Vuelve a copiarlo.'] };
          if (mode === 'auto' && generatedDraft.current !== reviewedFrom) return { ok: false, errors: ['El borrador cambió durante la generación. Genera el dibujo de nuevo.'] };
          const result = vector ? parseVectorResponse(text, scene.durationMs) : parseMotionResponse(text, scene.durationMs);
          return result.ok ? { ok: true, value: { visual: result.visual, reviewedFrom } } : result;
        }}
        review={({ visual }) => <section aria-label="Revisión del dibujo">
          <p>{vector ? '2D vectorial' : 'Motion'} · {visual.layers.length} capas</p>
          <ul>{visual.layers.map(layer => <li key={layer.id}>{layer.id} · {layer.type}</li>)}</ul>
          <p>Se reemplazará únicamente el dibujo de «{scene.title}».</p>
        </section>}
        apply={({ visual, reviewedFrom }, signal) => {
          signal.throwIfAborted();
          onEdit(project => {
            if (JSON.stringify(project) !== reviewedFrom) throw new Error('El borrador cambió desde la revisión. No se aplicó el dibujo.');
            return vector ? applyVectorVisual(project, sceneId, visual) : applyMotionVisual(project, sceneId, visual);
          });
          return true;
        }} />
    </fieldset>
  </details>;
}
