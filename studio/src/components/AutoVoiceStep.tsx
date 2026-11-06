import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Project } from '../../../src/shared/schema/types.ts';
import { api, describeError } from '../api.ts';

export type GenerateVoice = (sceneId: string, signal: AbortSignal) => Promise<{ alignment: 'vibi' | 'estimated'; warnings: string[] }>;

export function AutoVoiceStep({ draft, dirty, disabled, configured, onGenerate, onBusy, statuses }: {
  draft: Project; dirty: boolean; disabled: boolean; configured: boolean; onGenerate: GenerateVoice; onBusy: (busy: boolean) => void;
  statuses: Record<string, string>;
}) {
  const [pending, setPending] = useState<{ project: Project; ids: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [credits, setCredits] = useState<number | null>(null);
  const [checking, setChecking] = useState(false);
  const operation = useRef<AbortController | null>(null);
  const account = useRef<AbortController | null>(null);
  useEffect(() => () => { operation.current?.abort(); account.current?.abort(); }, []);
  useEffect(() => { if (!operation.current) setPending(null); }, [draft]);
  const balance = async () => {
    if (checking || !configured) return;
    const controller = new AbortController(); account.current = controller;
    setChecking(true); setError('');
    try { const result = await api.vibiCredits(controller.signal); if (!controller.signal.aborted) setCredits(result.credits); }
    catch (caught) { if (!controller.signal.aborted) setError(describeError(caught)); }
    finally { if (!controller.signal.aborted) setChecking(false); }
  };
  const confirm = async () => {
    if (!pending || pending.project !== draft || dirty || disabled || operation.current) return;
    const controller = new AbortController(); operation.current = controller;
    const ids = pending.ids;
    setPending(null); setBusy(true); onBusy(true); setError('');
    let completed = 0;
    const warnings: string[] = [];
    try {
      for (const id of ids) {
        controller.signal.throwIfAborted();
        setProgress(`Generando voz ${completed + 1} de ${ids.length}…`);
        const result = await onGenerate(id, controller.signal);
        completed++; warnings.push(...result.warnings);
        controller.signal.throwIfAborted();
      }
      setProgress(`${completed} escenas con audio guardado.${warnings.length ? ` ${warnings.join(' ')}` : ' Subtítulos alineados con Vibi.'}`);
    } catch (caught) {
      if (!controller.signal.aborted) {
        setError(`${describeError(caught)} Se conservaron ${completed} escenas ya guardadas. No se continuó ni se reintentó.${warnings.length ? ` ${warnings.join(' ')}` : ''}`);
        setProgress('');
      }
    } finally {
      if (!controller.signal.aborted) { setBusy(false); onBusy(false); operation.current = null; }
    }
  };
  const cancel = () => {
    operation.current?.abort(); operation.current = null; setBusy(false); onBusy(false);
    setProgress('Espera cancelada. Las tareas ya enviadas pueden continuar y consumir créditos. Recargue desde disco antes de reintentar.');
  };
  const blocked = disabled || dirty || busy || !configured || checking || draft.locale !== 'es';
  const selected = pending ? draft.scenes.filter(scene => pending.ids.includes(scene.sceneId)) : [];
  const characters = selected.reduce((sum, scene) => sum + [...scene.text].length, 0);
  const cancelTarget = busy ? document.getElementById('voice-cancel-controls') : null;
  return <section aria-label="Voz automática">
    <h3>Voz automática · Vibi</h3>
    <p>Configure la voz, proveedor y modelo en el entorno del companion. La clave nunca se envía al navegador.</p>
    {!configured && <p>Vibi no configurado. La voz manual gratuita sigue disponible.</p>}
    {draft.locale !== 'es' && <p>La voz automática de este paso admite solo narración en español.</p>}
    {dirty && <p>Guarde los cambios antes de generar voz.</p>}
    <button type="button" disabled={!configured || checking || busy || disabled} onClick={() => void balance()}>Consultar créditos Vibi</button>
    {credits !== null && <p>Créditos disponibles al consultar: {credits}. Este saldo no garantiza que alcance para generar.</p>}
    <button type="button" disabled={blocked || !draft.scenes.length || draft.scenes.some(scene => !scene.text.trim())}
      onClick={() => setPending({ project: draft, ids: draft.scenes.map(scene => scene.sceneId) })}>Generar todas las voces</button>
    {draft.scenes.map((scene, index) => <button type="button" key={scene.sceneId} disabled={blocked || !scene.text.trim()}
      onClick={() => setPending({ project: draft, ids: [scene.sceneId] })}>{statuses[scene.sceneId] === 'desactualizada' ? `Regenerar esta escena · escena ${index + 1}` : `Generar voz · escena ${index + 1}`}</button>)}
    {pending && pending.project === draft && <section aria-label="Confirmar generación Vibi">
      <p>Se enviarán {characters} caracteres de {selected.length} escenas a TTS y luego sus audios a STT. Se reemplazará la voz de esas escenas y se guardará el proyecto.</p>
      <p>TTS cobra por caracteres y STT por duración del audio generado, todavía desconocida. Duración actual de referencia: {(selected.reduce((sum, scene) => sum + scene.durationMs, 0) / 1000).toFixed(1)} s; no es una cotización. Tarifa exacta no disponible: consulte su plan Vibi.</p>
      <p>Una cancelación, error o timeout no garantiza cancelar tareas ni consumo. No hay reintentos automáticos. Un fallo conserva las escenas anteriores.</p>
      <button type="button" disabled={blocked} onClick={() => void confirm()}>Confirmar generación y consumo TTS + STT</button>
      <button type="button" disabled={busy} onClick={() => setPending(null)}>Cancelar generación</button>
    </section>}
    {busy && cancelTarget && createPortal(<div className="banner banner-warn">
      <span>{progress}</span><button type="button" onClick={cancel}>Cancelar espera de voz</button>
    </div>, cancelTarget)}
    {progress && <p role="status">{progress}</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
