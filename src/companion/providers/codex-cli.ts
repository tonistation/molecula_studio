import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { mkdtemp, writeFile, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LIMITS } from '../../shared/schema/limits.ts';
import { validateProject } from '../../shared/schema/validate.ts';
import { buildScriptPrompt, type ScriptPromptInput } from '../../shared/script/prompt.ts';
import { SCRIPT_PROPOSAL_SCHEMA } from '../../shared/script/schema.ts';
import { parseScriptResponse } from '../../shared/script/parse.ts';
import { buildKitPrompt, buildKitModelPrompt } from '../../shared/kit/prompt.ts';
import { selectKitOutputSchema, selectKitModelOutputSchema } from '../../shared/kit/output-schema.ts';
import { parseKitResponse, parseKitModelBundle } from '../../shared/kit/parse.ts';
import { applyKitSceneWithModels } from '../../shared/kit/apply.ts';
import type { ModelSnapshot } from '../../shared/models/model.ts';
import { selectModelCatalog } from '../../shared/models/catalog.ts';
import { SCRIPT_TIMEOUT_MS, DRAWING_TIMEOUT_MS } from '../../shared/generation-timeouts.ts';
export { SCRIPT_TIMEOUT_MS, DRAWING_TIMEOUT_MS } from '../../shared/generation-timeouts.ts';

export interface CodexOptions {
  /** Test-only process environment and shorter deadlines; never accepted over HTTP. */
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  tempRoot?: string;
  /** Test-only barriers for proving cleanup ordering. */
  beforeCleanup?: (directory: string) => Promise<void>;
  afterCleanup?: (directory: string) => void;
}

export interface CodexDiagnostics {
  stage: 'spawn' | 'running' | 'exit' | 'timeout';
  elapsedMs: number;
  processStarted: boolean;
  exitCode?: number;
  signal?: 'SIGTERM' | 'SIGKILL' | 'SIGINT' | 'SIGHUP';
}

export class GenerationError extends Error {
  readonly status: number;
  readonly code: string;
  readonly responseText: string | undefined;
  readonly diagnostics: CodexDiagnostics | undefined;
  constructor(status: number, code: string, message: string, responseText?: string, diagnostics?: CodexDiagnostics) {
    super(message);
    this.status = status;
    this.code = code;
    this.responseText = responseText;
    this.diagnostics = diagnostics;
  }
}

/** Only closed lifecycle metadata is returned; subprocess output is never captured. */
export function runCodex(args: string[], options: CodexOptions & { cwd?: string; input?: string; signal?: AbortSignal } = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) { reject(new GenerationError(499, 'generation-cancelled', 'Generación cancelada.')); return; }
    // Reuse CLI session auth; do not accidentally select API billing via inherited keys
    // or expose unrelated provider credentials to model-launched tools.
    const env = Object.fromEntries(Object.entries(options.env ?? process.env)
      .filter(([key]) => !/key|token|secret|password|credential/i.test(key) && !key.startsWith('VIBI_')));
    const startedAt = performance.now();
    let processStarted = false;
    const diagnostics = (stage: CodexDiagnostics['stage']): CodexDiagnostics => ({ stage, processStarted,
      elapsedMs: Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(performance.now() - startedAt) || 0)) });
    const child = spawn('codex', args, { cwd: options.cwd, env,
      shell: false, detached: true, stdio: ['pipe', 'ignore', 'ignore'] });
    child.once('spawn', () => { processStarted = true; });
    let failure: GenerationError | undefined;
    const stop = (error: GenerationError) => {
      failure ??= error;
      // Kill the process group as well as the CLI (tools must not outlive a timeout).
      if (child.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }
    };
    const timeoutMs = options.timeoutMs ?? SCRIPT_TIMEOUT_MS;
    const timer = setTimeout(() => stop(new GenerationError(504, 'generation-timeout',
      `Codex no terminó en ${timeoutMs / 1000} s (tiempo de espera). Reintenta o usa el modo manual.`, undefined, diagnostics('timeout'))), timeoutMs);
    const abort = () => stop(new GenerationError(499, 'generation-cancelled', 'Generación cancelada.', undefined,
      diagnostics(processStarted ? 'running' : 'spawn')));
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();
    child.stdin.on('error', () => { /* Early CLI exit; close reports a safe actionable error. */ });
    child.once('error', () => { failure ??= new GenerationError(503, 'codex-unavailable',
      'No se pudo iniciar Codex. Instala Codex CLI y ejecuta codex login; también puedes usar el modo manual.', undefined, diagnostics('spawn')); });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      if (failure) reject(failure);
      else if (code !== 0) {
        const info = diagnostics('exit');
        if (Number.isInteger(code) && code! >= 0 && code! <= 255) info.exitCode = code!;
        if (signal === 'SIGTERM' || signal === 'SIGKILL' || signal === 'SIGINT' || signal === 'SIGHUP') info.signal = signal;
        reject(new GenerationError(502, 'codex-failed',
          'Codex no pudo generar la respuesta. Comprueba tu sesión con codex login y tus límites de uso. Verifica que el modelo configurado esté disponible para tu cuenta o ajusta MOLECULA_CODEX_*. También puedes usar el modo manual.', undefined, info));
      }
      else resolve();
    });
    child.stdin.end(options.input ?? '');
  });
}

