import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Project } from '../../../src/shared/schema/types.ts';
import type { VoiceCatalog, VoiceSelection } from '../../../src/shared/voice/selection.ts';
import { api, describeError } from '../api.ts';

export type GenerateVoice = (sceneId: string, signal: AbortSignal, selection?: VoiceSelection) => Promise<{ alignment: 'vibi' | 'estimated'; warnings: string[] }>;

export function AutoVoiceStep({ draft, dirty, disabled, configured, defaultVoiceConfigured, onGenerate, onBusy, statuses }: {
  draft: Project; dirty: boolean; disabled: boolean; configured: boolean; defaultVoiceConfigured: boolean; onGenerate: GenerateVoice; onBusy: (busy: boolean) => void;
  statuses: Record<string, string>;
}) {
  const [pending, setPending] = useState<{ project: Project; ids: string[]; selection?: VoiceSelection; label: string } | null>(null);
  const [catalog, setCatalog] = useState<VoiceCatalog | null>(null);
  const [voiceId, setVoiceId] = useState('');
  const [loadingVoices, setLoadingVoices] = useState(false);
  const catalogRequest = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [credits, setCredits] = useState<number | null>(null);
  const [checking, setChecking] = useState(false);
  const operation = useRef<AbortController | null>(null);
  const account = useRef<AbortController | null>(null);
  useEffect(() => () => { operation.current?.abort(); account.current?.abort(); catalogRequest.current?.abort(); }, []);
  useEffect(() => { if (!operation.current) setPending(null); }, [draft]);
  const balance = async () => {
    if (checking || !configured) return;
    const controller = new AbortController(); account.current = controller;
    setChecking(true); setError('');
    try { const result = await api.vibiCredits(controller.signal); if (!controller.signal.aborted) setCredits(result.credits); }
    catch (caught) { if (!controller.signal.aborted) setError(describeError(caught)); }
    finally { if (!controller.signal.aborted) setChecking(false); }
  };
  const loadVoices = async () => {
    if (catalogRequest.current || !configured || busy || disabled) return;
    const controller = new AbortController(); catalogRequest.current = controller;
    setLoadingVoices(true); setPending(null); setError('');
    try {
      const result = await api.vibiVoices(controller.signal);
      if (!controller.signal.aborted) { setCatalog(result); setVoiceId(''); }
    } catch (caught) { if (!controller.signal.aborted) setError(describeError(caught)); }
    finally { if (!controller.signal.aborted) { setLoadingVoices(false); catalogRequest.current = null; } }
  };
  const requestGeneration = (ids: string[]) => {
    const voice = catalog?.voices.find(item => item.voiceId === voiceId);
    setPending({ project: draft, ids, label: voice && catalog ? `${voice.name} · ${catalog.provider} / ${voice.voiceId}` : 'Voz predeterminada del companion',
      ...(voice && catalog ? { selection: { provider: catalog.provider, voiceId: voice.voiceId } } : {}) });
  };
  const confirm = async () => {
    if (!pending || pending.project !== draft || dirty || disabled || operation.current) return;
    const controller = new AbortController(); operation.current = controller;
    const ids = pending.ids;
    const selection = pending.selection;
    setPending(null); setBusy(true); onBusy(true); setError('');
    let completed = 0;
    const warnings: string[] = [];
    try {
      for (const id of ids) {
        controller.signal.throwIfAborted();
        setProgress(`Generando voz ${completed + 1} de ${ids.length}…`);
        const result = await onGenerate(id, controller.signal, selection);
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
  const blocked = disabled || dirty || busy || !configured || (!voiceId && !defaultVoiceConfigured) || checking || loadingVoices || draft.locale !== 'es';
  const selected = pending ? draft.scenes.filter(scene => pending.ids.includes(scene.sceneId)) : [];
  const characters = selected.reduce((sum, scene) => sum + [...scene.text].length, 0);
  const cancelTarget = busy ? document.getElementById('voice-cancel-controls') : null;
  return <section className="auto-voice" aria-label="Voz automática">
    <h3>Voz automática · Vibi</h3>
    <p>Elija una voz del proveedor configurado o use la predeterminada del companion. La clave y el modelo permanecen en el servidor.</p>
    <button type="button" disabled={!configured || busy || disabled || loadingVoices} onClick={() => void loadVoices()}>Cargar voces Vibi</button>
    {loadingVoices && <p role="status">Cargando voces…</p>}
    <label className="field"><span>Voz para generar</span>
      <select aria-label="Voz para generar" value={voiceId} disabled={disabled || busy || loadingVoices || !configured} onChange={event => { setVoiceId(event.target.value); setPending(null); }}>
        <option value="" disabled={!defaultVoiceConfigured}>{defaultVoiceConfigured ? 'Predeterminada del companion' : 'Seleccione una voz del catálogo'}</option>
        {catalog?.voices.map(voice => <option key={voice.voiceId} value={voice.voiceId}>{voice.name} · {catalog.provider} / {voice.voiceId}</option>)}
      </select>
    </label>
    {configured && !defaultVoiceConfigured && <p>No hay voz predeterminada válida. Cargue el catálogo y seleccione una voz; el proveedor y el modelo deben estar configurados en el companion.</p>}
    <p className="muted small">La selección se aplica a la próxima generación, por escena o a todas; no se guarda como preferencia. Cambiarla no reemplaza audios existentes. Cargar voces consulta Vibi, sin enviar narración ni generar audio. La disponibilidad y el acento dependen del proveedor.</p>
    {catalog && <p role="status">{catalog.voices.length} voces disponibles en esta consulta{catalog.hasMore ? ' (primeros 30 resultados; el catálogo puede tener más)' : ''}.{!catalog.voices.length ? ' Puede usar la voz predeterminada si está configurada.' : ''}</p>}
    {!configured && <p>Vibi no configurado. La voz manual gratuita sigue disponible.</p>}
    {draft.locale !== 'es' && <p>La voz automática de este paso admite solo narración en español.</p>}
    {dirty && <p>Guarde los cambios antes de generar voz.</p>}
    <button type="button" disabled={!configured || checking || busy || disabled} onClick={() => void balance()}>Consultar créditos Vibi</button>
    {credits !== null && <p>Créditos disponibles al consultar: {credits}. Este saldo no garantiza que alcance para generar.</p>}
    <button type="button" disabled={blocked || !draft.scenes.length || draft.scenes.some(scene => !scene.text.trim())}
      onClick={() => requestGeneration(draft.scenes.map(scene => scene.sceneId))}>Generar todas las voces</button>
    {draft.scenes.map((scene, index) => <button type="button" key={scene.sceneId} disabled={blocked || !scene.text.trim()}
      onClick={() => requestGeneration([scene.sceneId])}>{statuses[scene.sceneId] === 'desactualizada' ? `Regenerar esta escena · escena ${index + 1}` : `Generar voz · escena ${index + 1}`}</button>)}
    {pending && pending.project === draft && <section aria-label="Confirmar generación Vibi">
      <p>Voz elegida: {pending.label}.</p>
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
