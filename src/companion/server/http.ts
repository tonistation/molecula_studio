import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createRenderJobs, RenderRequestError } from '../render/render-jobs.ts';
import type { renderProject } from '../render/render-service.ts';
import { capabilities } from '../providers/capabilities.ts';
import { generateScript, generateDrawing, GenerationError, type CodexOptions } from '../providers/codex-cli.ts';
import { estimateWords } from '../../shared/voice/estimate.ts';
import { alignmentKind, sttWordsToWords } from '../../shared/voice/alignment.ts';
import type { AlignmentDiagnostic } from '../../shared/voice/alignment.ts';
import { transcribeAudio, synthesizeSpeech, voiceConfiguration, vibiCredits, vibiVoices, vibiVoicePreview, VibiError, type VibiOptions } from '../providers/vibi.ts';
import type { PreviewDiagnostic } from '../../shared/voice/preview-diagnostic.ts';
import { inspectMediaBounded } from '../store/inspection-runner.ts';
import { InspectionError } from '../store/media-inspect.ts';

import { LIMITS } from '../../shared/schema/limits.ts';
import { ProjectStore, type WorkspaceOptions } from '../store/project-store.ts';
import {
  AssetNotFoundError,
  AssetRejectedError,
  ConflictError,
  InvalidProjectError,
  ProjectExistsError,
  StoreError,
  UnsafePathError,
} from '../store/errors.ts';

/**
 * Loopback companion boundary (architecture.md, "Seguridad local").
 *
 * - Binds loopback only and rejects any other `Host` header (DNS rebinding).
 * - Requires an ephemeral bearer token on every `/api` request. The token is
 *   never persisted, never placed in URLs and never logged.
 * - Rejects foreign `Origin` values; state-changing methods require an
 *   explicit allowed `Origin` (CSRF protection). No CORS headers are emitted.
 * - Endpoints take opaque project handles, never filesystem paths.
 */
export interface CompanionServerOptions {
  /** Authorized workspace directory (the only tree the API can touch). */
  workspaceRoot: string;
  /** 0 (default) picks an ephemeral port; useful for tests. */
  port?: number;
  /** Loopback host; only 127.0.0.1 is accepted. */
  host?: '127.0.0.1';
  /** Explicit token for tests; otherwise generated per start. */
  token?: string;
  /** Built studio directory served at `/`; missing directory reports 503. */
  studioDir?: string;
  /** Extra origins explicitly authorized (Vite dev), exact match only. */
  extraOrigins?: string[];
  /** Reclaim a stale workspace lock (dead owner) on start. */
  forceUnlock?: boolean;
  /** Reuse an initialized store (tests). */
  store?: ProjectStore;
  /** Injectable clock passed to the store when created here. */
  now?: () => Date;
  /** Test-only renderer injection; production shares the cached singleton. */
  renderer?: typeof renderProject;
  /** Test-only fake executable environment/deadlines. */
  codexOptions?: CodexOptions;
  /** Test-only local Vibi transport/configuration. No production URL env override. */
  vibiOptions?: VibiOptions;
}

export interface CompanionServer {
  readonly server: Server;
  readonly store: ProjectStore;
  readonly token: string;
  readonly origin: string;
  readonly port: number;
  close(): Promise<void>;
}

const BODY_LIMIT = LIMITS.maxJsonBytes + 64 * 1024;
const ASSET_LIMIT = LIMITS.maxAssetBytes;
// JSON-string escaping can expand an imported source byte up to sixfold.
const IMPORT_BODY_LIMIT = LIMITS.maxJsonBytes * 6 + 1024;
const TOKEN_HEADER = 'x-companion-token';

// This local single-user process admits one drawing across all projects and clients.
let drawingBusy = false;

const ASSET_CONTENT_TYPES = new Set(['audio/wav', 'audio/mpeg', 'image/png', 'image/jpeg']);

export async function startCompanionServer(options: CompanionServerOptions): Promise<CompanionServer> {
  const host = options.host ?? '127.0.0.1';
  if (host !== '127.0.0.1') {
    throw new Error('companion must bind loopback (127.0.0.1)');
  }
  if (typeof options.workspaceRoot !== 'string' || options.workspaceRoot.length === 0) {
    throw new Error('workspaceRoot must be a non-empty string');
  }

  const store = options.store ?? new ProjectStore({
    workspaceRoot: options.workspaceRoot,
    now: options.now,
  } satisfies WorkspaceOptions);
  if (options.store === undefined) {
    await store.init({ forceUnlock: options.forceUnlock === true });
  }

  const token = options.token ?? randomBytes(32).toString('hex');
  const state = { port: 0, origin: '' };
  const renders = createRenderJobs(store, await realpath(options.workspaceRoot), options.renderer);
  const generation = { options: options.codexOptions ?? {}, active: new Set<AbortController>(), closing: false, voiceBusy: false, voices: new Set<string>(), samples: new Map<string, string>() };
  const env = options.codexOptions?.env ?? process.env;
  const vibi = { apiKey: env.VIBI_API_KEY ?? '', voiceId: env.VIBI_VOICE_ID ?? '', provider: env.VIBI_PROVIDER ?? 'elevenlabs',
    modelId: env.VIBI_MODEL_ID ?? (env.VIBI_PROVIDER === 'minimax' ? '' : env.VIBI_PROVIDER === 'capcut' ? 'capcut' : 'eleven_multilingual_v2'), ...options.vibiOptions };

  const server = createServer((req, res) => {
    void handleRequest(req, res, { store, token, state, renders, generation, vibi, studioDir: options.studioDir, extraOrigins: options.extraOrigins });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, host, () => resolve());
  });

  const address = server.address();
  if (address === null || typeof address === 'string') {
    server.close();
    throw new Error('companion failed to bind a loopback port');
  }
  state.port = address.port;
  state.origin = `http://${host}:${address.port}`;

  return {
    server,
    store,
    token,
    origin: state.origin,
    port: state.port,
    async close() {
      generation.closing = true;
      for (const controller of generation.active) controller.abort();
      await renders.settle();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await store.close();
    },
  };
}

