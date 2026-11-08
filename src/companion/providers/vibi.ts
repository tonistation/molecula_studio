import { setTimeout as delay } from 'node:timers/promises';
import { LIMITS } from '../../shared/schema/limits.ts';
import type { VoiceCatalog } from '../../shared/voice/selection.ts';
import { publicPreviewUrl, voiceDetails } from './voice-catalog.ts';

export interface VibiOptions {
  apiKey?: string;
  voiceId?: string;
  provider?: string;
  modelId?: string;
  timeoutMs?: number;
  /** Explicit test injection only; never read VIBI_BASE_URL from the environment. */
  baseUrl?: string;
  /** Test-only shortened interval. Production polls every two seconds. */
  pollIntervalMs?: number;
}

export function voiceConfiguration(options: VibiOptions = {}) {
  const voiceId = options.voiceId ?? process.env.VIBI_VOICE_ID ?? '';
  const provider = options.provider ?? process.env.VIBI_PROVIDER ?? 'elevenlabs';
  const modelId = options.modelId ?? process.env.VIBI_MODEL_ID ?? (provider === 'elevenlabs' ? 'eleven_multilingual_v2' : provider === 'capcut' ? 'capcut' : '');
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(voiceId) || !['elevenlabs', 'minimax', 'capcut'].includes(provider)
    || !/^[a-zA-Z0-9_.-]{1,128}$/.test(modelId)) {
    throw new VibiError('vibi-config', 'Configure VIBI_VOICE_ID y un proveedor/modelo compatible. MiniMax requiere VIBI_MODEL_ID explícito.');
  }
  if (!(options.apiKey ?? process.env.VIBI_API_KEY)?.trim()) throw new VibiError('vibi-unavailable', 'Configure VIBI_API_KEY en el companion.');
  return { voiceId, provider, modelId };
}

async function withVibi<T>(options: VibiOptions, signal: AbortSignal | undefined,
  run: (request: (path: string, init?: RequestInit) => Promise<Response>, base: string, signal: AbortSignal) => Promise<T>): Promise<T> {
  const base = endpoint(options);
  const key = options.apiKey ?? process.env.VIBI_API_KEY;
  if (!key?.trim()) throw new VibiError('vibi-unavailable', 'Configure VIBI_API_KEY en el companion.');
  const timeout = options.timeoutMs ?? 120_000;
  if (!Number.isSafeInteger(timeout) || timeout < 1) throw new VibiError('vibi-config', 'El plazo debe ser positivo.');
  const deadline = AbortSignal.timeout(timeout);
  const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
  try {
    combined.throwIfAborted();
    return await run((path, init) => fetch(base + path, { ...init, headers: { ...init?.headers, 'xi-api-key': key },
      signal: combined, redirect: 'error' }), base, combined);
  } catch (error) {
    if (combined.aborted) throw new VibiError(signal?.aborted ? 'vibi-cancelled' : 'vibi-timeout', 'Se interrumpió la espera de Vibi. Una tarea enviada puede continuar consumiendo créditos; verifique Vibi antes de reintentar.');
    if (error instanceof VibiError) throw error;
    throw new VibiError('vibi-network', 'No se pudo completar la conexión con Vibi. No se reintentó; una tarea enviada puede continuar.');
  }
}

/** Explicit user action only: never queried by capabilities or startup. */
export async function vibiCredits(options: VibiOptions = {}, signal?: AbortSignal): Promise<{ credits: number }> {
  return withVibi(options, signal, async request => {
    const result = await boundedJson(await request('/v1/auth/me'));
    if (typeof result.credit_balance !== 'number' || !Number.isFinite(result.credit_balance) || result.credit_balance < 0) {
      throw new VibiError('vibi-response', 'Vibi no devolvió un saldo válido.');
    }
    return { credits: result.credit_balance };
  });
}

