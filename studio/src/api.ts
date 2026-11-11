import type { Asset, AssetMimeType, Project, ProjectMode } from '../../src/shared/schema/types.ts';
import type { VoiceCatalog, VoiceSelection } from '../../src/shared/voice/selection.ts';
import type { AlignmentDiagnostic, AlignmentKind } from '../../src/shared/voice/alignment.ts';

/** Shapes mirror the companion HTTP API (src/companion/server/http.ts). */

export interface ProjectSummary {
  projectId: string;
  title: string;
  revision: number;
  updatedAt: string;
  mode: ProjectMode;
  missingAssets: string[];
  orphanTemps: string[];
}

export interface ReadResult {
  project: Project;
  revision: number;
  digest: string;
  raw: string;
  mode: ProjectMode;
  missingAssets: string[];
  orphanTemps: string[];
}

export interface CreateResult {
  projectId: string;
  project: Project;
  revision: number;
  digest: string;
  receipt: SaveReceipt;
}

export interface SaveReceipt {
  projectId: string;
  revision: number;
  digest: string;
  operationId: string;
  committedAt: string;
  sync: 'confirmed' | 'uncertain';
}

export interface SaveResult {
  receipt: SaveReceipt;
  revision: number;
  digest: string;
}

export interface CopyResult {
  projectId: string;
  receipt: SaveReceipt;
  revision: number;
  digest: string;
  missingAssets: string[];
}

export interface ImportResult {
  projectId: string;
  receipt: SaveReceipt;
  revision: number;
  digest: string;
  mode: ProjectMode;
  missingAssets: string[];
  approvalCleared: boolean;
  importedAsCopy: boolean;
}

export interface RelinkResult {
  projectId: string;
  assetId: string;
  previousAssetId: string;
  replaced: boolean;
  revision: number;
  digest: string;
  receipt: SaveReceipt | null;
  missingAssets: string[];
  asset: Asset;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function companionToken(): string {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="companion-token"]');
  if (meta === null || meta.content.length === 0) {
    throw new ApiError(
      0,
      'token-missing',
      'No hay token de companion: abrí el estudio desde el companion local.',
    );
  }
  return meta.content;
}

async function call<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const headers: Record<string, string> = { authorization: `Bearer ${companionToken()}` };
  if (body !== undefined) headers['content-type'] = 'application/json';

  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch {
    signal?.throwIfAborted();
    throw new ApiError(0, 'companion-unreachable', 'El companion no responde. Verificá que siga iniciado.');
  }
  return parseResponse<T>(response);
}

/** Raw upload used by relink: bytes go as the request body, never as base64 JSON. */
async function callBytes<T>(
  path: string,
  bytes: Uint8Array,
  contentType: string,
  extraHeaders: Record<string, string> = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${companionToken()}`,
        'content-type': contentType,
        ...extraHeaders,
      },
      body: new Uint8Array(bytes).buffer,
    });
  } catch {
    throw new ApiError(0, 'companion-unreachable', 'El companion no responde. Verificá que siga iniciado.');
  }
  return parseResponse<T>(response);
}

async function parseResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  let parsed: unknown = null;
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      parsed = null;
    }
  }

  if (!response.ok) {
    const error = (parsed as { error?: Record<string, unknown> } | null)?.error;
    throw new ApiError(
      response.status,
      typeof error?.code === 'string' ? error.code : 'http-error',
      typeof error?.message === 'string' ? error.message : `HTTP ${response.status}`,
      error ?? {},
    );
  }

  return parsed as T;
}

export interface AssetBlobUrl {
  url: string;
  revoke(): void;
}

export async function fetchVoiceSample(provider: string, voiceId: string, signal: AbortSignal): Promise<AssetBlobUrl> {
  signal.throwIfAborted();
  const response = await fetch(`/api/vibi/voices/${encodeURIComponent(provider)}/${encodeURIComponent(voiceId)}/preview`, {
    headers: { authorization: `Bearer ${companionToken()}` }, signal,
  });
  if (!response.ok) await parseResponse<never>(response);
  const blob = await response.blob();
  signal.throwIfAborted();
  const url = URL.createObjectURL(blob);
  let revoked = false;
  return { url, revoke: () => { if (!revoked) { revoked = true; URL.revokeObjectURL(url); } } };
}

export interface RenderStatus {
  status: 'rendering' | 'completed' | 'failed';
  progress: number;
  outputPath?: string;
  error?: string;
}

async function downloadRender(projectId: string, renderId: string): Promise<void> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/renders/${encodeURIComponent(renderId)}/file`, {
    headers: { authorization: `Bearer ${companionToken()}` },
  });
  if (!response.ok) await parseResponse<never>(response);
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `exportacion-${renderId}.mp4`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Caller owns the URL: revoke on replacement/unmount and abort pending requests
 * with the same cleanup. Aborting after resolution does not revoke a live URL.
 */