//#region request handling

interface HandlerContext {
  store: ProjectStore;
  token: string;
  state: { port: number; origin: string };
  studioDir: string | undefined;
  extraOrigins: string[] | undefined;
  renders: ReturnType<typeof createRenderJobs>;
  generation: { options: CodexOptions; active: Set<AbortController>; closing: boolean; voiceBusy: boolean; voices: Set<string>; samples: Map<string, string> };
  vibi: VibiOptions;
}

async function handleRequest(req: IncomingMessage, res: ServerResponse, context: HandlerContext): Promise<void> {
  try {
    assertHost(req, context);
    const url = new URL(req.url ?? '/', context.state.origin);
    const pathname = url.pathname;

    if (pathname.startsWith('/render-assets/')) {
      // Remotion runs on its own random loopback origin and sends no bearer header.
      // Keep Host protection; this GET-only capability replaces API Origin/token auth.
      if (req.method !== 'GET') throw methodNotAllowed('GET');
      const match = /^\/render-assets\/([a-f0-9]{64})\/([a-z][a-z0-9_-]{0,63})$/.exec(pathname);
      if (!match) throw new HttpError(404, 'not-found', 'Recurso no encontrado.');
      const { asset, bytes } = await context.renders.asset(match[1]!, match[2]!);
      res.setHeader('access-control-allow-origin', '*');
      res.setHeader('content-type', asset.mimeType);
      res.setHeader('content-length', String(bytes.byteLength));
      res.setHeader('cache-control', 'no-store');
      res.setHeader('x-content-type-options', 'nosniff');
      res.end(bytes);
      return;
    }

    if (pathname.startsWith('/api/')) {
      assertOrigin(req, context);
      assertToken(req, context.token);
      await handleApi(req, res, pathname, context);
      return;
    }

    assertOrigin(req, context);
    await handleStatic(req, res, pathname, context);
  } catch (error) {
    const mapped = mapError(error);
    if (!res.headersSent) {
      if (error instanceof HttpError && error.allow !== undefined) {
        res.setHeader('allow', error.allow);
      }
      sendJson(res, mapped.status, mapped.body);
    } else {
      res.end();
    }
  }
}

function assertHost(req: IncomingMessage, context: HandlerContext): void {
  const hostHeader = req.headers.host;
  const allowed = new Set([`127.0.0.1:${context.state.port}`, `localhost:${context.state.port}`]);
  if (typeof hostHeader !== 'string' || !allowed.has(hostHeader)) {
    throw new HttpError(403, 'host-not-allowed', 'request Host is not the companion origin');
  }
}

function assertOrigin(req: IncomingMessage, context: HandlerContext): void {
  const allowed = new Set([
    `http://127.0.0.1:${context.state.port}`,
    `http://localhost:${context.state.port}`,
    ...(context.extraOrigins ?? []),
  ]);
  const origin = req.headers.origin;
  if (origin === undefined) {
    // Same-origin navigations and non-browser clients may omit Origin; any
    // state-changing request without one is rejected as a CSRF risk.
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      throw new HttpError(403, 'origin-required', 'state-changing requests require an allowed Origin');
    }
    return;
  }
  if (!allowed.has(origin)) {
    throw new HttpError(403, 'origin-not-allowed', 'request Origin is not authorized');
  }
}

function assertToken(req: IncomingMessage, token: string): void {
  const authorization = req.headers.authorization;
  const bearer = typeof authorization === 'string' && authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined;
  const headerToken = req.headers[TOKEN_HEADER];
  const provided = bearer ?? (typeof headerToken === 'string' ? headerToken : undefined);
  if (provided === undefined || !tokensMatch(provided, token)) {
    throw new HttpError(401, 'unauthorized', 'missing or invalid companion token');
  }
}

function tokensMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

//#endregion request handling

//#region api

const PROJECT_ROUTE = /^\/api\/projects\/([a-z][a-z0-9_-]{0,63})(?:\/(copy|assets)(?:\/([a-z][a-z0-9_-]{0,63}))?)?$/;

