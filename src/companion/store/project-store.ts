import { join } from 'node:path';

import {
  LIMITS,
  emptyProject,
  parseProjectText,
  serializeProject,
  validateProject,
} from '../../shared/schema/index.ts';
import type { Project, ProjectMode } from '../../shared/schema/types.ts';
import { sha256Hex } from '../../shared/digests.ts';
import { createNodeFsOps, isErrno, type FsOps, type FsStats } from './fs-ops.ts';
import { isValidOperationId, isValidProjectId, newOperationId, newProjectId } from './ids.ts';
import type { ReceiptVerification, SaveReceipt } from './receipts.ts';
import {
  CommitVerificationError,
  ConflictError,
  InvalidArgumentError,
  InvalidOperationIdError,
  InvalidProjectError,
  ProjectExistsError,
  ProjectNotFoundError,
  ReadOnlyProjectError,
  StoreClosedError,
  StoreCommitError,
  StoreError,
  StoreNotInitializedError,
  UnsafePathError,
  WorkspaceLockedError,
} from './errors.ts';

const PROJECT_FILE = 'project.json';
const TEMP_PREFIX = 'project.json.tmp-';
const LOCK_FILE = '.companion.lock';
const STAGE_PREFIX = '.copying-';
const ASSETS_DIR = 'assets';
/** Bounded retries when generating free directory names. */
const NAME_ATTEMPTS = 8;

export interface WorkspaceOptions {
  workspaceRoot: string;
  now?: () => Date;
  fsOps?: FsOps;
}

export interface InitOptions {
  /** Reclaim a lock from a dead process. Never breaks a live one. */
  forceUnlock?: boolean;
}

export interface ProjectSummary {
  projectId: string;
  /** Empty string when the document fails validation. */
  title: string;
  /** -1 when the document fails validation. */
  revision: number;
  /** Empty string when the document fails validation. */
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

export interface CreateArgs {
  title?: string;
}

export interface CreateResult {
  projectId: string;
  project: Project;
  revision: number;
  digest: string;
  receipt: SaveReceipt;
}

export interface SaveArgs {
  projectId: string;
  project: Project;
  expectedRevision: number;
  operationId: string;
}

export interface SaveResult {
  receipt: SaveReceipt;
  revision: number;
  digest: string;
}

export interface CopyArgs {
  projectId: string;
  newProjectId?: string;
}

export interface CopyResult {
  projectId: string;
  receipt: SaveReceipt;
  revision: number;
  digest: string;
  missingAssets: string[];
}

export interface TempReport {
  [projectId: string]: string[];
}

/**
 * Durable JSON persistence for M1 (architecture.md, "Flujo de persistencia").
 *
 * Guarantees:
 * - Atomic visible commit: readers observe the previous or the new complete
 *   file, never a partial one.
 * - A `confirmed` receipt means the rename happened and the committed bytes
 *   re-read back equal the snapshot. `uncertain` means the rename happened but
 *   the final directory flush failed; callers must `verifyReceipt` before
 *   treating that revision as durable. Neither state claims physical
 *   persistence beyond what the platform provides.
 * - Conflicts never overwrite: a revision or digest divergence keeps the
 *   on-disk snapshot intact.
 * - One writer per workspace: a second live companion is rejected; only an
 *   explicit `forceUnlock` reclaims a lock left by a dead process.
 * - Crash leftovers surface as orphan temps; they are never auto-promoted.
 */
export class ProjectStore {
  readonly #fs: FsOps;
  readonly #now: () => Date;
  readonly #workspaceRoot: string;
  #initialized = false;
  #closed = false;
  #root = '';
  #lockPath = '';
  /** projectId → last revision/digest observed by this process. */
  #lastSeen = new Map<string, { revision: number; digest: string }>();
  /** `${projectId}|${operationId}` → committed receipt. */
  #receipts = new Map<string, SaveReceipt>();
  /** Same key → digest of the committed payload bytes. */
  #payloads = new Map<string, string>();
  #workspaceChain: Promise<unknown> = Promise.resolve();
  #projectChains = new Map<string, Promise<unknown>>();