export async function fetchAssetBlobUrl(projectId: string, assetId: string, signal?: AbortSignal): Promise<AssetBlobUrl> {
  const token = companionToken();
  let response: Response;
  try {
    response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetId)}`, {
      method: 'GET',
      headers: { authorization: `Bearer ${token}` },
      signal,
    });
  } catch {
    signal?.throwIfAborted();
    throw new ApiError(0, 'companion-unreachable', 'El companion no responde. Verifique que siga iniciado.');
  }
  if (!response.ok) await parseResponse<never>(response);
  const blob = await response.blob();
  signal?.throwIfAborted();
  const url = URL.createObjectURL(blob);
  let revoked = false;
  return {
    url,
    revoke() {
      if (revoked) return;
      revoked = true;
      URL.revokeObjectURL(url);
    },
  };
}

export const api = {
  models: (offset = 0, expectedRevision?: string) => call<{ models: import('../../src/shared/models/model.ts').ModelSnapshot[]; hasMore: boolean; revision: string }>('GET', `/api/models?offset=${offset}${expectedRevision ? `&expectedRevision=${encodeURIComponent(expectedRevision)}` : ''}`),
  publishModels: (models: import('../../src/shared/models/model.ts').ModelSnapshot[], signal?: AbortSignal) =>
    call<{ models: import('../../src/shared/models/model.ts').ModelSnapshot[] }>('POST', '/api/models/resolve', { models }, signal),
  vibiVoices: (signal?: AbortSignal) => call<VoiceCatalog>('GET', '/api/vibi/voices', undefined, signal),
  generateVoice: (projectId: string, sceneId: string, revision: number, digest: string, signal?: AbortSignal, selection?: VoiceSelection) =>
    call<{ opened: ReadResult; receipt: SaveReceipt; alignment: 'vibi' | 'estimated'; alignmentKind: AlignmentKind; warnings: string[]; alignmentDiagnostic?: AlignmentDiagnostic }>('POST',
      `/api/projects/${encodeURIComponent(projectId)}/scenes/${encodeURIComponent(sceneId)}/voice`,
      { expectedRevision: revision, expectedDigest: digest, consent: true, ...selection }, signal),
  vibiCredits: (signal?: AbortSignal) => call<{ credits: number }>('GET', '/api/vibi/credits', undefined, signal),
  attachAudio: (projectId: string, sceneId: string, bytes: Uint8Array, mimeType: 'audio/wav' | 'audio/mpeg', license: string, revision: number, digest: string, alignVibi = false) =>
    callBytes<{ opened: ReadResult; receipt: SaveReceipt; revision: number; digest: string; alignment: 'vibi' | 'estimated'; alignmentKind: AlignmentKind; warnings: string[]; alignmentDiagnostic?: AlignmentDiagnostic }>(
      `/api/projects/${encodeURIComponent(projectId)}/scenes/${encodeURIComponent(sceneId)}/audio${alignVibi ? '?align=vibi' : ''}`, bytes, mimeType,
      { 'x-expected-revision': String(revision), 'x-expected-digest': digest, 'x-asset-license': encodeURIComponent(license), ...(alignVibi ? { 'x-vibi-consent': '1' } : {}) }),
  capabilities: (signal?: AbortSignal) => call<{ codex: boolean; vibi: boolean; vibiVoiceConfigured: boolean }>('GET', '/api/capabilities', undefined, signal),
  generateScript: (input: import('../../src/shared/script/prompt.ts').ScriptPromptInput, signal?: AbortSignal) =>
    call<import('../../src/shared/script/schema.ts').ScriptProposal>('POST', '/api/script/generate', input, signal),
  generateDrawing: (project: Project, sceneId: string, signal?: AbortSignal) =>
    call<import('../../src/shared/kit/types.ts').KitScene>('POST', '/api/drawing/generate', { project, sceneId }, signal),
  generateModelDrawing: (project: Project, sceneId: string, signal?: AbortSignal) =>
    call<{ scene: import('../../src/shared/kit/types.ts').KitScene; models: import('../../src/shared/models/model.ts').ModelSnapshot[] }>(
      'POST', '/api/drawing/generate', { project, sceneId, modelMode: true }, signal),
  startRender: (projectId: string, expectedRevision: number) =>
    call<{ renderId: string }>('POST', `/api/projects/${encodeURIComponent(projectId)}/renders`, { expectedRevision }),
  renderStatus: (projectId: string, renderId: string) =>
    call<RenderStatus>('GET', `/api/projects/${encodeURIComponent(projectId)}/renders/${encodeURIComponent(renderId)}`),
  downloadRender,
  fetchAssetBlobUrl,
  health: () => call<{ ok: boolean }>('GET', '/api/health'),
  list: () => call<{ projects: ProjectSummary[] }>('GET', '/api/projects'),
  create: (title?: string) => call<CreateResult>('POST', '/api/projects', title === undefined ? {} : { title }),
  read: (projectId: string) => call<ReadResult>('GET', `/api/projects/${projectId}`),
  save: (
    projectId: string,
    args: { project: Project; expectedRevision: number; expectedDigest?: string; operationId: string },
  ) => call<SaveResult>('PUT', `/api/projects/${projectId}`, args),
  copy: (projectId: string, newProjectId?: string, text?: string, operationId?: string) =>
    call<CopyResult>(
      'POST',
      `/api/projects/${projectId}/copy`,
      { newProjectId, text, operationId },
    ),
  importProject: (text: string, collision: 'reject' | 'copy' = 'reject') =>
    call<ImportResult>('POST', '/api/imports', { text, collision }),
  relink: (projectId: string, assetId: string, bytes: Uint8Array, mimeType: AssetMimeType, confirmReplace = false, expectedRevision?: number, expectedDigest?: string) =>
    callBytes<RelinkResult>(
      `/api/projects/${projectId}/assets/${assetId}`,
      bytes,
      mimeType,
      {
        ...(confirmReplace ? { 'x-confirm-replace': '1' } : {}),
        ...(expectedRevision === undefined ? {} : { 'x-expected-revision': String(expectedRevision) }),
        ...(expectedDigest === undefined ? {} : { 'x-expected-digest': expectedDigest }),
      },
    ),
};

export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'conflict':
        if (error.details.reason === 'asset-content') {
          return 'El archivo elegido tiene otro contenido que el registrado. Confirmá la sustitución para continuar.';
        }
        return error.details.reason === 'operation'
          ? 'Esa operación de guardado ya se usó con otro contenido. Reintentá el guardado.'
          : 'El archivo cambió en disco desde que lo abriste. Recargá o guardá como copia portable.';
      case 'asset-rejected':
        if (error.details.reason === 'decoded-too-large') {
          return 'El recurso supera el límite conservador de 100 MiB de datos decodificados.';
        }
        if (error.details.reason === 'inspection-timeout') {
          return 'La inspección superó su límite de 10 s y se detuvo. El recurso no fue aceptado.';
        }
        if (error.details.reason === 'inspection-busy') {
          return 'Ya hay dos inspecciones en curso. Espere a que terminen y vuelva a intentarlo.';
        }
        if (error.details.reason === 'mime-mismatch') {
          return 'El archivo no es del tipo declarado (wav, mp3, png o jpeg) o su cabecera no coincide.';
        }
        if (error.details.reason === 'audio-too-long') {
          return 'El audio supera el máximo de 60 s.';
        }
        if (error.details.reason === 'unsupported-audio') {
          return 'El audio no es PCM/IEEE float, o supera 2 canales / 48 kHz.';
        }
        if (error.details.reason === 'image-dimensions') {
          return 'La imagen supera 4096 px por eje o 16 megapíxeles.';
        }
        if (error.details.reason === 'too-large') {
          return 'El archivo supera el máximo de 50 MiB.';
        }
        return 'No se pudo inspeccionar el archivo; revisá que no esté truncado.';
      case 'asset-not-found':
        return 'Ese recurso ya no está declarado en el documento.';
      case 'project-exists':
        return 'Ya existe un proyecto con ese identificador en el workspace.';
      case 'workspace-locked':
        return 'El workspace está bloqueado por otro companion. Cerrá el otro proceso o reclamá el lock.';
      case 'read-only-project':
        return 'El proyecto está en modo solo lectura (estilo desconocido): no se puede guardar acá.';
      case 'project-not-found':
        return 'El proyecto ya no existe en el workspace.';
      case 'companion-unreachable':
      case 'token-missing':
        return error.message;
      case 'invalid-project':
        return 'El documento no cumple el esquema 1. Revisá los campos marcados.';
      default:
        return error.message;
    }
  }
  return error instanceof Error ? error.message : 'Error inesperado.';
}
