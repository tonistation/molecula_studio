import { setTimeout as delay } from 'node:timers/promises';
import { LIMITS } from '../../shared/schema/limits.ts';

export interface VibiOptions {
  apiKey?: string;
  timeoutMs?: number;
  /** Explicit test injection only; never read VIBI_BASE_URL from the environment. */
  baseUrl?: string;
  /** Test-only shortened interval. Production polls every two seconds. */
  pollIntervalMs?: number;
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
