import { useEffect, useRef, useState } from 'react';
import type { CatalogVoice } from '../../../src/shared/voice/selection.ts';
import { fetchVoiceSample, fetchGeneratedVoiceSample, ApiError, type AssetBlobUrl } from '../api.ts';
import { previewFailureMessage } from '../../../src/shared/voice/preview-diagnostic.ts';
import { VOICE_SAMPLE_PHRASE } from '../../../src/shared/voice/sample-phrase.ts';

/** The parent keys this component by voice identity, so changing selection stops its sample. */
export function VoiceDetails({ voice, provider, disabled }: { voice: CatalogVoice; provider: string; disabled: boolean }) {
  const audio = useRef<HTMLAudioElement>(null);
  const request = useRef<AbortController | null>(null);
  const blob = useRef<AssetBlobUrl | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'playing' | 'ready' | 'failed'>('idle');
  const [failure, setFailure] = useState(() => previewFailureMessage(null));
  const [confirmSample, setConfirmSample] = useState(false);
  const [unresolved, setUnresolved] = useState(false);
  const stop = (player = audio.current) => {
    request.current?.abort(); request.current = null;
    player?.pause();
    if (player) { player.removeAttribute('src'); player.load(); }
    blob.current?.revoke(); blob.current = null;
  };
  useEffect(() => { const player = audio.current; return () => stop(player); }, []);
  useEffect(() => { if (disabled) { stop(); setState('idle'); setConfirmSample(false); } }, [disabled]);
  const listen = async (kind: 'existing' | 'generated' | 'cached' = 'existing') => {
    if (request.current || blob.current) { stop(); setState('idle'); return; }
    const controller = new AbortController(); request.current = controller; setState('loading');
    try {
      const sample = kind === 'existing' ? await fetchVoiceSample(provider, voice.voiceId, controller.signal)
        : await fetchGeneratedVoiceSample(provider, voice.voiceId, controller.signal, kind === 'generated');
      if (controller.signal.aborted) { sample.revoke(); return; }
      blob.current = sample;
      const player = audio.current;
      if (!player) { stop(); return; }
      player.src = sample.url;
      setState('ready');
      try { await player.play(); } catch { if (!controller.signal.aborted) setState('ready'); }
    } catch (error) { if (!controller.signal.aborted) {
      const code = error instanceof ApiError ? error.code : '';
      const safeRejection = code.startsWith('vibi-') || ['voice-catalog-changed', 'voice-config-changed', 'invalid-voice', 'consent-required', 'unauthorized', 'origin-required', 'origin-not-allowed', 'host-not-allowed'].includes(code);
      const uncertain = code === 'sample-unresolved' || (kind === 'generated' && !safeRejection);
      if (uncertain) setUnresolved(true);
      stop(); setFailure(kind === 'existing' ? previewFailureMessage(error instanceof ApiError ? error.details.previewDiagnostic : null)
        : code === 'sample-not-cached' ? 'No hay una muestra generada en caché.'
        : uncertain ? 'Una solicitud anterior puede seguir en curso o su resultado no pudo verificarse. Revise Vibi; nuevas solicitudes para esta muestra están bloqueadas.'
        : kind === 'cached' ? 'No se pudo consultar la muestra guardada. Puede volver a intentarlo.'
        : 'No se inició la generación de la muestra. Verifique la configuración y vuelva a intentarlo.'); setState('failed');
    } }
  };
  const details = [['Idioma', voice.language], ['Acento', voice.accent], ['Género', voice.gender], ['Estilo', voice.style]];
  return <section className="voice-details" aria-label="Detalles de la voz">
    <h4>{voice.name}</h4>
    {!voice.language && !voice.accent && <p className="muted small">Idioma/acento no informado</p>}
    <dl>{details.filter(([, value]) => value).map(([title, value]) => <div key={title}><dt>{title}</dt><dd>{value}</dd></div>)}</dl>
    {voice.description && <p className="small">{voice.description}</p>}
    <p className="muted small">{provider} · {voice.voiceId}</p>
    <button type="button" disabled={disabled || !voice.previewAvailable} onClick={() => void listen('existing')}>
      {state === 'loading' || state === 'playing' || state === 'ready' ? 'Detener' : 'Escuchar muestra'}
    </button>
    <p className="muted small">{voice.previewAvailable ? 'Muestra existente del proveedor; no genera audio nuevo. El idioma de la muestra puede diferir de su narración.' : 'El proveedor no informó una muestra compatible para esta voz.'}</p>
    <button type="button" disabled={disabled || unresolved || state === 'loading'} onClick={() => { stop(); setState('idle'); setConfirmSample(true); }}>Generar muestra en español</button>
    <button type="button" disabled={disabled || state === 'loading'} onClick={() => void listen('cached')}>Escuchar muestra generada guardada</button>
    {confirmSample && <section aria-label="Confirmar muestra generada">
      <p>Frase exacta: «{VOICE_SAMPLE_PHRASE}» ({[...VOICE_SAMPLE_PHRASE].length} caracteres).</p>
      <p>Se enviará esta frase a TTS de Vibi. Puede consumir créditos; el costo exacto es desconocido. No se enviará a STT. Si existe una muestra guardada, se reutilizará sin generar otra.</p>
      <p>Una cancelación o error no garantiza que la tarea haya terminado. No hay reintentos automáticos.</p>
      <button type="button" disabled={disabled} onClick={() => { setConfirmSample(false); void listen('generated'); }}>Confirmar generación de muestra TTS</button>
      <button type="button" onClick={() => setConfirmSample(false)}>Cancelar muestra</button>
    </section>}
    <p role="status">{state === 'loading' ? 'Cargando muestra…' : state === 'failed' ? failure : state === 'ready' ? 'Muestra lista. Use el control de reproducción si no se inicia.' : ''}</p>
    <audio ref={audio} controls hidden={state !== 'ready' && state !== 'playing'} aria-label={`Muestra de ${voice.name}`}
      onPlaying={() => setState('playing')} onPause={() => { if (blob.current) setState('ready'); }}
      onEnded={() => { stop(); setState('idle'); }} onError={() => { if (blob.current) { stop(); setFailure(previewFailureMessage(null)); setState('failed'); } }} />
  </section>;
}
