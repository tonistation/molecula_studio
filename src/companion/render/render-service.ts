import { randomUUID } from 'node:crypto';
import { link, lstat, mkdir, mkdtemp, open, rm } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import type { RenderMediaOnProgress } from '@remotion/renderer';
import { LIMITS, parseProjectText } from '../../shared/schema/index.ts';
import { projectToVideoProps } from '../../shared/video-props.ts';
import type { Project } from '../../shared/schema/types.ts';

export interface RenderProjectOptions {
  projectFile: string;
  workspaceRoot: string;
  outputPath?: string;
  onProgress?: RenderMediaOnProgress;
  /** Trusted saved document read through ProjectStore by the HTTP boundary. */
  savedProject?: Project;
  assetUrls?: Record<string, string>;
  /** UTC clock override for deterministic filenames in tests. */
  now?: Date;
}

interface RendererDependencies {
  bundle: typeof bundle;
  selectComposition: typeof selectComposition;
  renderMedia: typeof renderMedia;
}

/** One bundle and one active export per service; production uses the singleton below. */
export function createRenderService(deps: RendererDependencies = { bundle, selectComposition, renderMedia }) {
  let bundled: Promise<string> | undefined;
  let busy = false;

  return async function renderProject(options: RenderProjectOptions): Promise<string> {
    if (busy) throw new Error('Ya hay una exportación en curso.');
    busy = true;
    let staging: string | undefined;
    try {
      // Read-only: reuse the store's bounded schema parser without taking its writer lock.
      const project = options.savedProject ?? await readSavedProject(options.projectFile);
      const inputProps = projectToVideoProps(project, options.assetUrls ?? {});
      if (project.output.voiceMode !== 'silent') {
        throw new Error('Este paso solo exporta proyectos silenciosos; la voz corresponde a la fase 4.');
      }
      const date = (options.now ?? new Date()).toISOString().replace(/[-:]/g, '').slice(0, 15).replace('T', '-');
      const output = resolve(options.outputPath ?? join(options.workspaceRoot, '.renders', project.projectId, `${project.revision}-${date}.mp4`));
      if (extname(output).toLowerCase() !== '.mp4') throw new Error('La salida debe tener extensión .mp4.');
      await assertAbsent(output);
      await ensurePlainDirectory(dirname(output));
      staging = await mkdtemp(join(dirname(output), '.render-'));
      const temporary = join(staging, `${randomUUID()}.mp4`);
      const reservation = await open(temporary, 'wx');
      await reservation.close();

      bundled ??= deps.bundle({
        entryPoint: fileURLToPath(new URL('../../video/index.ts', import.meta.url)),
        rootDir: fileURLToPath(new URL('../../../', import.meta.url)),
      });
      const serveUrl = await bundled;
      const chromiumOptions = { gl: 'angle' as const };
      const composition = await deps.selectComposition({ serveUrl, id: 'Vertical', inputProps, chromiumOptions });
      await deps.renderMedia({
        serveUrl, composition, inputProps, codec: 'h264', chromiumOptions,
        outputLocation: temporary, concurrency: 1, onProgress: options.onProgress,
      });
      // Same-filesystem hard links publish complete bytes atomically without replacing any destination.
      // Removing private staging below leaves the winning output link intact.
      await link(temporary, output).catch(error => {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          throw new Error('La salida ya existe; elija otro nombre.');
        }
        throw error;
      });
      return output;
    } finally {
      try {
        if (staging !== undefined) await rm(staging, { recursive: true, force: true });
      } finally {
        busy = false;
      }
    }
  };
}

async function readSavedProject(projectFile: string): Promise<Project> {
  const handle = await open(resolve(projectFile), 'r');
  let bytes: Buffer;
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > LIMITS.maxJsonBytes) {
      throw new Error('El proyecto debe ser un archivo dentro del límite de tamaño.');
    }
    // A concurrent writer cannot make this allocation exceed the schema limit.
    const buffer = Buffer.alloc(LIMITS.maxJsonBytes + 1);
    let length = 0;
    while (length < buffer.length) {
      const read = await handle.read(buffer, length, buffer.length - length);
      if (read.bytesRead === 0) break;
      length += read.bytesRead;
    }
    bytes = buffer.subarray(0, length);
  } finally {
    await handle.close();
  }
  const parsed = parseProjectText(bytes);
  if (!parsed.ok) {
    throw new Error(`Proyecto inválido: ${parsed.issues.map(i => `${i.path}: ${i.message}`).join('; ')}`);
  }
  return parsed.project;
}

async function assertAbsent(path: string): Promise<void> {
  const info = await lstat(path).catch(error => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  });
  if (info !== null) throw new Error('La salida ya existe; elija otro nombre.');
}

async function ensurePlainDirectory(path: string): Promise<void> {
  const parent = dirname(path);
  if (parent !== path) await ensurePlainDirectory(parent);
  await mkdir(path).catch(error => {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  });
  const info = await lstat(path);
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new Error('La salida no puede usar un enlace simbólico ni un directorio inválido.');
  }
}

export const renderProject = createRenderService();