  constructor(options: WorkspaceOptions) {
    if (typeof options.workspaceRoot !== 'string' || options.workspaceRoot.length === 0) {
      throw new InvalidArgumentError('workspaceRoot must be a non-empty string');
    }
    this.#workspaceRoot = options.workspaceRoot;
    this.#now = options.now ?? (() => new Date());
    this.#fs = options.fsOps ?? createNodeFsOps();
  }

  //#region lifecycle

  async init(options?: InitOptions): Promise<void> {
    this.#assertNotClosed();
    if (this.#initialized) return;

    await this.#withWorkspace(async () => {
      await this.#fs.mkdir(this.#workspaceRoot, { recursive: true });
      this.#root = await this.#fs.realpath(this.#workspaceRoot);
      const stats = await this.#lstatStrict(this.#workspaceRoot);
      if (stats.isSymbolicLink() || !stats.isDirectory()) {
        throw new UnsafePathError(this.#workspaceRoot, 'workspace root must be a plain directory');
      }
      await this.#acquireWorkspaceLock(options?.forceUnlock === true);
    });
    this.#initialized = true;
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    if (!this.#initialized) {
      this.#closed = true;
      return;
    }
    try {
      await this.#releaseWorkspaceLock();
    } finally {
      this.#closed = true;
    }
  }

  /** Re-reads committed bytes; mandatory check for `uncertain` receipts. */
  async verifyReceipt(args: { projectId: string; receipt: SaveReceipt }): Promise<ReceiptVerification> {
    this.#assertReady();
    const loaded = await this.#readBytes(args.projectId);
    const confirmed = loaded.digest === args.receipt.digest;
    return {
      projectId: args.projectId,
      revision: confirmed ? loaded.project.revision : null,
      digest: loaded.digest,
      confirmed,
    };
  }

  //#endregion lifecycle

  //#region listing

  async listProjects(): Promise<ProjectSummary[]> {
    this.#assertReady();
    const summaries: ProjectSummary[] = [];
    for (const projectId of await this.#listProjectDirs()) {
      try {
        const loaded = await this.#readBytes(projectId);
        this.#remember(projectId, loaded.project.revision, loaded.digest);
        summaries.push({
          projectId,
          title: loaded.project.title,
          revision: loaded.project.revision,
          updatedAt: loaded.project.updatedAt,
          mode: loaded.mode,
          missingAssets: await this.#missingAssets(projectId, loaded.project),
          orphanTemps: await this.#scanTemps(this.#projectDir(projectId)),
        });
      } catch (error) {
        if (error instanceof InvalidProjectError) {
          summaries.push({
            projectId,
            title: '',
            revision: -1,
            updatedAt: '',
            mode: 'read-only',
            missingAssets: [],
            orphanTemps: [],
          });
          continue;
        }
        if (error instanceof ProjectNotFoundError || error instanceof UnsafePathError) continue;
        throw error;
      }
    }
    return summaries.sort((a, b) => a.projectId.localeCompare(b.projectId));
  }

  /** `project.json.tmp-*` leftovers: reported, never promoted. */
  async findOrphanTemps(projectId?: string): Promise<TempReport> {
    this.#assertReady();
    if (projectId !== undefined) {
      assertValidProjectId(projectId);
      return { [projectId]: await this.#scanTemps(this.#projectDir(projectId)) };
    }
    const report: TempReport = {};
    for (const entry of await this.#listProjectDirs()) {
      report[entry] = await this.#scanTemps(this.#projectDir(entry));
    }
    return report;
  }

  //#endregion listing

  //#region read

  async readProject(projectId: string): Promise<ReadResult> {
    this.#assertReady();
    assertValidProjectId(projectId);
    const loaded = await this.#readBytes(projectId);
    this.#remember(projectId, loaded.project.revision, loaded.digest);
    return {
      project: loaded.project,
      revision: loaded.project.revision,
      digest: loaded.digest,
      raw: loaded.raw,
      mode: loaded.mode,
      missingAssets: await this.#missingAssets(projectId, loaded.project),
      orphanTemps: await this.#scanTemps(this.#projectDir(projectId)),
    };
  }

  //#endregion read

  //#region create

  async createProject(args?: CreateArgs): Promise<CreateResult> {
    this.#assertReady();
    if (args?.title !== undefined && !isValidTitle(args.title)) {
      throw new InvalidArgumentError('title must be a string of 1 to 120 characters');
    }
    return this.#withWorkspace(async () => {
      const projectId = await this.#freeProjectDirName();
      const project = emptyProject({ projectId, now: this.#isoNow(), title: args?.title });
      const bytes = this.#encode(project);
      const digest = await sha256Hex(bytes);

      const dir = this.#projectDir(projectId);
      await this.#fs.mkdir(dir, { recursive: false });
      await this.#fs.mkdir(join(dir, ASSETS_DIR), { recursive: false });

      const receipt = await this.#commitOver({
        projectId,
        bytes,
        digest,
        revision: 0,
        operationId: newOperationId(),
      });
      this.#remember(projectId, 0, digest);
      this.#registerReceipt(receipt, digest);
      return { projectId, project, revision: 0, digest, receipt };
    });
  }

