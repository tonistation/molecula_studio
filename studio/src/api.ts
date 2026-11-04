import type { Project, ProjectMode } from '../../src/shared/schema/types.ts';

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

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { authorization: `Bearer ${companionToken()}` };
  if (body !== undefined) headers['content-type'] = 'application/json';

  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'companion-unreachable', 'El companion no responde. Verificá que siga iniciado.');
  }

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

export const api = {
  health: () => call<{ ok: boolean }>('GET', '/api/health'),
  list: () => call<{ projects: ProjectSummary[] }>('GET', '/api/projects'),
  create: (title?: string) => call<CreateResult>('POST', '/api/projects', title === undefined ? {} : { title }),
  read: (projectId: string) => call<ReadResult>('GET', `/api/projects/${projectId}`),
  save: (
    projectId: string,
    args: { project: Project; expectedRevision: number; operationId: string },
  ) => call<SaveResult>('PUT', `/api/projects/${projectId}`, args),
  copy: (projectId: string, newProjectId?: string) =>
    call<CopyResult>(
      'POST',
      `/api/projects/${projectId}/copy`,
      newProjectId === undefined ? {} : { newProjectId },
    ),
};

export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'conflict':
        return error.details.reason === 'operation'
          ? 'Esa operación de guardado ya se usó con otro contenido. Reintentá el guardado.'
          : 'El archivo cambió en disco desde que lo abriste. Recargá o guardá como copia portable.';
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
