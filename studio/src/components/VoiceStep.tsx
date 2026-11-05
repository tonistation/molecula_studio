import { useEffect, useState } from 'react';
import type { Project } from '../../../src/shared/schema/types.ts';
import { LIMITS } from '../../../src/shared/schema/limits.ts';
import { describeError } from '../api.ts';
import { narrationScript, voiceStatuses } from '../voice-model.ts';

export function VoiceStep({ draft, dirty, disabled, missingAssets, onUpload }: {
  draft: Project; dirty: boolean; disabled: boolean; missingAssets: string[];
  onUpload: (sceneId: string, bytes: Uint8Array, mimeType: 'audio/wav' | 'audio/mpeg', license: string) => Promise<void>;
}) {
  const [license, setLicense] = useState('');
  const [fallback, setFallback] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [statuses, setStatuses] = useState<{ project: Project; values: Record<string, string> } | null>(null);
  useEffect(() => { setError(''); }, [draft.projectId, draft.revision]);
  useEffect(() => {
    let cancelled = false;
    void voiceStatuses(draft, missingAssets).then(values => {
      if (!cancelled) setStatuses({ project: draft, values });
    }).catch(() => { if (!cancelled) setStatuses(null); });
    return () => { cancelled = true; };
  }, [draft, missingAssets]);
  const copy = async () => {
    const text = narrationScript(draft);
    try { await navigator.clipboard.writeText(text); setFallback(''); setNotice('Guion de locución copiado.'); }
    catch { setFallback(text); setNotice('Seleccione y copie el guion de abajo.'); }
  };
  const upload = async (sceneId: string, file: File) => {
    if (disabled || dirty || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      if (file.size > LIMITS.maxAssetBytes) throw new Error('El archivo supera el máximo de 50 MiB.');
      const mimeType = /\.wav$/i.test(file.name) ? 'audio/wav' : /\.mp3$/i.test(file.name) ? 'audio/mpeg' : null;
      if (!mimeType) throw new Error('Seleccione un archivo WAV o MP3.');
      await onUpload(sceneId, new Uint8Array(await file.arrayBuffer()), mimeType, license);
      setNotice('Audio guardado. Los tiempos de subtítulos son estimados, no una alineación real de la voz.');
    } catch (caught) { setError(describeError(caught)); }
    finally { setBusy(false); }
  };
  return <section className="panel" aria-label="Voz manual">
    <h2>Voz manual</h2>
    <button type="button" disabled={!draft.scenes.length} onClick={() => void copy()}>Copiar guion de locución</button>
    {fallback && <label className="field"><span>Guion de locución para copiar</span>
      <textarea aria-label="Guion de locución para copiar" readOnly rows={6} value={fallback} onFocus={event => event.target.select()} />
    </label>}
    <p className="muted small">Suba un WAV o MP3 por escena. Guardar audio ajusta la duración y guarda el proyecto. Subtítulos estimados gratuitos; alineación Vibi no disponible hasta el paso 4.3.</p>
    {dirty && <p role="status">Guarde los cambios antes de subir audio.</p>}
    <label className="field"><span>Licencia o permiso de uso del audio</span>
      <input value={license} maxLength={200} disabled={disabled || busy} placeholder="Indique el permiso real; no se presupone ningún derecho" onChange={event => setLicense(event.target.value)} />
    </label>
    <ol className="scene-list">{draft.scenes.map((scene, index) => <li className="voice-scene" key={scene.sceneId}>
      <p>{index + 1}. {scene.title} · <span>{statuses?.project === draft ? statuses.values[scene.sceneId] : 'Comprobando voz…'}</span></p>
      <label className="field"><span>Subir audio · escena {index + 1}</span>
        <input type="file" accept=".wav,.mp3,audio/wav,audio/mpeg" disabled={disabled || dirty || busy || !license.trim()}
          onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void upload(scene.sceneId, file); }} />
      </label>
    </li>)}</ol>
    {busy && <p role="status">Subiendo audio…</p>}
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert">{error}</p>}
    <p className="muted small">La vista previa reproduce voz; exportar con voz sigue pendiente del paso 4.5.</p>
  </section>;
}