function redact(text: string, env: NodeJS.ProcessEnv): string {
  let safe = text;
  for (const [key, value] of Object.entries(env)) {
    if (value && /key|token|secret|password|credential/i.test(key)) safe = safe.split(value).join('[oculto]');
  }
  return safe.replace(/\bsk-[A-Za-z0-9_-]+/g, '[oculto]');
}

type CodexTask = 'script' | 'drawing' | 'model-drawing';
// Provisional: single valid sample per task; visual quality and model identity remain unverified.
const DEFAULT_CODEX_MODEL = 'gpt-6.1-terra';

function selectModel(task: CodexTask, env: NodeJS.ProcessEnv): string {
  const key = task === 'script' ? 'MOLECULA_CODEX_SCRIPT_MODEL'
    : task === 'drawing' ? 'MOLECULA_CODEX_DRAW_MODEL'
      : env.MOLECULA_CODEX_MODEL_BUILD_MODEL !== undefined ? 'MOLECULA_CODEX_MODEL_BUILD_MODEL' : 'MOLECULA_CODEX_DRAW_MODEL';
  const model = env[key];
  if (model !== undefined && !/^[A-Za-z0-9._:][A-Za-z0-9._:-]{0,79}(?![\s\S])/.test(model)) {
    throw new GenerationError(500, 'invalid-codex-model',
      `La configuración del modelo de Codex en ${key} no es válida. Usa de 1 a 80 caracteres ASCII: letras, números, punto, guion, guion bajo o dos puntos; no comiences con guion.`);
  }
  return model ?? DEFAULT_CODEX_MODEL;
}

async function generate<T>(task: CodexTask, prompt: string, schema: object,
  parse: (text: string) => { ok: true; value: T } | { ok: false; errors: string[] },
  options: CodexOptions, signal?: AbortSignal): Promise<T> {
  const model = selectModel(task, options.env ?? process.env);
  const directory = await mkdtemp(join(options.tempRoot ?? tmpdir(), 'molecula-codex-'));
  try {
    const schemaPath = join(directory, 'schema.json');
    const outputPath = join(directory, 'response.json');
    await writeFile(schemaPath, JSON.stringify(schema), { mode: 0o600 });
    await runCodex(['exec', '--skip-git-repo-check', '--sandbox', 'read-only', '--ephemeral', '--model', model,
      '--output-schema', schemaPath, '-o', outputPath, '-'], { ...options, cwd: directory, input: prompt, signal });
    let text: string;
    try {
      const handle = await open(outputPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        if (!(await handle.stat()).isFile()) throw new Error('not a regular file');
        // Read at most the parser budget + one byte, even if the file grows after stat.
        const bytes = Buffer.alloc(LIMITS.maxJsonBytes + 1);
        let bytesRead = 0;
        while (bytesRead < bytes.length) {
          const part = await handle.read(bytes, bytesRead, bytes.length - bytesRead, bytesRead);
          if (!part.bytesRead) break;
          bytesRead += part.bytesRead;
        }
        if (bytesRead > LIMITS.maxJsonBytes) throw new Error('oversized');
        text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, bytesRead));
      } finally { await handle.close(); }
    } catch {
      throw new GenerationError(502, 'invalid-generation', 'Codex no produjo una salida legible dentro del límite. Usa el modo manual.');
    }
    const safeText = redact(text, options.env ?? process.env);
    if (safeText !== text) throw new GenerationError(502, 'invalid-generation',
      'La respuesta de Codex contenía datos sensibles y se ocultaron. Usa el modo manual para revisarla.', safeText.slice(0, 16000));
    const result = parse(text);
    if (!result.ok) throw new GenerationError(502, 'invalid-generation',
      `La respuesta de Codex no es válida. ${result.errors.join(' ')} Usa el modo manual para revisarla.`,
      safeText.slice(0, 16000));
    return result.value;
  } finally {
    try { await options.beforeCleanup?.(directory); }
    finally { await rm(directory, { recursive: true, force: true }); options.afterCleanup?.(directory); }
  }
}