async function handleApi(req: IncomingMessage, res: ServerResponse, pathname: string, context: HandlerContext): Promise<void> {
  const { store } = context;
  const method = req.method ?? 'GET';

  const voiceRoute = /^\/api\/projects\/([a-z][a-z0-9_-]{0,63})\/scenes\/([a-z][a-z0-9_-]{0,63})\/voice$/.exec(pathname);
  const previewRoute = /^\/api\/vibi\/voices\/(elevenlabs|minimax|capcut)\/([a-zA-Z0-9_-]{1,128})\/preview$/.exec(pathname);
  if (voiceRoute || previewRoute || pathname === '/api/vibi/credits' || pathname === '/api/vibi/voices') {
    const credits = !voiceRoute;
    if (method !== (credits ? 'GET' : 'POST')) throw methodNotAllowed(credits ? 'GET' : 'POST');
    if (context.generation.closing) throw new HttpError(503, 'companion-closing', 'El companion se está cerrando.');
    if (!credits && context.generation.voiceBusy) throw new HttpError(409, 'voice-busy', 'Ya hay una generación de voz en curso.');
    const controller = new AbortController();
    const cancel = () => controller.abort();
    context.generation.active.add(controller); res.once('close', cancel);
    if (!credits) context.generation.voiceBusy = true;
    try {
      if (previewRoute) {
        const provider = previewRoute[1]!; const voiceId = previewRoute[2]!;
        const url = context.generation.samples.get(`${provider}/${voiceId}`);
        if (provider !== context.vibi.provider || !url) throw new HttpError(404, 'voice-preview-unavailable', 'Muestra no disponible para esta voz.');
        const sample = await vibiVoicePreview(provider, voiceId, url, context.vibi, controller.signal);
        controller.signal.throwIfAborted();
        res.setHeader('content-type', sample.mimeType); res.setHeader('content-length', sample.bytes.byteLength);
        res.setHeader('cache-control', 'no-store'); res.setHeader('x-content-type-options', 'nosniff');
        res.writeHead(200); res.end(sample.bytes); return;
      }
      if (pathname === '/api/vibi/voices') {
        const samples = new Map<string, string>();
        const catalog = await vibiVoices(context.vibi, controller.signal, samples);
        controller.signal.throwIfAborted();
        context.generation.voices.clear();
        for (const voice of catalog.voices) context.generation.voices.add(`${catalog.provider}/${voice.voiceId}`);
        context.generation.samples = samples;
        sendJson(res, 200, catalog); return;
      }
      if (credits) { sendJson(res, 200, await vibiCredits(context.vibi, controller.signal)); return; }
      const body = await readJsonBody(req) as Record<string, unknown>;
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['expectedRevision', 'expectedDigest', 'consent', 'provider', 'voiceId'].includes(key))
        || !Number.isSafeInteger(body.expectedRevision) || Number(body.expectedRevision) < 0
        || typeof body.expectedDigest !== 'string' || !/^[a-f0-9]{64}$/.test(body.expectedDigest)) {
        throw new HttpError(400, 'invalid-argument', 'Se requieren revisión y digest válidos del proyecto guardado.');
      }
      if (body.consent !== true) throw new HttpError(400, 'consent-required', 'Confirme el envío de texto/audio y el consumo TTS y STT.');
      const selected = 'voiceId' in body || 'provider' in body;
      if (selected && (typeof body.voiceId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(body.voiceId)
        || body.provider !== context.vibi.provider || !context.generation.voices.has(`${body.provider}/${body.voiceId}`))) {
        throw new HttpError(400, 'invalid-voice', 'Seleccione una voz del catálogo del proveedor configurado antes de confirmar.');
      }
      const voiceOptions = selected ? { ...context.vibi, voiceId: body.voiceId as string } : context.vibi;
      voiceConfiguration(voiceOptions);
      const projectId = voiceRoute![1]!; const sceneId = voiceRoute![2]!;
      const current = await store.readProject(projectId);
      if (current.revision !== body.expectedRevision || current.digest !== body.expectedDigest) {
        throw new ConflictError({ projectId, reason: 'digest', expectedDigest: body.expectedDigest, actualDigest: current.digest });
      }
      const checkCurrent = async () => {
        const opened = await store.readProject(projectId);
        if (opened.revision !== body.expectedRevision || opened.digest !== body.expectedDigest) {
          throw new ConflictError({ projectId, reason: 'digest', expectedDigest: body.expectedDigest as string, actualDigest: opened.digest });
        }
      };
      await checkCurrent();
      if (current.mode === 'read-only') throw new HttpError(422, 'read-only-project', 'El proyecto es de solo lectura.');
      if (current.project.locale !== 'es') throw new HttpError(422, 'voice-locale', 'La voz automática de este paso admite solo narración en español.');
      const scene = current.project.scenes.find(item => item.sceneId === sceneId);
      if (!scene) throw new HttpError(404, 'scene-not-found', 'La escena ya no existe.');
      if (!scene.text.trim()) throw new HttpError(422, 'empty-narration', 'La escena no tiene narración.');
      estimateWords(scene.text, scene.durationMs);
      const generated = await synthesizeSpeech(scene.text, voiceOptions, controller.signal);
      controller.signal.throwIfAborted();
      const inspection = await inspectMediaBounded(generated.bytes, 'audio/mpeg');
      const audioMs = inspection.durationMs;
      if (audioMs === null || audioMs + 300 > LIMITS.maxSceneMs) throw new AssetRejectedError('audio-too-long', 'El audio generado supera el límite de escena o no tiene duración válida. No se envió STT.');
      const duration = Math.max(1000, Math.ceil((audioMs + 300) / 100) * 100);
      if (current.project.output.durationMs - scene.durationMs + duration > LIMITS.maxDurationMs) throw new AssetRejectedError('audio-too-long', 'El audio generado supera los 60 s del proyecto. No se envió STT.');
      estimateWords(scene.text, audioMs);
      await checkCurrent();
      controller.signal.throwIfAborted();
      const stt = await transcribeAudio(generated.bytes, 'audio/mpeg', context.vibi, controller.signal);
      const warnings: string[] = [];
      let alignmentDiagnostic: AlignmentDiagnostic | undefined;
      const words = sttWordsToWords(stt, scene.text, audioMs, warning => warnings.push(warning), diagnostic => { alignmentDiagnostic = diagnostic; });
      controller.signal.throwIfAborted();
      if (res.destroyed) return;
      const result = await store.attachSceneAudio({ projectId, sceneId, bytes: generated.bytes, mimeType: 'audio/mpeg',
        expectedRevision: body.expectedRevision as number, expectedDigest: body.expectedDigest,
        source: { origin: 'provider', license: 'Vibi – según plan', attribution: generated.attribution }, words });
      const opened = await store.readProject(projectId);
      if (opened.digest !== result.digest) throw new ConflictError({ projectId, reason: 'digest', expectedDigest: result.digest, actualDigest: opened.digest });
      sendJson(res, 200, { ...result, opened, alignment: warnings.length ? 'estimated' : 'vibi', alignmentKind: alignmentKind(alignmentDiagnostic), warnings,
        ...(alignmentDiagnostic ? { alignmentDiagnostic } : {}) });
    } catch (error) {
      if (error instanceof VibiError) throw new HttpError(error.code === 'vibi-timeout' ? 504 : error.code === 'vibi-config' || error.code === 'vibi-unavailable' ? 503 : 502, error.code, error.message,
        undefined, previewRoute ? error.previewDiagnostic : undefined);
      if (controller.signal.aborted) throw new HttpError(502, 'vibi-cancelled', 'Se canceló la espera. Las tareas Vibi enviadas pueden continuar consumiendo créditos.');
      if (error instanceof InspectionError) throw new HttpError(502, 'vibi-audio-invalid', 'Vibi devolvió un MP3 no válido. No se envió STT ni se guardó.');
      if (error instanceof RangeError) throw new HttpError(422, 'invalid-alignment', 'La narración no admite tiempos de subtítulos válidos para esta duración.');
      throw error;
    } finally {
      res.removeListener('close', cancel); context.generation.active.delete(controller);
      if (!credits) context.generation.voiceBusy = false;
    }
    return;
  }

  const audioRoute = /^\/api\/projects\/([a-z][a-z0-9_-]{0,63})\/scenes\/([a-z][a-z0-9_-]{0,63})\/audio$/.exec(pathname);
  if (audioRoute) {
    if (method !== 'PUT') throw methodNotAllowed('PUT');
    const align = new URL(req.url!, context.state.origin).searchParams.get('align');
    if (align !== null && align !== 'vibi') throw new HttpError(400, 'invalid-argument', 'Alineación no compatible. Omita align para usar tiempos estimados gratuitos.');
    if (align === 'vibi' && req.headers['x-vibi-consent'] !== '1') throw new HttpError(400, 'consent-required', 'Confirme el envío del audio y el consumo de créditos Vibi antes de alinear.');
    if (align === 'vibi' && !context.vibi.apiKey?.trim()) throw new HttpError(503, 'alignment-unavailable', 'Vibi no está configurado. Use subtítulos estimados gratuitos.');
    const mimeType = req.headers['content-type'];
    if (mimeType !== 'audio/wav' && mimeType !== 'audio/mpeg') throw new HttpError(415, 'unsupported-media-type', 'Suba un archivo WAV o MP3.');
    const revision = req.headers['x-expected-revision'];
    const digest = req.headers['x-expected-digest'];
    const licenseHeader = req.headers['x-asset-license'];
    if (typeof revision !== 'string' || !/^\d+$/.test(revision) || !Number.isSafeInteger(Number(revision))
      || typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest)) {
      throw new HttpError(400, 'invalid-argument', 'Se requieren revisión y digest válidos del proyecto guardado.');
    }
    let license: string;
    try { license = typeof licenseHeader === 'string' ? decodeURIComponent(licenseHeader) : ''; }
    catch { throw new HttpError(400, 'invalid-argument', 'La licencia debe ser texto UTF-8 codificado con encodeURIComponent.'); }
    if (!license.trim() || [...license].length > 200 || /[\x00-\x1f\x7f]/u.test(license)) {
      throw new HttpError(400, 'invalid-argument', 'Indique la licencia o el permiso real de uso (1–200 caracteres).');
    }
    const projectId = audioRoute[1]!;
    const sceneId = audioRoute[2]!;
    const controller = new AbortController();
    const cancel = () => controller.abort();
    if (align === 'vibi') {
      if (context.generation.closing) throw new HttpError(503, 'companion-closing', 'El companion se está cerrando.');
      context.generation.active.add(controller);
      res.once('close', cancel);
      if (res.destroyed || req.aborted) cancel();
    }
    try {
      controller.signal.throwIfAborted();
      const current = await store.readProject(projectId);
      if (current.revision !== Number(revision) || current.digest !== digest) throw new ConflictError({ projectId, reason: 'digest', expectedDigest: digest, actualDigest: current.digest });
      const scene = current.project.scenes.find(item => item.sceneId === sceneId);
      if (!scene) throw new HttpError(404, 'scene-not-found', 'La escena ya no existe.');
      if (current.mode === 'read-only') throw new HttpError(422, 'read-only-project', 'El proyecto es de solo lectura. No se envió audio a Vibi.');
      const bytes = await readRawBody(req, ASSET_LIMIT);
      let audioMs: number;
      try {
        const inspection = await inspectMediaBounded(bytes, mimeType);
        if (inspection.durationMs === null) throw new AssetRejectedError('unreadable', 'No se pudo determinar la duración del audio.');
        audioMs = inspection.durationMs;
      } catch (error) {
        if (error instanceof InspectionError) throw new AssetRejectedError(error.reason, error.message);
        throw error;
      }
      if (audioMs + 300 > LIMITS.maxSceneMs) throw new AssetRejectedError('audio-too-long', 'El audio más 300 ms de margen supera los 15 s por escena.');
      const nextDuration = Math.max(1000, Math.ceil((audioMs + 300) / 100) * 100);
      if (current.project.output.durationMs - scene.durationMs + nextDuration > LIMITS.maxDurationMs) {
        throw new AssetRejectedError('audio-too-long', 'El audio haría que el proyecto supere los 60 s. No se envió a Vibi.');
      }
      let words;
      try { words = estimateWords(scene.text, audioMs); }
      catch (error) { throw new HttpError(422, 'invalid-alignment', error instanceof RangeError ? error.message : 'No se pudieron estimar los tiempos.'); }
      const warnings: string[] = [];
      let alignmentDiagnostic: AlignmentDiagnostic | undefined;
      if (align === 'vibi') {
        const latest = await store.readProject(projectId);
        if (latest.revision !== Number(revision) || latest.digest !== digest) {
          throw new ConflictError({ projectId, reason: 'digest', expectedDigest: digest, actualDigest: latest.digest });
        }
        controller.signal.throwIfAborted();
        try {
          const stt = await transcribeAudio(bytes, mimeType, context.vibi, controller.signal);
          controller.signal.throwIfAborted();
          words = sttWordsToWords(stt, scene.text, audioMs, warning => warnings.push(warning), diagnostic => { alignmentDiagnostic = diagnostic; });
        } catch (error) {
          if (error instanceof VibiError) throw new HttpError(error.code === 'vibi-timeout' ? 504 : 502, error.code, error.message);
          throw new HttpError(502, 'vibi-cancelled', 'Se canceló la alineación. La tarea enviada puede continuar en Vibi.');
        }
      }
      if (res.destroyed) return;
      const result = await store.attachSceneAudio({ projectId, sceneId, bytes, mimeType,
        expectedRevision: Number(revision), expectedDigest: digest,
        source: { origin: 'user', license, attribution: '' }, words });
      // Re-reading returns the canonical disk digest, not a recomputed content digest.
      const opened = await store.readProject(projectId);
      if (opened.digest !== result.digest) throw new ConflictError({ projectId, reason: 'digest', expectedDigest: result.digest, actualDigest: opened.digest });
      sendJson(res, 200, { ...result, opened, alignment: align === 'vibi' && !warnings.length ? 'vibi' : 'estimated',
        alignmentKind: align === 'vibi' ? alignmentKind(alignmentDiagnostic) : 'estimated', warnings,
        ...(alignmentDiagnostic ? { alignmentDiagnostic } : {}) });
      return;
    } finally {
      res.removeListener('close', cancel);
      context.generation.active.delete(controller);
    }
  }

  if (['/api/capabilities', '/api/script/generate', '/api/drawing/generate'].includes(pathname)) {
    const capability = pathname === '/api/capabilities';
    if (method !== (capability ? 'GET' : 'POST')) throw methodNotAllowed(capability ? 'GET' : 'POST');
    const body = capability ? undefined : await readJsonBody(req);
    if (context.generation.closing) throw new HttpError(503, 'companion-closing', 'El companion se está cerrando.');
    const drawing = pathname === '/api/drawing/generate';
    if (drawing && drawingBusy) throw new HttpError(409, 'drawing-in-progress',
      'Ya hay un dibujo en curso o terminando su cancelación. Vuelve a intentar en un momento.');
    if (drawing) drawingBusy = true;
    const controller = new AbortController();
    context.generation.active.add(controller);
    const cancel = () => controller.abort();
    res.once('close', cancel);
    if (res.destroyed) cancel();
    try {
      let vibiVoiceConfigured = false;
      if (capability) { try { voiceConfiguration(context.vibi); vibiVoiceConfigured = true; } catch { /* Local configuration only; no network. */ } }
      const result = capability ? { ...await capabilities(context.generation.options, controller.signal), vibi: Boolean(context.vibi.apiKey?.trim()), vibiVoiceConfigured }
        : await (pathname === '/api/script/generate' ? generateScript : generateDrawing)(body, context.generation.options, controller.signal);
      sendJson(res, 200, result);
    } catch (error) {
      if (error instanceof GenerationError) {
        // The bearer token is never part of a returned diagnostic, even in fake output.
        sendJson(res, error.status, { error: { code: error.code, message: error.message,
          ...(error.diagnostics === undefined ? {} : { diagnostics: error.diagnostics }),
          ...(error.responseText === undefined ? {} : { responseText: error.responseText.split(context.token).join('[oculto]') }) } });
      } else throw error;
    } finally {
      res.removeListener('close', cancel);
      context.generation.active.delete(controller);
      if (drawing) drawingBusy = false;
    }
    return;
  }

  const renderRoute = /^\/api\/projects\/([a-z][a-z0-9_-]{0,63})\/renders(?:\/(r-[a-f0-9-]{36})(\/file)?)?$/.exec(pathname);
  if (renderRoute) {
    const projectId = renderRoute[1]!;
    const renderId = renderRoute[2];
    if (!renderId) {
      if (method !== 'POST') throw methodNotAllowed('POST');
      const body = requireObject(await readJsonBody(req));
      if (typeof body.expectedRevision !== 'number' || !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0) {
        throw new HttpError(400, 'invalid-argument', 'expectedRevision must be a non-negative safe integer');
      }
      sendJson(res, 202, await context.renders.start(projectId, body.expectedRevision, context.state.origin));
    } else {
      if (method !== 'GET') throw methodNotAllowed('GET');
      if (renderRoute[3]) {
        const { handle, size, filename } = await context.renders.file(projectId, renderId);
        res.setHeader('content-type', 'video/mp4');
        res.setHeader('content-length', String(size));
        res.setHeader('content-disposition', `attachment; filename="${filename}"`);
        res.setHeader('cache-control', 'no-store');
        res.setHeader('x-content-type-options', 'nosniff');
        await pipeline(handle.createReadStream(), res);
      } else sendJson(res, 200, context.renders.get(projectId, renderId));
    }
    return;
  }

  if (pathname === '/api/health') {
    if (method !== 'GET') throw methodNotAllowed('GET');
    sendJson(res, 200, { ok: true, name: 'molecula-companion', workspace: 'authorized' });
    return;
  }

  if (pathname === '/api/imports') {
    if (method !== 'POST') throw methodNotAllowed('POST');
    const body = requireObject(await readJsonBody(req, IMPORT_BODY_LIMIT));
    const text = body.text;
    if (typeof text !== 'string') {
      throw new HttpError(400, 'invalid-argument', 'text must be a string containing the project JSON');
    }
    const collision = body.collision;
    if (collision !== undefined && collision !== 'reject' && collision !== 'copy') {
      throw new HttpError(400, 'invalid-argument', "collision must be 'reject' or 'copy'");
    }
    const imported = await store.importProject({ text, collision: collision ?? 'reject' });
    sendJson(res, 201, imported);
    return;
  }

  if (pathname === '/api/projects') {
    if (method === 'GET') {
      const projects = await store.listProjects();
      sendJson(res, 200, { projects });
      return;
    }
    if (method === 'POST') {
      const body = await readJsonBody(req);
      const record = requireObject(body);
      const title = record.title;
      if (title !== undefined && typeof title !== 'string') {
        throw new HttpError(400, 'invalid-argument', 'title must be a string');
      }
      const created = await store.createProject(title === undefined ? {} : { title });
      sendJson(res, 201, created);
      return;
    }
    throw methodNotAllowed('GET, POST');
  }

  const match = PROJECT_ROUTE.exec(pathname);
  if (match === null) {
    throw new HttpError(404, 'not-found', 'unknown endpoint');
  }
  const projectId = match[1] as string;
  const suffix = match[2];
  const assetId = match[3];

  if (suffix === 'copy') {
    if (assetId !== undefined) throw new HttpError(404, 'not-found', 'unknown endpoint');
    if (method !== 'POST') throw methodNotAllowed('POST');
    const body = await readJsonBody(req, IMPORT_BODY_LIMIT);
    const record = body === undefined ? {} : requireObject(body);
    const newProjectId = record.newProjectId;
    if (newProjectId !== undefined && typeof newProjectId !== 'string') {
      throw new HttpError(400, 'invalid-argument', 'newProjectId must be a string');
    }
    const text = record.text;
    if (text !== undefined && typeof text !== 'string') throw new HttpError(400, 'invalid-argument', 'text must be a project JSON string');
    const operationId = record.operationId;
    if (operationId !== undefined && typeof operationId !== 'string') throw new HttpError(400, 'invalid-argument', 'operationId must be a string');
    const copied = await store.saveCopy({ projectId, newProjectId, text, operationId });
    sendJson(res, 201, copied);
    return;
  }

  if (suffix === 'assets') {
    if (assetId === undefined) throw new HttpError(404, 'not-found', 'unknown endpoint');
    if (method === 'GET') {
      const { asset, bytes } = await store.readAsset(projectId, assetId);
      res.statusCode = 200;
      res.setHeader('content-type', asset.mimeType);
      res.setHeader('content-length', String(bytes.byteLength));
      res.setHeader('cache-control', 'no-store');
      res.setHeader('x-content-type-options', 'nosniff');
      res.end(bytes);
      return;
    }
    if (method !== 'PUT') throw methodNotAllowed('GET, PUT');
    const contentType = req.headers['content-type'];
    if (typeof contentType !== 'string' || !ASSET_CONTENT_TYPES.has(contentType.toLowerCase())) {
      throw new HttpError(415, 'unsupported-media-type', 'Content-Type must be audio/wav, audio/mpeg, image/png or image/jpeg');
    }
    const mimeType = contentType.toLowerCase() as 'audio/wav' | 'audio/mpeg' | 'image/png' | 'image/jpeg';
    const bytes = await readRawBody(req, ASSET_LIMIT);
    const confirmReplace = req.headers['x-confirm-replace'] === '1';
    const revisionHeader = req.headers['x-expected-revision'];
    if (revisionHeader !== undefined && (typeof revisionHeader !== 'string' || !/^\d+$/.test(revisionHeader) || !Number.isSafeInteger(Number(revisionHeader)))) {
      throw new HttpError(400, 'invalid-argument', 'x-expected-revision must be a non-negative safe integer');
    }
    const expectedRevision = revisionHeader === undefined ? undefined : Number(revisionHeader);
    const expectedDigest = req.headers['x-expected-digest'];
    if (expectedDigest !== undefined && (typeof expectedDigest !== 'string' || !/^[a-f0-9]{64}$/.test(expectedDigest))) {
      throw new HttpError(400, 'invalid-argument', 'x-expected-digest must be a lowercase SHA-256 digest');
    }
    const relinked = await store.relinkAsset({ projectId, assetId, bytes, mimeType, confirmReplace, expectedRevision, expectedDigest });
    sendJson(res, 200, relinked);
    return;
  }

  if (method === 'GET') {
    const read = await store.readProject(projectId);
    sendJson(res, 200, read);
    return;
  }

  if (method === 'PUT') {
    const body = requireObject(await readJsonBody(req));
    const expectedRevision = body.expectedRevision;
    const operationId = body.operationId;
    const expectedDigest = body.expectedDigest;
    if (expectedDigest !== undefined && (typeof expectedDigest !== 'string' || !/^[a-f0-9]{64}$/.test(expectedDigest))) {
      throw new HttpError(400, 'invalid-argument', 'expectedDigest must be a lowercase SHA-256 digest');
    }
    if (typeof expectedRevision !== 'number' || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw new HttpError(400, 'invalid-argument', 'expectedRevision must be a non-negative safe integer');
    }
    if (typeof operationId !== 'string') {
      throw new HttpError(400, 'invalid-argument', 'operationId must be a string');
    }
    const project = body.project;
    if (project === null || typeof project !== 'object' || Array.isArray(project)) {
      throw new HttpError(400, 'invalid-argument', 'project must be an object');
    }
    const saved = await store.saveProject({
      projectId,
      project: project as never,
      expectedRevision,
      expectedDigest,
      operationId,
    });
    sendJson(res, 200, saved);
    return;
  }

  throw methodNotAllowed('GET, PUT');
}

