import { useEffect, useRef, useState } from 'react';
import type { CatalogVoice } from '../../../src/shared/voice/selection.ts';
import { fetchVoiceSample, type AssetBlobUrl } from '../api.ts';

/** The parent keys this component by voice identity, so changing selection stops its sample. */
export function VoiceDetails({ voice, provider, disabled }: { voice: CatalogVoice; provider: string; disabled: boolean }) {
  const audio = useRef<HTMLAudioElement>(null);
  const request = useRef<AbortController | null>(null);
  const blob = useRef<AssetBlobUrl | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'playing' | 'ready' | 'failed'>('idle');
  const stop = (player = audio.current) => {
    request.current?.abort(); request.current = null;
    player?.pause();
    if (player) { player.removeAttribute('src'); player.load(); }
    blob.current?.revoke(); blob.current = null;
  };
  useEffect(() => { const player = audio.current; return () => stop(player); }, []);
  useEffect(() => { if (disabled) { stop(); setState('idle'); } }, [disabled]);
  const listen = async () => {
    if (request.current || blob.current) { stop(); setState('idle'); return; }
    const controller = new AbortController(); request.current = controller; setState('loading');
    try {
      const sample = await fetchVoiceSample(provider, voice.voiceId, controller.signal);
      if (controller.signal.aborted) { sample.revoke(); return; }
      blob.current = sample;
      const player = audio.current;
      if (!player) { stop(); return; }
      player.src = sample.url;
      setState('ready');
      try { await player.play(); } catch { if (!controller.signal.aborted) setState('ready'); }
    } catch { if (!controller.signal.aborted) { stop(); setState('failed'); } }
  };
  const details = [['Idioma', voice.language], ['Acento', voice.accent], ['Género', voice.gender], ['Estilo', voice.style]];
  return <section className="voice-details" aria-label="Detalles de la voz">
    <h4>{voice.name}</h4>
    {!voice.language && !voice.accent && <p className="muted small">Idioma/acento no informado</p>}
    <dl>{details.filter(([, value]) => value).map(([title, value]) => <div key={title}><dt>{title}</dt><dd>{value}</dd></div>)}</dl>
    {voice.description && <p className="small">{voice.description}</p>}
    <p className="muted small">{provider} · {voice.voiceId}</p>
    <button type="button" disabled={disabled || !voice.previewAvailable} onClick={() => void listen()}>
      {state === 'loading' || state === 'playing' || state === 'ready' ? 'Detener' : 'Escuchar muestra'}
    </button>
    <p className="muted small">{voice.previewAvailable ? 'Muestra existente del proveedor; no genera audio nuevo. El idioma de la muestra puede diferir de su narración.' : 'El proveedor no informó una muestra compatible para esta voz.'}</p>
    <p role="status">{state === 'loading' ? 'Cargando muestra…' : state === 'failed' ? 'No se pudo reproducir la muestra. Puede volver a intentarlo.' : state === 'ready' ? 'Muestra lista. Use el control de reproducción si no se inicia.' : ''}</p>
    <audio ref={audio} controls hidden={state !== 'ready' && state !== 'playing'} aria-label={`Muestra de ${voice.name}`}
      onPlaying={() => setState('playing')} onPause={() => { if (blob.current) setState('ready'); }}
      onEnded={() => { stop(); setState('idle'); }} onError={() => { if (blob.current) { stop(); setState('failed'); } }} />
  </section>;
}