/** Explicit user action only. Remote sample URLs remain server-side. */
export async function vibiVoices(options: VibiOptions = {}, signal?: AbortSignal, samples?: Map<string, string>): Promise<VoiceCatalog> {
  const { provider } = voiceConfiguration({ ...options, voiceId: 'catalog-check' });
  const path = provider === 'elevenlabs' ? '/v1/default-voices?page_size=30'
    : `/v1/${provider}/system-voices?page=1&page_size=30&language=${provider === 'capcut' ? 'es' : 'Spanish'}`;
  return withVibi(options, signal, async request => {
    const result = await boundedJson(await request(path));
    const rows = provider === 'elevenlabs' ? result.voices : result.voice_list;
    if (!Array.isArray(rows) || rows.length > 30 || typeof result.has_more !== 'boolean') {
      throw new VibiError('vibi-response', 'Vibi no devolvió un catálogo válido. La voz predeterminada sigue disponible.');
    }
    const voices: VoiceCatalog['voices'] = [];
    for (const row of rows) {
      const name = provider === 'minimax' ? row?.voice_name : row?.name;
      if (!row || typeof row.voice_id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(row.voice_id)
        || typeof name !== 'string' || !name.trim() || [...name].length > 120 || /[\u0000-\u001f\u007f]/u.test(name)
        || voices.some(voice => voice.voiceId === row.voice_id)) {
        throw new VibiError('vibi-response', 'Vibi devolvió una voz no válida. No se actualizó el catálogo.');
      }
      const preview = publicPreviewUrl(provider, row.voice_id, provider === 'minimax' ? row.sample_audio : row.preview_url, endpoint(options));
      if (preview) samples?.set(`${provider}/${row.voice_id}`, preview);
      voices.push({ voiceId: row.voice_id, name, ...voiceDetails(provider, row), ...(preview ? { previewAvailable: true as const } : {}) });
    }
    return { provider, voices, hasMore: result.has_more };
  });
}

