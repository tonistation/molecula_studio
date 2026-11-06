import { randomBytes, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { Project } from '../../shared/schema/types.ts';
import { projectToVideoProps } from '../../shared/video-props.ts';
import type { ProjectStore } from '../store/project-store.ts';
import { renderProject } from './render-service.ts';

export class RenderRequestError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export interface RenderStatus {
  status: 'rendering' | 'completed' | 'failed';
  progress: number;
  outputPath?: string;
  error?: string;
}

// Process-wide admission, including separate companion instances in tests. No durable queue.
let active = false;

export function createRenderJobs(store: ProjectStore, workspaceRoot: string, renderer = renderProject) {
  const jobs = new Map<string, { projectId: string; state: RenderStatus }>();
  const capabilities = new Map<string, { project: Project }>();
  let pending: Promise<void> = Promise.resolve();

  function get(projectId: string, renderId: string): RenderStatus {
    const job = jobs.get(renderId);
    if (!job || job.projectId !== projectId) throw new RenderRequestError(404, 'render-not-found', 'Exportación no encontrada.');
    return { ...job.state };
  }

  return {
    get,
    async start(projectId: string, expectedRevision: number, origin: string) {
      if (active) throw new RenderRequestError(409, 'render-active', 'Ya hay una exportación en curso');
      active = true;
      try {
        const saved = await store.readProject(projectId);
        if (saved.revision !== expectedRevision) throw new RenderRequestError(409, 'render-revision', 'La revisión guardada cambió. Recargue el proyecto.');
        if (saved.project.scenes.length === 0) throw new RenderRequestError(422, 'render-empty', 'Añada y guarde al menos una escena antes de exportar.');
        const token = randomBytes(32).toString('hex');
        const assetUrls = Object.fromEntries(saved.project.assets.map(asset => [asset.assetId, `${origin}/render-assets/${token}/${asset.assetId}`]));
        // Validate before accepting; approval deliberately does not gate export (ADR-06).
        try { projectToVideoProps(saved.project, assetUrls); }
        catch { throw new RenderRequestError(422, 'render-unsupported', 'El estilo o las escenas guardadas no son compatibles con la exportación.'); }
        const renderId = `r-${randomUUID()}`;
        const state: RenderStatus = { status: 'rendering', progress: 0 };
        jobs.set(renderId, { projectId, state });
        capabilities.set(token, { project: saved.project });
        // Detached from the request and tab lifetime; only the companion owns this promise.
        pending = Promise.resolve().then(() => renderer({
          projectFile: join(workspaceRoot, projectId, 'project.json'), workspaceRoot,
          savedProject: saved.project, assetUrls,
          onProgress: ({ progress }) => { if (Number.isFinite(progress)) state.progress = Math.max(state.progress, Math.min(0.99, progress)); },
        })).then(outputPath => {
          state.outputPath = outputPath;
          state.progress = 1;
          state.status = 'completed';
        }, () => {
          state.status = 'failed';
          // Renderer diagnostics may contain tokenized asset URLs. Never expose or log them.
          state.error = 'No se pudo exportar el video. Revise el proyecto y sus recursos; vuelva a intentarlo.';
        }).finally(() => { capabilities.delete(token); active = false; });
        return { renderId };
      } catch (error) { active = false; throw error; }
    },
    async asset(token: string, assetId: string) {
      const capability = capabilities.get(token);
      const expected = capability?.project.assets.find(asset => asset.assetId === assetId);
      if (!capability || !expected) throw new RenderRequestError(404, 'asset-not-found', 'Recurso no encontrado.');
      const result = await store.readAsset(capability.project.projectId, assetId);
      if (JSON.stringify(result.asset) !== JSON.stringify(expected)) throw new RenderRequestError(409, 'render-asset-changed', 'El recurso cambió durante la exportación.');
      // A request that crossed completion must not extend the capability lifetime.
      if (!capabilities.has(token)) throw new RenderRequestError(404, 'asset-not-found', 'Recurso no encontrado.');
      return result;
    },
    async file(projectId: string, renderId: string) {
      const state = get(projectId, renderId);
      if (state.status !== 'completed' || !state.outputPath) throw new RenderRequestError(409, 'render-not-ready', 'La exportación todavía no está disponible.');
      const path = state.outputPath;
      // Only the recorded output handle is downloadable; reject replaced symlink paths.
      try {
        if (await realpath(path) !== path) throw new Error('unsafe output');
        const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
        const info = await handle.stat();
        if (!info.isFile()) { await handle.close(); throw new Error('invalid output'); }
        return { handle, size: info.size, filename: basename(path) };
      } catch {
        throw new RenderRequestError(404, 'render-file-missing', 'El archivo exportado ya no está disponible.');
      }
    },
    settle: () => pending,
  };
}
