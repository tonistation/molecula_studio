import { useEffect, useState } from 'react';
import type { Project } from '../../../src/shared/schema/types.ts';
import { LIMITS } from '../../../src/shared/schema/limits.ts';
import { api, describeError } from '../api.ts';
import { narrationScript, voiceStatuses } from '../voice-model.ts';
import { AutoVoiceStep, type GenerateVoice } from './AutoVoiceStep.tsx';

export function VoiceStep({ draft, dirty, disabled, missingAssets, onUpload, onGenerate }: {
  draft: Project; dirty: boolean; disabled: boolean; missingAssets: string[];
  onUpload: (sceneId: string, bytes: Uint8Array, mimeType: 'audio/wav' | 'audio/mpeg', license: string, alignVibi?: boolean) => Promise<{ alignment: 'vibi' | 'estimated'; warnings: string[] }>;
  onGenerate: GenerateVoice;
}) {
  const [license, setLicense] = useState('');
  const [fallback, setFallback] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [autoBusy, setAutoBusy] = useState(false);
  const [vibi, setVibi] = useState(false);
  const [alignVibi, setAlignVibi] = useState(false);
  const [pending, setPending] = useState<{ project: Project; sceneId: string; bytes: Uint8Array;
    mimeType: 'audio/wav' | 'audio/mpeg'; license: string; seconds: number } | null>(null);
  const [statuses, setStatuses] = useState<{ project: Project; values: Record<string, string> } | null>(null);
  useEffect(() => { setError(''); }, [draft.projectId, draft.revision]);
  useEffect(() => {
    const controller = new AbortController();
    void api.capabilities(controller.signal).then(result => { if (!controller.signal.aborted) setVibi(result.vibi); }).catch(() => {});
    return () => controller.abort();
  }, []);
  useEffect(() => { setPending(null); }, [draft]);
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
    if (disabled || dirty || busy || autoBusy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      if (file.size > LIMITS.maxAssetBytes) throw new Error('El archivo supera el máximo de 50 MiB.');
      const mimeType = /\.wav$/i.test(file.name) ? 'audio/wav' : /\.mp3$/i.test(file.name) ? 'audio/mpeg' : null;
      if (!mimeType) throw new Error('Seleccione un archivo WAV o MP3.');
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (alignVibi) {
        const context = new AudioContext();
        try {
          const decoded = await context.decodeAudioData(new Uint8Array(bytes).buffer);
          if (!Number.isFinite(decoded.duration) || decoded.duration <= 0 || decoded.duration > 14.7) throw new Error('El audio debe durar como máximo 14,7 s.');
          setPending({ project: draft, sceneId, bytes, mimeType, license, seconds: decoded.duration });
        } finally { await context.close(); }
      } else {
        await onUpload(sceneId, bytes, mimeType, license);
        setNotice('Audio guardado. Los tiempos de subtítulos son estimados, no una alineación real de la voz.');
      }
    } catch (caught) { setError(describeError(caught)); }
    finally { setBusy(false); }
  };
  const confirmAlignment = async () => {
    if (!pending || pending.project !== draft || disabled || dirty || busy || autoBusy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await onUpload(pending.sceneId, pending.bytes, pending.mimeType, pending.license, true);
      setPending(null);
      setNotice(result.alignment === 'vibi' ? 'Audio guardado. Subtítulos alineados con Vibi.' : `Audio guardado. ${result.warnings.join(' ')}`);
    } catch (caught) { setPending(null); setError(describeError(caught)); }
    finally { setBusy(false); }
  };
  return <section className="panel" aria-label="Voz manual">
    <h2>Voz manual</h2>
    <button type="button" disabled={!draft.scenes.length} onClick={() => void copy()}>Copiar guion de locución</button>
    {fallback && <label className="field"><span>Guion de locución para copiar</span>
      <textarea aria-label="Guion de locución para copiar" readOnly rows={6} value={fallback} onFocus={event => event.target.select()} />
    </label>}
    <p className="muted small">Suba un WAV o MP3 por escena. Guardar audio ajusta la duración y guarda el proyecto. Subtítulos estimados gratuitos por defecto.</p>
    <label className="field"><span>Alineación de subtítulos</span>
      <select value={alignVibi ? 'vibi' : 'estimated'} disabled={disabled || busy || Boolean(pending)} onChange={event => setAlignVibi(event.target.value === 'vibi')}>
        <option value="estimated">Estimada · gratis</option>
        <option value="vibi" disabled={!vibi}>Vibi STT · consume créditos{!vibi ? ' (no configurado)' : ''}</option>
      </select>
    </label>
    {pending && <section aria-label="Confirmar alineación Vibi">
      <p>Duración del audio: aproximadamente {pending.seconds.toFixed(2)} s. Vibi cobra créditos por duración al enviar el audio. Tarifa exacta no disponible en el estudio; consulte su plan en Vibi antes de confirmar.</p>
      <p>Se enviará el audio a Vibi. Una cancelación o un timeout no garantizan cancelar la tarea ni el consumo. No hay reintentos automáticos.</p>
      <button type="button" disabled={disabled || dirty || busy || pending.project !== draft} onClick={() => void confirmAlignment()}>Confirmar envío y consumo de créditos</button>
      <button type="button" disabled={busy} onClick={() => setPending(null)}>Cancelar alineación</button>
    </section>}
    {dirty && <p role="status">Guarde los cambios antes de subir audio.</p>}
    <label className="field"><span>Licencia o permiso de uso del audio</span>
      <input value={license} maxLength={200} disabled={disabled || busy} placeholder="Indique el permiso real; no se presupone ningún derecho" onChange={event => setLicense(event.target.value)} />
    </label>
    <ol className="scene-list">{draft.scenes.map((scene, index) => <li className="voice-scene" key={scene.sceneId}>
      <p>{index + 1}. {scene.title} · <span>{statuses?.project === draft ? statuses.values[scene.sceneId] === 'desactualizada' ? 'Voz desactualizada' : statuses.values[scene.sceneId] : 'Comprobando voz…'}</span></p>
      <label className="field"><span>Subir audio · escena {index + 1}</span>
        <input type="file" accept=".wav,.mp3,audio/wav,audio/mpeg" disabled={disabled || dirty || busy || autoBusy || Boolean(pending) || !license.trim()}
          onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void upload(scene.sceneId, file); }} />
      </label>
    </li>)}</ol>
    {busy && <p role="status">Subiendo audio…</p>}
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert">{error}</p>}
    <AutoVoiceStep draft={draft} dirty={dirty} disabled={disabled || busy || Boolean(pending)} configured={vibi} onGenerate={onGenerate} onBusy={setAutoBusy}
      statuses={statuses?.project === draft ? statuses.values : {}} />
    <p className="muted small">La vista previa reproduce la voz guardada. Si está desactualizada, puede regenerarla con Vibi o subir un audio nuevo con permiso de uso. Exportar no regenera audio.</p>
  </section>;
}
