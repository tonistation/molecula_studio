import { useEffect, useRef, useState } from 'react';
import { api, ApiError, describeError } from '../api.ts';
import { applyKitSceneWithModels } from '../../../src/shared/kit/apply.ts';
import type { DraftStepProps } from './ScriptStep.tsx';
import { DRAWING_TIMEOUT_MS } from '../../../src/shared/generation-timeouts.ts';
import { useElapsed } from './useElapsed.ts';
import { applyVectorVisual } from '../../../src/shared/vector/apply.ts';
import { applyMotionVisual } from '../../../src/shared/motion/apply.ts';

/** Sequential generation sends each accepted drawing as continuity for the next. */
export function DrawAll({ draft, disabled, onEdit }: DraftStepProps) {
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const elapsed = useElapsed(busy, progress);
  const [response, setResponse] = useState('');
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  useEffect(() => {
    if (disabled && pending.current) {
      pending.current.abort();
      setBusy(false);
      setProgress('Dibujo detenido. Se conservan los dibujos ya aplicados.');
    }
  }, [disabled]);
  const draw = async () => {
    if (pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true); setError(''); setResponse('');
    let working = draft;
    try {
      for (const [index, scene] of draft.scenes.entries()) {
        setProgress(`Dibujando ${index + 1} de ${draft.scenes.length}…`);
        const expected = JSON.stringify(working);
        let next;
        if (working.schemaVersion === 3 && working.styleVersion === 1 && (working.styleId === 'vector-2d' || working.styleId === 'motion-graphics')) {
          const visual = await api.generateFlatDrawing(working, scene.sceneId, controller.signal);
          if (controller.signal.aborted) return;
          next = working.styleId === 'vector-2d' ? applyVectorVisual(working, scene.sceneId, visual) : applyMotionVisual(working, scene.sceneId, visual);
        } else if (working.styleId === 'stylized-3d' && working.styleVersion === 1) {
          const bundle = await api.generateModelDrawing(working, scene.sceneId, controller.signal);
          if (controller.signal.aborted) return;
          next = applyKitSceneWithModels(working, scene.sceneId, bundle.scene, bundle.models);
        } else throw new Error('El estilo de este proyecto no admite dibujo.');
        onEdit(project => {
          if (JSON.stringify(project) !== expected) throw new Error('El borrador cambió. Se detuvo el dibujo para no reemplazar tus cambios.');
          return next;
        });
        working = next;
      }
      setProgress('Dibujos aplicados al borrador. Los cambios no se han guardado.');
    } catch (failure) {
      if (!controller.signal.aborted) {
        setError(`${describeError(failure)} Se conservan los dibujos ya aplicados.`); setProgress('');
        if (failure instanceof ApiError && typeof failure.details.responseText === 'string') setResponse(failure.details.responseText);
      }
    } finally { pending.current = null; setBusy(false); }
  };
  return <div>
    <p className="muted small">Dibujar todas reemplaza los dibujos, uno por uno, con continuidad. No cambia el guion ni guarda. Un fallo conserva las escenas ya dibujadas.</p>
    <button type="button" disabled={disabled || busy || !draft.scenes.length} onClick={() => void draw()}>Dibujar todas con Codex</button>
    {busy && <button type="button" onClick={() => { pending.current?.abort(); setProgress('Dibujo detenido. Se conservan los dibujos ya aplicados.'); }}>Cancelar generación</button>}
    {progress && <p role="status">{progress} {busy && `Puede tardar varios minutos. Transcurrido: ${elapsed} s; límite por escena: ${DRAWING_TIMEOUT_MS / 1000} s.`}</p>}
    {error && <p role="alert" className="banner banner-error">{error}</p>}
    {response && <label className="field"><span>Respuesta de Codex para revisión manual</span>
      <textarea aria-label="Respuesta de Codex para revisión manual" rows={5} readOnly value={response} />
    </label>}
  </div>;
}