async function readJsonBody(req: IncomingMessage, limit = BODY_LIMIT): Promise<unknown> {
  const contentType = req.headers['content-type'];
  if (typeof contentType !== 'string' || !contentType.toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, 'unsupported-media-type', 'Content-Type must be application/json');
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer);
    total += buffer.length;
    if (total > limit) {
      throw new HttpError(413, 'body-too-large', `request body exceeds ${LIMITS.maxJsonBytes} bytes of JSON`);
    }
    chunks.push(buffer);
  }
  if (total === 0) {
    throw new HttpError(400, 'empty-body', 'request body is required');
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new HttpError(400, 'invalid-json', 'request body is not valid JSON');
  }
}

async function readRawBody(req: IncomingMessage, limit: number): Promise<Uint8Array> {
  const declared = req.headers['content-length'];
  if (declared !== undefined && Number(declared) > limit) throw new HttpError(413, 'body-too-large', `request body exceeds ${limit} bytes`);
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer);
    total += buffer.length;
    if (total > limit) {
      throw new HttpError(413, 'body-too-large', `request body exceeds ${limit} bytes`);
    }
    chunks.push(buffer);
  }
  if (total === 0) {
    throw new HttpError(400, 'empty-body', 'request body is required');
  }
  return new Uint8Array(Buffer.concat(chunks));
}

