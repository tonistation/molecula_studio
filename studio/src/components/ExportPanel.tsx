import { useEffect, useRef, useState } from 'react';
import { api, describeError, type RenderStatus } from '../api.ts';

export function ExportPanel({ projectId, revision, dirty, disabled }: {
  projectId: string; revision: number; dirty: boolean; disabled: boolean;
}) {
  const [renderId, setRenderId] = useState<string | null>(null);
  const [state, setState] = useState<RenderStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [exportedRevision, setExportedRevision] = useState<number | null>(null);
  const starting = useRef(false);
  const active = state?.status === 'rendering';

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

  const start = async () => {
    if (active || starting.current) { setError('Ya hay una exportación en curso'); return; }
    if (dirty || disabled) return;
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
    <p className="muted small">MP4 silencioso de la revisión guardada: {revision}. Cerrar esta pestaña no cancela la exportación.</p>
    <button type="button" onClick={() => { void start(); }} disabled={dirty || disabled}>
      {dirty ? 'Guarda antes de exportar' : 'Exportar MP4'}
    </button>
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