/** Retrieve an existing catalog sample only; this never submits TTS/STT. */
export async function vibiVoicePreview(provider: string, voiceId: string, url: string, options: VibiOptions = {}, signal?: AbortSignal) {
  const base = endpoint(options);
  if (!publicPreviewUrl(provider, voiceId, url, base)) throw new VibiError('vibi-preview', 'Muestra no disponible para esta voz.');
  return withVibi({ ...options, timeoutMs: options.timeoutMs ?? 15_000 }, signal, async (request, _, combined) => {
    // Only the exact Vibi CapCut route can receive the Vibi credential. CDNs never do.
    const response = new URL(url).origin === base ? await request(new URL(url).pathname)
      : await fetch(url, { signal: combined, redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer' });
    const mimeType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
    if (!response.ok || !['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/mp4'].includes(mimeType ?? '')) {
      await response.body?.cancel(); throw new VibiError('vibi-preview', 'La muestra no devolvió un audio compatible.');
    }
    const bytes = await boundedBytes(response, 5 * 1024 * 1024);
    const mp3 = bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0 || Buffer.from(bytes.subarray(0, 3)).toString() === 'ID3';
    const signature = Buffer.from(bytes.subarray(0, 12));
    const valid = mimeType === 'audio/mpeg' ? mp3 : mimeType?.includes('wav') ? signature.subarray(0, 4).toString() === 'RIFF' && signature.subarray(8, 12).toString() === 'WAVE'
      : mimeType === 'audio/ogg' ? signature.subarray(0, 4).toString() === 'OggS' : signature.subarray(4, 8).toString() === 'ftyp';
    if (!valid) throw new VibiError('vibi-preview', 'La muestra no contiene un audio compatible.');
    return { bytes, mimeType: mimeType! };
  }).catch(error => {
    if (error instanceof VibiError) throw new VibiError(error.code, error.code === 'vibi-timeout' ? 'Se agotó el plazo para descargar la muestra.' : 'No se pudo descargar una muestra de audio compatible. No se generó audio nuevo.');
    throw error;
  });
}

/** One paid TTS submit. Only the documented API origin/audio path receives credentials. */
export async function synthesizeSpeech(text: string, options: VibiOptions = {}, signal?: AbortSignal): Promise<{ bytes: Uint8Array; attribution: string }> {
  const config = voiceConfiguration(options);
  if (!text.trim() || [...text].length > LIMITS.maxSceneText) throw new VibiError('vibi-input', 'La narración está vacía o supera el límite.');
  const interval = options.pollIntervalMs ?? 2000;
  if (!Number.isSafeInteger(interval) || interval < 1) throw new VibiError('vibi-config', 'El intervalo debe ser positivo.');
  return withVibi(options, signal, async (request, base, combined) => {
    let language = 'es';
    if (config.provider === 'minimax') {
      // Verify the provider's Spanish name before submitting any paid task.
      const response = await request('/v1/languages?provider=minimax');
      if (!response.ok) { await response.body?.cancel(); throw new VibiError('vibi-http', 'No se pudieron verificar los idiomas MiniMax.'); }
      let languages: unknown;
      try { languages = JSON.parse(Buffer.from(await boundedBytes(response, LIMITS.maxJsonBytes)).toString('utf8')); }
      catch { throw new VibiError('vibi-response', 'Vibi devolvió idiomas no válidos.'); }
      if (!Array.isArray(languages) || !languages.some(item => item && typeof item === 'object' && item.code === 'Spanish' && item.name === 'Spanish')) {
        throw new VibiError('vibi-config', 'Vibi no confirmó Spanish para MiniMax. No se envió TTS.');
      }
      language = 'Spanish';
    }
    const response = await request(`/v1/text-to-speech/${config.voiceId}`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, language_code: language, provider: config.provider, model_id: config.modelId,
        voice_settings: config.provider === 'elevenlabs' ? { stability: 0.5, similarity_boost: 0.75, speed: 1 } : { speed: 1, pitch: 0 } }) });
    if (response.status !== 202) { await response.body?.cancel(); throw new VibiError('vibi-http', 'Vibi no aceptó TTS. No se reintentó automáticamente.'); }
    const accepted = await boundedJson(response);
    if (typeof accepted.id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(accepted.id)) throw new VibiError('vibi-response', 'Vibi no devolvió un ID TTS válido.');
    while (true) {
      await delay(interval, undefined, { signal: combined });
      const task = await boundedJson(await request(`/v1/history/${accepted.id}`));
      if (task.status === 'failed') throw new VibiError('vibi-failed', 'Vibi informó que TTS falló. Verifique Vibi antes de reintentar.');
      if (task.status !== 'completed') {
        if (task.status !== 'pending' && task.status !== 'processing') throw new VibiError('vibi-response', 'El estado TTS no es válido.');
        continue;
      }
      const result = task.result as Record<string, unknown> | undefined;
      let url: URL;
      try { if (typeof result?.audio_url !== 'string') throw new Error(); url = new URL(result.audio_url); }
      catch { throw new VibiError('vibi-response', 'Vibi no devolvió una URL de audio válida.'); }
      if (url.origin !== base || url.username || url.password || url.search || url.hash || !/^\/audio\/[a-zA-Z0-9_-]{1,128}\.mp3$/.test(url.pathname)) {
        throw new VibiError('vibi-audio-origin', 'La descarga no pertenece al origen y ruta de audio Vibi autorizados. No se envió la clave.');
      }
      const audio = await request(url.pathname);
      if (!audio.ok) { await audio.body?.cancel(); throw new VibiError('vibi-http', 'No se pudo descargar el audio Vibi.'); }
      const bytes = await boundedBytes(audio, LIMITS.maxAssetBytes);
      return { bytes, attribution: `${config.provider}/${config.voiceId}` };
    }
  });
}

async function boundedBytes(response: Response, limit: number): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) throw new VibiError('vibi-response', 'Vibi devolvió una respuesta vacía.');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > limit) throw new VibiError('vibi-response', 'La respuesta Vibi supera el límite permitido.');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  if (!size) throw new VibiError('vibi-response', 'Vibi devolvió una respuesta vacía.');
  return Buffer.concat(chunks);
}

export class VibiError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.name = 'VibiError'; this.code = code; }
}

function endpoint(options: VibiOptions): string {
  if (options.baseUrl === undefined) return 'https://api.vibi.pro';
  const url = new URL(options.baseUrl);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.username || url.password
    || url.pathname !== '/' || url.search || url.hash) {
    throw new VibiError('vibi-config', 'La URL de prueba debe ser HTTP local en 127.0.0.1 con puerto explícito.');
  }
  return url.origin;
}