function requireObject(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'invalid-argument', 'request body must be a JSON object');
  }
  return value as Record<string, unknown>;
}

function methodNotAllowed(allow: string): HttpError {
  return new HttpError(405, 'method-not-allowed', `method not allowed; use ${allow}`, allow);
}

//#endregion api

//#region static studio

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  // Pinned @remotion/player scoped preview CSS, not arbitrary inline styles.
  "style-src 'self' 'sha256-gv/jBVmnD9LQSRVG0n8AQ31cGwpFmZCCHvcOF0Z+Em8='",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  // Remotion's shared HTML audio tags prime playback with an embedded silent MP3.
  "media-src 'self' blob: data:",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

async function handleStatic(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  context: HandlerContext,
): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') throw methodNotAllowed('GET, HEAD');
  const studioDir = context.studioDir;
  if (studioDir === undefined) {
    throw new HttpError(503, 'studio-missing', 'studio build is not configured');
  }

  let root: string;
  try {
    root = await realpath(studioDir);
  } catch {
    throw new HttpError(503, 'studio-missing', 'studio build directory does not exist');
  }

  const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
  const segments = relative.split('/');
  for (const segment of segments) {
    if (segment.length === 0 || segment.startsWith('.') || segment.includes('\\') || segment.includes('%')) {
      throw new HttpError(404, 'not-found', 'file not found');
    }
  }

  const candidate = join(root, ...segments);
  if (!candidate.startsWith(root + sep)) {
    throw new HttpError(404, 'not-found', 'file not found');
  }

  let stats;
  try {
    stats = await lstat(candidate);
  } catch {
    throw new HttpError(404, 'not-found', 'file not found');
  }
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new HttpError(404, 'not-found', 'file not found');
  }
  const resolved = await realpath(candidate);
  if (!resolved.startsWith(root + sep)) {
    throw new HttpError(404, 'not-found', 'file not found');
  }

  const extension = segments[segments.length - 1]?.includes('.')
    ? `.${segments[segments.length - 1]!.split('.').pop()!.toLowerCase()}`
    : '';
  const contentType = CONTENT_TYPES[extension];
  if (contentType === undefined) {
    throw new HttpError(404, 'not-found', 'file not found');
  }

  const bytes = await readFile(resolved);
  res.statusCode = 200;
  res.setHeader('content-type', contentType);
  res.setHeader('cache-control', 'no-store');
  res.setHeader('x-content-type-options', 'nosniff');
  if (extension === '.html') {
    res.setHeader('content-security-policy', CSP);
    const html = new TextDecoder().decode(bytes).replace(
      /<head>/i,
      `<head><meta name="companion-token" content="${context.token}">`,
    );
    res.setHeader('content-length', String(Buffer.byteLength(html)));
    res.end(req.method === 'HEAD' ? undefined : html);
    return;
  }
  res.setHeader('content-length', String(bytes.byteLength));
  res.end(req.method === 'HEAD' ? undefined : bytes);
}