export async function generateScript(input: unknown, options: CodexOptions = {}, signal?: AbortSignal) {
  const record = input as ScriptPromptInput;
  let prompt: string;
  try {
    if (!record || typeof record !== 'object' || Array.isArray(record)
      || Object.keys(record).sort().join() !== 'idea,locale,styleId,targetSeconds') throw new Error();
    prompt = buildScriptPrompt(record);
  } catch { throw new GenerationError(400, 'invalid-argument', 'Revisa la idea, el estilo, el idioma y la duración objetivo.'); }
  return generate('script', prompt, SCRIPT_PROPOSAL_SCHEMA, text => {
    const result = parseScriptResponse(text);
    return result.ok ? { ok: true, value: result.proposal } : result;
  }, options, signal);
}

export async function generateDrawing(input: unknown, options: CodexOptions = {}, signal?: AbortSignal) {
  const body = input as { project?: unknown; sceneId?: unknown };
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).sort().join() !== 'project,sceneId' || typeof body.sceneId !== 'string') {
    throw new GenerationError(400, 'invalid-argument', 'Indica un borrador válido y la escena que deseas dibujar.');
  }
  const result = validateProject(body.project);
  if (!result.ok || result.mode !== 'editable') throw new GenerationError(400, 'invalid-argument', 'El borrador no es válido o es de solo lectura.');
  const project = result.project;
  const index = project.scenes.findIndex(scene => scene.sceneId === body.sceneId);
  const scene = project.scenes[index];
  if (!scene) throw new GenerationError(400, 'invalid-argument', 'No se encontró la escena para dibujar.');
  const previousScenes = project.scenes.slice(0, index);
  return generate('drawing', buildKitPrompt({ scene, previousScenes, references: project.sources ?? [], targetVisual: scene.visual }),
    selectKitOutputSchema([...previousScenes, scene]), text => {
      const parsed = parseKitResponse(text, { durationMs: scene.durationMs,
        entities: new Map(project.entities.map(entity => [entity.entityId, entity])) });
      return parsed.ok ? { ok: true, value: parsed.scene } : parsed;
    }, { ...options, timeoutMs: options.timeoutMs ?? DRAWING_TIMEOUT_MS }, signal);
}

export async function generateModelDrawing(input: unknown, catalog: readonly ModelSnapshot[], options: CodexOptions = {}, signal?: AbortSignal) {
  const body = input as { project?: unknown; sceneId?: unknown; modelMode?: unknown };
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).sort().join() !== 'modelMode,project,sceneId' || body.modelMode !== true || typeof body.sceneId !== 'string') {
    throw new GenerationError(400, 'invalid-argument', 'Indica un borrador válido y la escena que deseas dibujar.');
  }
  const result = validateProject(body.project);
  if (!result.ok || result.mode !== 'editable') throw new GenerationError(400, 'invalid-argument', 'El borrador no es válido o es de solo lectura.');
  const project = result.project;
  const index = project.scenes.findIndex(scene => scene.sceneId === body.sceneId);
  const scene = project.scenes[index];
  if (!scene) throw new GenerationError(400, 'invalid-argument', 'No se encontró la escena para dibujar.');
  const previousScenes = project.scenes.slice(0, index);
  let shortlist: ModelSnapshot[];
  try { shortlist = selectModelCatalog(project.models ?? [], catalog, `${scene.title} ${scene.text} ${scene.visualIntent}`); }
  catch { throw new GenerationError(400, 'invalid-argument', 'No se pudieron verificar los modelos del borrador.'); }
  const prompt = buildKitModelPrompt({ scene, previousScenes, references: project.sources ?? [], targetVisual: scene.visual, catalog: shortlist });
  return generate('model-drawing', prompt, selectKitModelOutputSchema([...previousScenes, scene]), text => {
    const parsed = parseKitModelBundle(text, { durationMs: scene.durationMs,
      entities: new Map(project.entities.map(entity => [entity.entityId, entity])) }, shortlist);
    if (!parsed.ok) return parsed;
    try { applyKitSceneWithModels(project, scene.sceneId, parsed.scene, parsed.models); }
    catch { return { ok: false, errors: ['La escena y los modelos no se pueden aplicar al borrador.'] }; }
    return { ok: true, value: { scene: parsed.scene, models: parsed.models } };
  }, { ...options, timeoutMs: options.timeoutMs ?? DRAWING_TIMEOUT_MS }, signal);
}
