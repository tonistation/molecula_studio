import { constants } from 'node:fs';
import { realpath, open, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { canonicalize } from '../../shared/canonical.ts';
import { validateProceduralModel, type ProceduralModel } from '../../shared/models/model.ts';

const ID = /^[0-9a-f]{64}$/;
const MAX_BYTES = 32 * 1024;
const MAX_MODELS = 1024;
const MAX_CATALOG_BYTES = MAX_MODELS * (MAX_BYTES + 1) + 2;
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const writers = new Map<string, Promise<void>>();

/** Workspace-local immutable content-addressed model definitions.
 * The workspace root itself is trusted and must not be renamed or replaced during operations.
 */
export class ModelLibrary {
  private readonly root: string;
  private readonly beforePublish?: () => Promise<void>;

  constructor(root: string, beforePublish?: () => Promise<void>) {
    this.root = root;
    this.beforePublish = beforePublish;
  }

  private async read(root: string): Promise<Map<string, ProceduralModel>> {
    let file;
    try { file = await open(join(root, '.models'), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Map();
      throw error;
    }
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > MAX_CATALOG_BYTES) throw new Error('Invalid model library');
      const bytes = Buffer.alloc(MAX_CATALOG_BYTES + 1);
      let length = 0;
      while (length < bytes.length) {
        const { bytesRead } = await file.read(bytes, length, bytes.length - length, length);
        if (!bytesRead) break;
        length += bytesRead;
      }
      if (length > MAX_CATALOG_BYTES) throw new Error('Model library exceeds limit');
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length));
      const values: unknown = JSON.parse(text);
      if (!Array.isArray(values) || values.length > MAX_MODELS || canonicalize(values) !== text) throw new Error('Invalid model library');
      const models = new Map<string, ProceduralModel>();
      for (const value of values) {
        const result = validateProceduralModel(value);
        if (!result.ok) throw new Error('Invalid model contents');
        const modelText = canonicalize(value);
        if (Buffer.byteLength(modelText) > MAX_BYTES) throw new Error('Model exceeds limit');
        const id = hash(modelText);
        if (models.has(id)) throw new Error('Duplicate model');
        models.set(id, result.model);
      }
      return models;
    } finally { await file.close(); }
  }

  async get(id: string): Promise<ProceduralModel> {
    if (!ID.test(id)) throw new Error('Invalid model ID');
    const model = (await this.read(await realpath(this.root))).get(id);
    if (!model) throw new Error('Model not found');
    return model;
  }

  async put(value: unknown): Promise<string> {
    return (await this.putMany([value]))[0]!;
  }

  /** Validate and snapshot the entire batch before publishing a single catalog replacement. */
  async putMany(values: readonly unknown[], beforeCommit?: () => void): Promise<string[]> {
    if (!Array.isArray(values) || Object.getPrototypeOf(values) !== Array.prototype || values.length > 64
      || Object.getOwnPropertySymbols(values).length || Object.getOwnPropertyNames(values).length !== values.length + 1
      || Array.from({ length: values.length }, (_, index) => Object.getOwnPropertyDescriptor(values, String(index)))
        .some(descriptor => !descriptor?.enumerable || !('value' in descriptor))) throw new Error('Invalid model batch');
    const snapshots = values.map(value => {
      const result = validateProceduralModel(value);
      if (!result.ok) throw new Error('Invalid procedural model');
      const text = canonicalize(result.model);
      if (Buffer.byteLength(text) > MAX_BYTES) throw new Error('Model exceeds limit');
      return { id: hash(text), model: JSON.parse(text) as ProceduralModel };
    });
    const root = await realpath(this.root);
    const previous = writers.get(root) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>(resolve => { release = resolve; });
    writers.set(root, current);
    await previous;
    try {
      const models = await this.read(root);
      let changed = false;
      for (const snapshot of snapshots) {
        if (!models.has(snapshot.id)) { models.set(snapshot.id, snapshot.model); changed = true; }
      }
      if (models.size > MAX_MODELS) throw new Error('Model library full');
      if (!changed) { beforeCommit?.(); return snapshots.map(snapshot => snapshot.id); }
      const temporary = join(root, `.models-tmp-${randomBytes(16).toString('hex')}`);
      let owned = false;
      try {
        const file = await open(temporary, 'wx', 0o600);
        owned = true;
        try { await file.writeFile(canonicalize([...models.values()])); await file.sync(); }
        finally { await file.close(); }
        await this.beforePublish?.();
        beforeCommit?.();
        await rename(temporary, join(root, '.models'));
        owned = false;
      } finally { if (owned) await unlink(temporary).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }); }
      return snapshots.map(snapshot => snapshot.id);
    } finally {
      release();
      if (writers.get(root) === current) writers.delete(root);
    }
  }

  async find(semanticId: string): Promise<{ id: string; model: ProceduralModel }[]> {
    if (!/^[a-z][a-z0-9-]{0,47}$/.test(semanticId)) throw new Error('Invalid semantic ID');
    const models = await this.read(await realpath(this.root));
    return [...models].filter(([, model]) => model.semanticId === semanticId)
      .sort(([a], [b]) => a.localeCompare(b)).map(([id, model]) => ({ id, model }));
  }

  async list(): Promise<{ id: string; model: ProceduralModel }[]> {
    return [...await this.read(await realpath(this.root))]
      .sort(([a], [b]) => a.localeCompare(b)).map(([id, model]) => ({ id, model }));
  }
}