//#endregion static studio

//#region errors

class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly allow: string | undefined;
  readonly previewDiagnostic: PreviewDiagnostic | undefined;

  constructor(status: number, code: string, message: string, allow?: string, previewDiagnostic?: PreviewDiagnostic) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.allow = allow;
    this.previewDiagnostic = previewDiagnostic;
  }
}

interface ErrorBody {
  error: {
    code: string;
    message: string;
    [key: string]: unknown;
  };
}

function mapError(error: unknown): { status: number; body: ErrorBody } {
  if (error instanceof RenderRequestError) {
    return { status: error.status, body: { error: { code: error.code, message: error.message } } };
  }
  if (error instanceof HttpError) {
    return { status: error.status, body: { error: { code: error.code, message: error.message,
      ...(error.previewDiagnostic ? { previewDiagnostic: error.previewDiagnostic } : {}) } } };
  }
  if (error instanceof ConflictError) {
    const message =
      error.reason === 'asset-content'
        ? 'asset content differs from its recorded hash; confirm the replacement explicitly'
        : 'the on-disk snapshot changed; reload or save as a copy';
    return {
      status: 409,
      body: {
        error: {
          code: error.code,
          reason: error.reason,
          assetId: error.assetId,
          message,
        },
      },
    };
  }
  if (error instanceof AssetNotFoundError) {
    return {
      status: 404,
      body: { error: { code: error.code, assetId: error.assetId, message: error.message } },
    };
  }
  if (error instanceof AssetRejectedError) {
    return {
      status: error.reason === 'too-large' ? 413 : error.reason === 'mime-mismatch' ? 415 : 422,
      body: { error: { code: error.code, reason: error.reason, message: error.message } },
    };
  }
  if (error instanceof ProjectExistsError) {
    return {
      status: 409,
      body: { error: { code: error.code, projectId: error.projectId, message: error.message } },
    };
  }
  if (error instanceof InvalidProjectError) {
    return {
      status: 422,
      body: {
        error: {
          code: error.code,
          failure: error.failure,
          issues: error.issues,
          message: 'document is not a valid schema-1 project',
        },
      },
    };
  }
  if (error instanceof UnsafePathError) {
    // Never echo filesystem paths from the boundary.
    return {
      status: 400,
      body: { error: { code: error.code, message: 'path rejected by the workspace boundary' } },
    };
  }
  if (error instanceof StoreError) {
    const status = statusForStoreCode(error.code);
    return { status, body: { error: { code: error.code, message: error.message } } };
  }
  return {
    status: 500,
    body: { error: { code: 'internal-error', message: 'unexpected companion failure' } },
  };
}

function statusForStoreCode(code: string): number {
  switch (code) {
    case 'invalid-argument':
    case 'invalid-operation-id':
    case 'invalid-project-id':
      return 400;
    case 'project-not-found':
      return 404;
    case 'project-exists':
    case 'read-only-project':
    case 'workspace-locked':
      return 409;
    case 'invalid-project':
      return 422;
    case 'commit-failed':
    case 'commit-verification-failed':
      return 500;
    default:
      return 500;
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.setHeader('x-content-type-options', 'nosniff');
  res.end(payload);
}

//#endregion errors
