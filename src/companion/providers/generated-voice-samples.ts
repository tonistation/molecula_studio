import { createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, realpath, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { VOICE_SAMPLE_PHRASE, VOICE_SAMPLE_VERSION } from '../../shared/voice/sample-phrase.ts';
import { inspectMediaBounded } from '../store/inspection-runner.ts';

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_ENTRIES = 64;
const HEADER = 'VIBI-SAMPLE-1\n';
const PENDING = 'pending\n';
const locks = new Map<string, Promise<void>>();
const digest = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');

export function sampleKey(provider: string, voiceId: string, modelId: string): string {
  const settings = provider === 'elevenlabs' ? { stability: 0.5, similarity_boost: 0.75, speed: 1 } : { speed: 1, pitch: 0 };
  return digest(JSON.stringify({ provider, voiceId, modelId, version: VOICE_SAMPLE_VERSION, phrase: VOICE_SAMPLE_PHRASE, language: 'es', settings }));
}

export class SampleUnresolvedError extends Error {
  constructor() { super('Una solicitud anterior puede seguir en curso o su resultado no pudo verificarse. Revise Vibi; nuevas solicitudes para esta muestra están bloqueadas.'); }
}

/** Test-only barrier and notification; never exposed through HTTP. */
export interface SampleReservationTestHooks {
  afterReservation?: () => Promise<void>;
  afterCleanup?: () => void;
}

/** The workspace root is protected by ProjectStore's exclusive writer lock. */
export class GeneratedVoiceSamples {
  private readonly root: string;
  private readonly testHooks: SampleReservationTestHooks | undefined;
  constructor(root: string, testHooks?: SampleReservationTestHooks) { this.root = root; this.testHooks = testHooks; }

  private async directory(create: boolean): Promise<string | null> {
    const root = await realpath(this.root);
    const dir = join(root, '.voice-samples');
    if (create) {
      try { await mkdir(dir, { mode: 0o700 }); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
    }
    let stat;
    try { stat = await lstat(dir); } catch (error) {
      if (!create && (error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
    if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(dir) !== dir || (stat.mode & 0o077) !== 0) throw new SampleUnresolvedError();
    return dir;
  }

  private async read(dir: string, key: string): Promise<Uint8Array | null> {
    let file;
    try { file = await open(join(dir, key), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw new SampleUnresolvedError(); }
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o077) !== 0 || stat.size > MAX_BYTES + 128 || stat.size < 1) throw new SampleUnresolvedError();
      const buffer = Buffer.alloc(stat.size); let offset = 0;
      while (offset < buffer.length) { const { bytesRead } = await file.read(buffer, offset, buffer.length - offset, offset); if (!bytesRead) throw new SampleUnresolvedError(); offset += bytesRead; }
      const start = HEADER.length + 65;
      if (buffer.subarray(0, HEADER.length).toString() !== HEADER || buffer[HEADER.length + 64] !== 10) throw new SampleUnresolvedError();
      const bytes = buffer.subarray(start);
      if (!bytes.length || bytes.length > MAX_BYTES || digest(bytes) !== buffer.subarray(HEADER.length, HEADER.length + 64).toString()) throw new SampleUnresolvedError();
      try { await inspectMediaBounded(bytes, 'audio/mpeg'); } catch { throw new SampleUnresolvedError(); }
      return bytes;
    } finally { await file.close(); }
  }

  async get(key: string): Promise<Uint8Array | null> {
    if (!/^[a-f0-9]{64}$/.test(key)) throw new SampleUnresolvedError();
    const dir = await this.directory(false);
    return dir ? this.read(dir, key) : null;
  }

  async generate(key: string, synthesize: () => Promise<Uint8Array>, beforeReserve?: () => void, signal?: AbortSignal): Promise<Uint8Array> {
    if (!/^[a-f0-9]{64}$/.test(key)) throw new SampleUnresolvedError();
    const root = await realpath(this.root);
    const previous = locks.get(root) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>(resolve => { release = resolve; });
    locks.set(root, current); await previous;
    let dir: string; let identity: { dev: number; ino: number }; let synthesis: Promise<Uint8Array>;
    try {
      dir = (await this.directory(true))!;
      const directoryStat = await lstat(dir); identity = { dev: directoryStat.dev, ino: directoryStat.ino };
      const cached = await this.read(dir, key);
      if (cached) return cached;
      if ((await readdir(dir)).length >= MAX_ENTRIES) throw new Error('La caché de muestras alcanzó su límite.');
      signal?.throwIfAborted(); beforeReserve?.();
      const reservation = await open(join(dir, key), 'wx', 0o600);
      let reservationIdentity: { dev: number; ino: number };
      try {
        await reservation.writeFile(PENDING); await reservation.sync();
        const stat = await reservation.stat(); reservationIdentity = { dev: stat.dev, ino: stat.ino };
      } finally { await reservation.close(); }
      const parent = await open(dir, 'r'); try { await parent.sync(); } finally { await parent.close(); }
      try {
        if (this.testHooks?.afterReservation) await this.testHooks.afterReservation();
        beforeReserve?.(); signal?.throwIfAborted();
      } catch (error) {
        const stat = await lstat(dir);
        if (!stat.isDirectory() || stat.isSymbolicLink() || stat.dev !== identity.dev || stat.ino !== identity.ino || await realpath(dir) !== dir) throw new SampleUnresolvedError();
        const marker = await lstat(join(dir, key));
        if (!marker.isFile() || marker.isSymbolicLink() || marker.nlink !== 1 || marker.dev !== reservationIdentity.dev || marker.ino !== reservationIdentity.ino) throw new SampleUnresolvedError();
        await unlink(join(dir, key));
        const parent = await open(dir, 'r'); try { await parent.sync(); } finally { await parent.close(); }
        this.testHooks?.afterCleanup?.();
        throw error;
      }
      // No await between the final cancellation check and invoking synthesis.
      // Any failure from invocation onward remains conservatively unresolved.
      synthesis = synthesize();
    } finally { release(); if (locks.get(root) === current) locks.delete(root); }

    const bytes = await synthesis;
    if (!bytes.length || bytes.length > MAX_BYTES) throw new SampleUnresolvedError();
    try { await inspectMediaBounded(bytes, 'audio/mpeg'); } catch { throw new SampleUnresolvedError(); }
    const assertDirectory = async () => {
      const stat = await lstat(dir);
      if (!stat.isDirectory() || stat.isSymbolicLink() || stat.dev !== identity.dev || stat.ino !== identity.ino || await realpath(dir) !== dir) throw new SampleUnresolvedError();
    };
    await assertDirectory();
    const temp = join(dir, `.tmp-${randomBytes(16).toString('hex')}`);
    let owned = false;
    try {
      const file = await open(temp, 'wx', 0o600); owned = true;
      try { await file.writeFile(Buffer.concat([Buffer.from(`${HEADER}${digest(bytes)}\n`), Buffer.from(bytes)])); await file.sync(); }
      finally { await file.close(); }
      await assertDirectory();
      await rename(temp, join(dir, key)); owned = false;
      const parent = await open(dir, 'r'); try { await parent.sync(); } finally { await parent.close(); }
      return bytes;
    } finally { if (owned) await assertDirectory().then(() => unlink(temp)).catch(() => {}); }
  }
}
