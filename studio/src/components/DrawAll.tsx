import { useEffect, useRef, useState } from 'react';
import { api, ApiError, describeError } from '../api.ts';
import { applyKitScene } from '../../../src/shared/kit/apply.ts';
import type { DraftStepProps } from './ScriptStep.tsx';

/** Sequential generation sends each accepted drawing as continuity for the next. */
export function DrawAll({ draft, disabled, onEdit }: DraftStepProps) {
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
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
        const kit = await api.generateDrawing(working, scene.sceneId, controller.signal);
        if (controller.signal.aborted) return;
        const expected = JSON.stringify(working);
        const next = applyKitScene(working, scene.sceneId, kit);
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
    } finally { pending.current = null; if (!controller.signal.aborted) setBusy(false); }
  };
  return <div>
    <p className="muted small">Dibujar todas reemplaza los dibujos, uno por uno, con continuidad. No cambia el guion ni guarda. Un fallo conserva las escenas ya dibujadas.</p>
    <button type="button" disabled={disabled || busy || !draft.scenes.length} onClick={() => void draw()}>Dibujar todas con Codex</button>
    {progress && <p role="status">{progress}</p>}
    {error && <p role="alert" className="banner banner-error">{error}</p>}
    {response && <label className="field"><span>Respuesta de Codex para revisión manual</span>
      <textarea aria-label="Respuesta de Codex para revisión manual" rows={5} readOnly value={response} />
    </label>}
  </div>;
}