async function boundedJson(response: Response): Promise<Record<string, unknown>> {
  if (!response.ok) {
    await response.body?.cancel();
    throw new VibiError('vibi-http', 'Vibi rechazó la solicitud. No se reintentó automáticamente.');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new VibiError('vibi-response', 'Vibi devolvió una respuesta vacía.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > LIMITS.maxJsonBytes) throw new VibiError('vibi-response', 'La respuesta de Vibi supera el límite permitido.');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch { throw new VibiError('vibi-response', 'Vibi devolvió una respuesta no válida.'); }
}

/** One paid submit, bounded polling, no retry and no raw provider diagnostics. */
export async function transcribeAudio(bytes: Uint8Array, mimeType: 'audio/wav' | 'audio/mpeg', options: VibiOptions = {}, signal?: AbortSignal): Promise<unknown[]> {
  const base = endpoint(options);
  const key = options.apiKey ?? process.env.VIBI_API_KEY;
  if (!key?.trim()) throw new VibiError('vibi-unavailable', 'Configure la clave VIBI_API_KEY en el companion para alinear.');
  const timeoutMs = options.timeoutMs ?? 120_000;
  const pollIntervalMs = options.pollIntervalMs ?? 2000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || !Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 1) {
    throw new VibiError('vibi-config', 'El plazo y el intervalo deben ser milisegundos enteros positivos.');
  }
  if (!bytes.byteLength || bytes.byteLength > LIMITS.maxAssetBytes) throw new VibiError('vibi-input', 'El audio está vacío o supera el límite permitido.');
  const deadline = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
  try {
    combined.throwIfAborted();
    const form = new FormData();
    form.set('file', new Blob([new Uint8Array(bytes).buffer], { type: mimeType }), mimeType === 'audio/wav' ? 'audio.wav' : 'audio.mp3');
    form.set('language_code', 'es');
    form.set('timestamps_granularity', 'word');
    form.set('tag_audio_events', 'false');
    // Buffer the bounded multipart before fetch: Node 26 can leave an unhandled
    // stream rejection when an in-flight FormData upload is aborted immediately.
    const encoded = new Response(form);
    const body = await encoded.arrayBuffer();
    combined.throwIfAborted();
    const request = (path: string, init?: RequestInit) => fetch(base + path, {
      ...init, headers: { ...init?.headers, 'xi-api-key': key }, signal: combined, redirect: 'error',
    });
    const submitted = await request('/v1/speech-to-text', { method: 'POST', body,
      headers: { 'content-type': encoded.headers.get('content-type')! } });
    if (submitted.status !== 202) {
      await submitted.body?.cancel();
      throw new VibiError('vibi-http', 'Vibi no aceptó la tarea de alineación. No se reintentó automáticamente.');
    }
    const accepted = await boundedJson(submitted);
    if (typeof accepted.task_id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(accepted.task_id)) {
      throw new VibiError('vibi-response', 'Vibi no devolvió un identificador de tarea válido.');
    }
    while (true) {
      await delay(pollIntervalMs, undefined, { signal: combined });
      const task = await boundedJson(await request(`/v1/speech-to-text/${accepted.task_id}`));
      if (task.status === 'failed') {
        // detail_error can contain credentials or submitted text; never propagate it.
        throw new VibiError('vibi-failed', 'Vibi informó que la alineación falló. Revise la tarea en Vibi antes de volver a enviar audio.');
      }
      if (task.status === 'completed') {
        const result = task.result;
        if (!result || typeof result !== 'object' || !('words' in result) || !Array.isArray(result.words) || result.words.length > 5000) {
          throw new VibiError('vibi-response', 'Vibi completó la tarea sin palabras válidas.');
        }
        return result.words;
      }
      if (task.status !== 'pending' && task.status !== 'processing') throw new VibiError('vibi-response', 'El estado de la tarea Vibi no es válido.');
    }
  } catch (error) {
    if (signal?.aborted) throw new VibiError('vibi-cancelled', 'Se canceló la espera de Vibi. Una tarea enviada puede seguir consumiendo créditos; no se reintentó.');
    if (deadline.aborted) throw new VibiError('vibi-timeout', 'Se agotó el plazo de Vibi. La tarea enviada puede continuar; verifique Vibi antes de reintentar.');
    if (error instanceof VibiError) throw error;
    throw new VibiError('vibi-network', 'No se pudo completar la conexión con Vibi. Una tarea enviada puede continuar; no se reintentó.');
  }
}