  //#endregion create

  //#region save

  /**
   * Explicit save. Concurrency serialized per project; conflict keeps the
   * on-disk snapshot; the idempotent replay of a confirmed operationId returns
   * the original receipt without rewriting (same payload digest required).
   */
  async saveProject(args: SaveArgs): Promise<SaveResult> {
    this.#assertReady();
    assertValidProjectId(args.projectId);
    if (!isValidOperationId(args.operationId)) {
      throw new InvalidOperationIdError(args.operationId);
    }
    if (args.expectedRevision < 0 || !Number.isSafeInteger(args.expectedRevision)) {
      throw new InvalidArgumentError('expectedRevision must be a non-negative safe integer');
    }
    this.#assertEditablePayload(args.project, args.projectId);

    const bytes = this.#encode(args.project);
    if (bytes.length > LIMITS.maxJsonBytes) {
      throw new InvalidProjectError(args.projectId, 'too-large', [
        { path: '$', code: 'too-large', message: `project exceeds ${LIMITS.maxJsonBytes} bytes` },
      ]);
    }
    const digest = await sha256Hex(bytes);

    const key = receiptKeyOf(args.projectId, args.operationId);
    const replay = this.#receipts.get(key);
    if (replay !== undefined) {
      if (this.#payloads.get(key) === digest) {
        return { receipt: replay, revision: replay.revision, digest: replay.digest };
      }
      throw new ConflictError({ projectId: args.projectId, reason: 'operation', operationId: args.operationId });
    }

    const nextRevision = args.expectedRevision + 1;
    return this.#withProject(args.projectId, async () => {
      const committed = this.#receipts.get(key);
      if (committed !== undefined) {
        if (this.#payloads.get(key) === digest) {
          return { receipt: committed, revision: committed.revision, digest: committed.digest };
        }
        throw new ConflictError({ projectId: args.projectId, reason: 'operation', operationId: args.operationId });
      }

      const current = await this.#readBytes(args.projectId);
      if (current.project.revision !== args.expectedRevision) {
        throw new ConflictError({
          projectId: args.projectId,
          reason: 'revision',
          expectedRevision: args.expectedRevision,
          actualRevision: current.project.revision,
        });
      }
      const lastSeen = this.#lastSeen.get(args.projectId);
      if (lastSeen !== undefined && lastSeen.revision === args.expectedRevision && lastSeen.digest !== current.digest) {
        throw new ConflictError({
          projectId: args.projectId,
          reason: 'digest',
          expectedDigest: lastSeen.digest,
          actualDigest: current.digest,
        });
      }

      const receipt = await this.#commitOver({
        projectId: args.projectId,
        bytes,
        digest,
        revision: nextRevision,
        operationId: args.operationId,
      });
      this.#remember(args.projectId, nextRevision, receipt.digest);
      this.#registerReceipt(receipt, digest);
      return { receipt, revision: nextRevision, digest: receipt.digest };
    });
  }

  //#endregion save

  //#region saveCopy

  /**
   * Portable copy: new projectId, revision 0, fresh dates; preserves entity and
   * scene IDs plus versions; publishes via staging directory rename; missing
   * assets keep the copy a valid draft and are reported, never substituted.
   */
  async saveCopy(args: CopyArgs): Promise<CopyResult> {
    this.#assertReady();
    assertValidProjectId(args.projectId);
    const source = await this.readProject(args.projectId);

    return this.#withWorkspace(async () => {
      const stage = await this.#createStageDir(args.newProjectId);
      try {
        // A copy gets a fresh identity: new projectId, revision 0, new dates
        // and a cleared approval (project-format.md: portable copy rules).
        const copyProject: Project = {
          ...source.project,
          projectId: stage.projectId,
          revision: 0,
          createdAt: this.#isoNow(),
          updatedAt: this.#isoNow(),
          approval: null,
        };
        const bytes = this.#encode(copyProject);
        if (bytes.length > LIMITS.maxJsonBytes) {
          throw new InvalidProjectError(stage.projectId, 'too-large', [
            { path: '$', code: 'too-large', message: `project exceeds ${LIMITS.maxJsonBytes} bytes` },
          ]);
        }
        const digest = await sha256Hex(bytes);
        await this.#fs.writeFile(join(stage.dir, PROJECT_FILE), bytes);

        const missingAssets = await this.#copyAssetsIntoStage(args.projectId, source.project, stage.dir);
        await this.#fs.syncDir(stage.dir).catch(() => undefined);

        const target = this.#projectDir(stage.projectId);
        if ((await this.#lstatOrNull(target)) !== null) {
          throw new ProjectExistsError(stage.projectId);
        }
        await this.#fs.rename(stage.dir, target);
        stage.renamed = true;
        await this.#fs.syncDir(this.#root).catch(() => undefined);

        // Verify the published bytes were the stage bytes, never a partial copy.
        const published = await this.#fs.readFile(this.#projectFile(stage.projectId));
        if ((await sha256Hex(published)) !== digest) {
          throw new CommitVerificationError(stage.projectId, digest, await sha256Hex(published));
        }

        const receipt: SaveReceipt = {
          projectId: stage.projectId,
          revision: 0,
          digest,
          operationId: newOperationId(),
          committedAt: this.#isoNow(),
          sync: 'confirmed',
        };
        this.#remember(stage.projectId, 0, digest);
        return {
          projectId: stage.projectId,
          receipt,
          revision: 0,
          digest,
          missingAssets,
        };
      } finally {
        // After a rename the stage no longer exists; force:false keeps rm
        // harmless in that case and never touches other paths.
        if (stage.renamed === false) {
          await this.#fs.rm(stage.dir, { recursive: true, force: false }).catch(() => undefined);
        }
      }
    });
  }

  //#endregion saveCopy

  //#region Lifecycle

  #assertNotClosed(): void {
    if (this.#closed) throw new StoreClosedError();
  }

  #assertReady(): void {
    this.#assertNotClosed();
    if (!this.#initialized) throw new StoreNotInitializedError();
  }

  #isoNow(): string {
    return this.#now().toISOString();
  }

  /** Returns null only for a missing path; any other error propagates. */
  async #lstatOrNull(path: string): Promise<FsStats | null> {
    try {
      return await this.#fs.lstat(path);
    } catch (error) {
      if (isErrno(error, 'ENOENT')) return null;
      throw error;
    }
  }

  /** Throws `project-not-found` for a missing path instead of returning null. */
  async #lstatStrict(path: string): Promise<FsStats> {
    try {
      return await this.#fs.lstat(path);
    } catch (error) {
      if (isErrno(error, 'ENOENT')) throw new ProjectNotFoundError(path);
      throw error;
    }
  }

  async #acquireWorkspaceLock(forceUnlock: boolean): Promise<void> {
    const lockPath = join(this.#root, LOCK_FILE);
    const current = await this.#readLock(lockPath);
    if (current !== null) {
      if (!current.stale || !forceUnlock) {
        throw new WorkspaceLockedError({ lockPath, pid: current.pid, stale: current.stale });
      }
      await this.#fs.unlink(lockPath);
    }
    await this.#fs.writeFileExclusive(
      lockPath,
      new TextEncoder().encode(JSON.stringify({ pid: process.pid, startedAt: this.#isoNow() })),
    );
    this.#lockPath = lockPath;
  }

  async #readLock(lockPath: string): Promise<{ pid: number; startedAt: string; stale: boolean } | null> {
    try {
      const bytes = await this.#fs.readFile(lockPath);
      const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { pid: -1, startedAt: '', stale: true };
      }
      const record = parsed as Record<string, unknown>;
      if (typeof record.pid !== 'number' || !Number.isInteger(record.pid) || typeof record.startedAt !== 'string') {
        return { pid: -1, startedAt: '', stale: true };
      }
      return { pid: record.pid, startedAt: record.startedAt, stale: !isLivePid(record.pid) };
    } catch (error) {
      if (isErrno(error, 'ENOENT')) return null;
      // Corrupt lock: treat as stale so forceUnlock can reclaim it.
      return { pid: -1, startedAt: '', stale: true };
    }
  }

  async #releaseWorkspaceLock(): Promise<void> {
    if (this.#lockPath === '') return;
    const current = await this.#readLock(this.#lockPath);
    if (current !== null && current.pid !== process.pid && !current.stale) {
      // Somebody reclaimed the lock after we lost it; never delete theirs.
      this.#lockPath = '';
      return;
    }
    await this.#fs.unlink(this.#lockPath).catch(() => undefined);
    this.#lockPath = '';
  }

  //#endregion lifecycle

  //#region Paths

  #projectDir(projectId: string): string {
    if (!isValidProjectId(projectId)) {
      throw new InvalidArgumentError(`invalid projectId ${JSON.stringify(projectId)}`);
    }
    return join(this.#root, projectId);
  }

  #projectFile(projectId: string): string {
    return join(this.#projectDir(projectId), PROJECT_FILE);
  }

  async #listProjectDirs(): Promise<string[]> {
    const entries = await this.#fs.readdir(this.#root);
    const dirs: string[] = [];
    for (const name of entries) {
      if (name.startsWith('.') || !isValidProjectId(name)) continue;
      const stats = await this.#lstatOrNull(join(this.#root, name));
      if (stats === null || stats.isSymbolicLink() || !stats.isDirectory()) continue;
      dirs.push(name);
    }
    return dirs.sort();
  }

  async #freeProjectDirName(): Promise<string> {
    for (let attempt = 0; attempt < NAME_ATTEMPTS; attempt += 1) {
      const candidate = newProjectId();
      if ((await this.#lstatOrNull(this.#projectDir(candidate))) === null) return candidate;
    }
    throw new StoreError('workspace-exhausted', 'could not allocate a unique projectId');
  }

  /**
   * Returns the existing plain-file asset path inside the project, or null.
   * The schema restricts asset paths to `assets/<assetId>.<ext>`, so the join
   * stays under the controlled project directory.
   */
  async #existingAssetPath(projectId: string, assetPath: string): Promise<string | null> {
    const file = join(this.#projectDir(projectId), assetPath);
    const stats = await this.#lstatOrNull(file);
    if (stats === null || stats.isSymbolicLink() || !stats.isFile()) return null;
    return file;
  }

  async #missingAssets(projectId: string, project: Project): Promise<string[]> {
    const missing: string[] = [];
    for (const asset of project.assets) {
      if ((await this.#existingAssetPath(projectId, asset.path)) === null) missing.push(asset.assetId);
    }
    return missing;
  }

  //#endregion paths

  //#region read internals

  async #readBytes(projectId: string): Promise<{
    project: Project;
    revision: number;
    digest: string;
    raw: string;
    mode: ProjectMode;
  }> {
    const dir = this.#projectDir(projectId);
    const dirStats = await this.#lstatOrNull(dir);
    if (dirStats === null) throw new ProjectNotFoundError(projectId);
    if (dirStats.isSymbolicLink() || !dirStats.isDirectory()) {
      throw new UnsafePathError(dir, 'project entry must be a plain directory');
    }
    const expectedDir = join(this.#root, projectId);
    if ((await this.#fs.realpath(dir)) !== expectedDir) {
      throw new UnsafePathError(dir, 'project directory resolves outside the workspace');
    }

    let fileStats: FsStats;
    try {
      fileStats = await this.#fs.lstat(this.#projectFile(projectId));
    } catch (error) {
      if (isErrno(error, 'ENOENT')) throw new ProjectNotFoundError(projectId);
      throw error;
    }
    if (fileStats.isSymbolicLink() || !fileStats.isFile()) {
      throw new UnsafePathError(this.#projectFile(projectId), 'project.json must be a plain regular file');
    }

    const bytes = await this.#fs.readFile(this.#projectFile(projectId));
    const outcome = parseProjectText(bytes);
    if (!outcome.ok) {
      throw new InvalidProjectError(projectId, outcome.failure, outcome.issues);
    }
    return {
      project: outcome.project,
      revision: outcome.project.revision,
      digest: await sha256Hex(bytes),
      raw: new TextDecoder().decode(bytes),
      mode: outcome.mode,
    };
  }

  async #scanTemps(dir: string): Promise<string[]> {
    try {
      const entries = await this.#fs.readdir(dir);
      return entries.filter((name) => name.startsWith(TEMP_PREFIX)).sort();
    } catch {
      return [];
    }
  }

  //#endregion read internals

  //#region write internals

  #encode(project: Project): Uint8Array {
    return new TextEncoder().encode(serializeProject(project));
  }

  #assertEditablePayload(project: Project, projectId: string): void {
    if (project.projectId !== projectId) {
      throw new InvalidArgumentError(
        `payload projectId ${JSON.stringify(project.projectId)} does not match ${JSON.stringify(projectId)}`,
      );
    }
    const result = validateProject(project);
    if (!result.ok) {
      throw new InvalidProjectError(projectId, 'invalid-schema', result.issues);
    }
    if (result.mode === 'read-only') {
      throw new ReadOnlyProjectError(projectId);
    }
  }

  /**
   * Commit protocol: exclusive temp write in the project directory, file
   * fsync, atomic rename, byte verification by re-reading, then directory
   * fsync. Failures before the rename clean up the temp and keep the previous
   * file; a directory fsync failure after the rename reports `uncertain`
   * without claiming a rollback.
   */
  async #commitOver(args: {
    projectId: string;
    bytes: Uint8Array;
    digest: string;
    revision: number;
    operationId: string;
  }): Promise<SaveReceipt> {
    const temp = join(this.#projectDir(args.projectId), TEMP_PREFIX + args.operationId);
    let uncertain = false;
    try {
      await this.#fs.writeFileExclusive(temp, args.bytes);
      await this.#fs.syncFile(temp);
      await this.#fs.rename(temp, this.#projectFile(args.projectId));
      const finalBytes = await this.#fs.readFile(this.#projectFile(args.projectId));
      const finalDigest = await sha256Hex(finalBytes);
      if (finalDigest !== args.digest) {
        throw new CommitVerificationError(args.projectId, args.digest, finalDigest);
      }
      try {
        await this.#fs.syncDir(this.#projectDir(args.projectId));
      } catch {
        uncertain = true;
      }
    } catch (error) {
      await this.#fs.unlink(temp).catch(() => undefined);
      if (error instanceof CommitVerificationError || error instanceof StoreCommitError) throw error;
      if (error instanceof StoreError) throw error;
      if (isErrno(error, 'EEXIST')) {
        throw new StoreCommitError('write', `temp file ${TEMP_PREFIX}${args.operationId} already exists`, {
          cause: error,
          tempPath: temp,
        });
      }
      throw new StoreCommitError('write', error instanceof Error ? error.message : String(error), {
        cause: error,
        tempPath: temp,
      });
    }
    return {
      projectId: args.projectId,
      revision: args.revision,
      digest: args.digest,
      operationId: args.operationId,
      committedAt: this.#isoNow(),
      sync: uncertain ? 'uncertain' : 'confirmed',
    };
  }

  /**
   * Copies declared assets into the staging directory. Missing files become
   * missingAssets; an existing file whose bytes differ from the recorded hash
   * aborts the copy instead of silently substituting content (R05).
   */
  async #copyAssetsIntoStage(
    projectId: string,
    project: Project,
    stageDir: string,
  ): Promise<string[]> {
    const missing: string[] = [];
    if (project.assets.length > 0) {
      await this.#fs.mkdir(join(stageDir, ASSETS_DIR), { recursive: true });
    }
    for (const asset of project.assets) {
      const sourcePath = await this.#existingAssetPath(projectId, asset.path);
      if (sourcePath === null) {
        missing.push(asset.assetId);
        continue;
      }
      const targetPath = join(stageDir, ASSETS_DIR, assetFilename(asset.path));
      await this.#fs.copyFile(sourcePath, targetPath);
      if (asset.sha256 !== null) {
        const copied = await this.#fs.readFile(targetPath);
        const copiedDigest = await sha256Hex(copied);
        if (copiedDigest !== asset.sha256) {
          throw new StoreCommitError(
            'copy',
            `asset "${asset.assetId}" differs from its recorded hash; refusing silent substitution`,
          );
        }
      }
    }
    return missing;
  }

  async #createStageDir(requestedId?: string): Promise<{ dir: string; projectId: string; renamed: boolean }> {
    if (requestedId !== undefined) {
      assertValidProjectId(requestedId);
      if ((await this.#lstatOrNull(this.#projectDir(requestedId))) !== null) {
        throw new ProjectExistsError(requestedId);
      }
      return this.#mkdirStage(requestedId);
    }
    for (let attempt = 0; attempt < NAME_ATTEMPTS; attempt += 1) {
      const candidate = newProjectId();
      if ((await this.#lstatOrNull(this.#projectDir(candidate))) !== null) continue;
      return this.#mkdirStage(candidate);
    }
    throw new StoreError('workspace-exhausted', 'could not allocate a unique copy identity');
  }

  async #mkdirStage(projectId: string): Promise<{ dir: string; projectId: string; renamed: boolean }> {
    const dir = join(this.#root, STAGE_PREFIX + projectId + '-' + newOperationId());
    await this.#fs.mkdir(dir, { recursive: false });
    return { dir, projectId, renamed: false };
  }

  //#endregion write internals

  //#region memory

  #remember(projectId: string, revision: number, digest: string): void {
    this.#lastSeen.set(projectId, { revision, digest });
  }

  /** Makes idempotent retries return the identical committed receipt. */
  #registerReceipt(receipt: SaveReceipt, payloadDigest: string): void {
    const key = receiptKeyOf(receipt.projectId, receipt.operationId);
    this.#receipts.set(key, receipt);
    this.#payloads.set(key, payloadDigest);
  }

  //#endregion memory

  //#region concurrency

  async #withWorkspace<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.#workspaceChain.then(fn, fn);
    this.#workspaceChain = run.catch(() => undefined);
    return run;
  }

  async #withProject<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.#projectChains.get(projectId) ?? Promise.resolve();
    const run = previous.then(fn, fn);
    this.#projectChains.set(
      projectId,
      run.catch(() => undefined),
    );
    return run;
  }

  //#endregion concurrency
}

function isLivePid(pid: number): boolean {
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists under another user; treat it as live.
    return isErrno(error, 'EPERM');
  }
}

function assertValidProjectId(value: unknown): void {
  if (!isValidProjectId(value)) {
    throw new InvalidArgumentError(`invalid projectId ${JSON.stringify(value)}`);
  }
}

function isValidTitle(title: unknown): title is string {
  return typeof title === 'string' && codePoints(title) >= 1 && codePoints(title) <= 120;
}

function codePoints(text: string): number {
  return Array.from(text).length;
}

function receiptKeyOf(projectId: string, operationId: string): string {
  return `${projectId}|${operationId}`;
}

/** Extracts a checked file name from a schema-constrained asset path. */
function assetFilename(assetPath: string): string {
  const parts = assetPath.split('/');
  if (parts.length !== 2 || parts[0] !== 'assets') {
    throw new InvalidArgumentError(`asset path ${JSON.stringify(assetPath)} is not a project asset reference`);
  }
  const filename = parts[1];
  if (filename === undefined || filename.length === 0 || filename.includes('\\')) {
    throw new InvalidArgumentError(`asset path ${JSON.stringify(assetPath)} is not a project asset reference`);
  }
  return filename;
}
