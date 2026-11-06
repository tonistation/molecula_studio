import { useEffect, useRef, useState } from 'react';
import { api, describeError, type RenderStatus } from '../api.ts';
import type { Project } from '../../../src/shared/schema/types.ts';
import { voiceStatuses } from '../voice-model.ts';

export function ExportPanel({ draft, revision, dirty, disabled, missingAssets }: {
  draft: Project; revision: number; dirty: boolean; disabled: boolean; missingAssets: string[];
}) {
  const projectId = draft.projectId;
  const [voices, setVoices] = useState<{ project: Project; values: Record<string, string> } | null>(null);
  const [pending, setPending] = useState<Project | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [renderId, setRenderId] = useState<string | null>(null);
  const [state, setState] = useState<RenderStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [exportedRevision, setExportedRevision] = useState<number | null>(null);
  const starting = useRef(false);
  const active = state?.status === 'rendering';
  const checking = draft.output.voiceMode === 'withVoice' && voices?.project !== draft;
  const staleScenes = draft.output.voiceMode === 'withVoice' && voices?.project === draft
    ? draft.scenes.filter(scene => voices.values[scene.sceneId] === 'desactualizada') : [];
  const confirming = pending === draft && !dirty && !disabled;

  useEffect(() => {
    let cancelled = false;
    void voiceStatuses(draft, missingAssets).then(values => {
      if (!cancelled) setVoices({ project: draft, values });
    }).catch(() => { if (!cancelled) setError('No se pudo comprobar el estado de la voz.'); });
    return () => { cancelled = true; };
  }, [draft, missingAssets]);
  useEffect(() => { setPending(null); }, [draft, revision, dirty, disabled, missingAssets]);
  useEffect(() => {
    if (!confirming) return;
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, [confirming]);

  useEffect(() => {
    if (!renderId || !active) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await api.renderStatus(projectId, renderId);
        if (stopped) return;
        setState(next);
        setError(null);
        if (next.status !== 'rendering') return;
      } catch (caught) {
        if (stopped) return;
        setError(describeError(caught));
      }
      timer = setTimeout(() => { void poll(); }, 1000);
    };
    timer = setTimeout(() => { void poll(); }, 1000);
    // Stop polling only. Never send cancellation when this panel/tab closes.
    return () => { stopped = true; clearTimeout(timer); };
  }, [projectId, renderId, active]);

  const start = async (confirmed = false) => {
    if (active || starting.current) { setError('Ya hay una exportación en curso'); return; }
    if (dirty || disabled || checking) return;
    if (staleScenes.length && !(confirmed && pending === draft)) { setPending(draft); return; }
    setPending(null);
    starting.current = true;
    setError(null);
    setRenderId(null);
    setState({ status: 'rendering', progress: 0 });
    try {
      const result = await api.startRender(projectId, revision);
      setExportedRevision(revision);
      setRenderId(result.renderId);
    } catch (caught) {
      setState(null);
      setError(describeError(caught));
    } finally { starting.current = false; }
  };

  return <section className="panel export-panel" aria-label="Exportar video">
    <h2>Exportar video</h2>
    <p className="muted small">MP4 de la revisión guardada: {revision}, con el modo de voz y los audios guardados. Cerrar esta pestaña no cancela la exportación.</p>
    <button type="button" onClick={() => { void start(); }} disabled={dirty || disabled || checking}>
      {dirty ? 'Guarda antes de exportar' : checking ? 'Comprobando voz…' : 'Exportar MP4'}
    </button>
    <dialog className="export-confirmation" ref={dialog} aria-labelledby="stale-voice-title" aria-describedby="stale-voice-description"
      onCancel={event => { event.preventDefault(); setPending(null); }}>
      <h3 id="stale-voice-title">Exportar con voz desactualizada</h3>
      <p id="stale-voice-description">Se usarán los audios guardados, que pueden no coincidir con el texto o los tiempos actuales. Exportar no regenera la voz ni consume créditos TTS o STT.</p>
      <ul>{staleScenes.map(scene => <li key={scene.sceneId}>{draft.scenes.indexOf(scene) + 1}. {scene.title} · Voz desactualizada</li>)}</ul>
      <p>Puede cancelar y regenerar las escenas afectadas en Voz.</p>
      <div className="row">
        <button type="button" onClick={() => setPending(null)}>Cancelar exportación</button>
        <button type="button" disabled={!confirming} onClick={() => { void start(true); }}>Exportar con los audios guardados</button>
      </div>
    </dialog>
    {active && <div role="status">
      <p>Exportando… {Math.round(state.progress * 100)} %</p>
      <progress aria-label="Progreso de exportación" max={1} value={state.progress} />
    </div>}
    {state?.status === 'failed' && <p role="alert">{state.error}</p>}
    {state?.status === 'completed' && renderId && <div role="status">
      <p>Exportación completada</p>
      <p className="muted small">Revisión exportada: {exportedRevision}</p>
      <p className="export-path"><code>{state.outputPath}</code></p>
      <button type="button" disabled={downloading} onClick={() => {
        setDownloading(true);
        setError(null);
        void api.downloadRender(projectId, renderId).catch(caught => setError(describeError(caught)))
          .finally(() => setDownloading(false));
      }}>{downloading ? 'Descargando…' : 'Descargar'}</button>
    </div>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
