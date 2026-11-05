import { join } from 'node:path';

import {
  LIMITS,
  emptyProject,
  parseProjectText,
  serializeProject,
  validateProject,
} from '../../shared/schema/index.ts';
import type { Asset, AssetMimeType, Project, ProjectMode } from '../../shared/schema/types.ts';
import { sha256Hex } from '../../shared/digests.ts';
import { createNodeFsOps, isErrno, type FsOps, type FsStats } from './fs-ops.ts';
import { isValidOperationId, isValidProjectId, newOperationId, newProjectId } from './ids.ts';
import { InspectionError } from './media-inspect.ts';
import { inspectMediaBounded } from './inspection-runner.ts';
import type { ReceiptVerification, SaveReceipt } from './receipts.ts';
import {
  AssetNotFoundError,
  AssetRejectedError,
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

const MIME_EXTENSION: Record<AssetMimeType, string> = {
  'audio/wav': 'wav',
  'audio/mpeg': 'mp3',
  'image/png': 'png',
  'image/jpeg': 'jpg',
};

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
  expectedDigest?: string;
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
  /** Validated serialized editor snapshot; omitted only for disk-only callers. */
  text?: string;
  operationId?: string;
}

export interface CopyResult {
  projectId: string;
  receipt: SaveReceipt;
  revision: number;
  digest: string;
  missingAssets: string[];
}

export interface ImportArgs {
  /** Bytes or text of an external `project.json` chosen by the user. */
  text: string | Uint8Array;
  /**
   * `reject` (default) refuses to reuse an existing projectId; `copy` publishes
   * the import under a fresh identity instead of overwriting anything.
   */
  collision?: 'reject' | 'copy';
}

export interface ImportResult {
  projectId: string;
  receipt: SaveReceipt;
  revision: number;
  digest: string;
  mode: ProjectMode;
  /** Manifest asset IDs whose file is not present in the imported folder. */
  missingAssets: string[];
  /** True when a non-null approval was cleared and the revision bumped. */
  approvalCleared: boolean;
  /** True when the import landed under a new projectId due to a collision. */
  importedAsCopy: boolean;
}

export interface RelinkArgs {
  expectedRevision?: number;
  expectedDigest?: string;
  projectId: string;
  assetId: string;
  bytes: Uint8Array;
  /** Declared MIME type; it must equal the manifest entry and the real container. */
  mimeType: AssetMimeType;
  /** Required to replace content whose recorded hash differs. */
  confirmReplace?: boolean;
}

export interface RelinkResult {
  projectId: string;
  /** Asset ID after the operation: a replacement mints a new one. */
  assetId: string;
  /** Asset ID the caller asked to relink. */
  previousAssetId: string;
  /** True when different content was accepted explicitly and references moved. */
  replaced: boolean;
  revision: number;
  digest: string;
  /** Null when the file was restored without changing the document. */
  receipt: SaveReceipt | null;
  missingAssets: string[];
  asset: Asset;
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
  readonly #copyOperations = new Map<string, { fingerprint: string; result: CopyResult }>();
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
            // Corrupt canonical JSON must not hide crash recovery evidence.
            // Report leftovers without parsing or promoting their contents.
            orphanTemps: await this.#scanTemps(this.#projectDir(projectId)),
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

  /** Reads only a manifest-declared asset through the existing workspace boundary. */
  async readAsset(projectId: string, assetId: string): Promise<{ asset: Asset; bytes: Uint8Array }> {
    this.#assertReady();
    assertValidProjectId(projectId);
    const loaded = await this.#readBytes(projectId);
    const asset = loaded.project.assets.find((entry) => entry.assetId === assetId);
    if (asset === undefined) throw new AssetNotFoundError(projectId, assetId);
    const path = await this.#existingAssetPath(projectId, asset.path);
    if (path === null) throw new AssetNotFoundError(projectId, assetId);
    let bytes: Uint8Array;
    try {
      bytes = await this.#fs.readFile(path);
    } catch (error) {
      if (isErrno(error, 'ENOENT')) throw new AssetNotFoundError(projectId, assetId);
      throw error;
    }
    if (bytes.byteLength !== asset.byteLength || (asset.sha256 !== null && await sha256Hex(bytes) !== asset.sha256)) {
      throw new ConflictError({ projectId, assetId, reason: 'asset-content' });
    }
    return { asset, bytes };
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
    if (args.expectedDigest !== undefined && !/^[a-f0-9]{64}$/.test(args.expectedDigest)) {
      throw new InvalidArgumentError('expectedDigest must be a lowercase SHA-256 digest');
    }
    const project = this.#assertEditablePayload(args.project, args.projectId);

    const bytes = this.#encode(project);
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
      const expectedDigest = args.expectedDigest ?? (lastSeen?.revision === args.expectedRevision ? lastSeen.digest : undefined);
      if (expectedDigest !== undefined && expectedDigest !== current.digest) {
        throw new ConflictError({
          projectId: args.projectId,
          reason: 'digest',
          expectedDigest,
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
    if (args.operationId !== undefined && !isValidOperationId(args.operationId)) throw new InvalidOperationIdError(args.operationId);
    // A supplied recovery snapshot is independent of damaged canonical JSON.
    // The authorized source directory and every asset remain path-checked.
    let snapshot: Project;
    if (args.text !== undefined) {
      const parsed = parseProjectText(args.text);
      if (!parsed.ok) throw new InvalidProjectError(args.projectId, parsed.failure, parsed.issues);
      if (parsed.project.projectId !== args.projectId) throw new InvalidArgumentError('copy snapshot projectId must match source');
      snapshot = parsed.project;
      await this.#checkProjectDirectory(args.projectId);
      const file = this.#projectFile(args.projectId);
      const stats = await this.#lstatOrNull(file);
      if (stats !== null && (stats.isSymbolicLink() || !stats.isFile())) {
        throw new UnsafePathError(file, 'project.json must be a plain regular file');
      }
    } else {
      // Disk-only copies still require valid JSON and never refresh lastSeen.
      snapshot = (await this.#readBytes(args.projectId)).project;
    }

    const fingerprint = await sha256Hex(new TextEncoder().encode(JSON.stringify({
      newProjectId: args.newProjectId, text: serializeProject(snapshot),
    })));
    const operationKey = args.operationId === undefined ? undefined : receiptKeyOf(args.projectId, args.operationId);
    return this.#withWorkspace(async () => {
      const previous = operationKey === undefined ? undefined : this.#copyOperations.get(operationKey);
      if (previous !== undefined) {
        if (previous.fingerprint !== fingerprint) throw new ConflictError({ projectId: args.projectId, reason: 'operation', operationId: args.operationId });
        return previous.result;
      }
      const stage = await this.#createStageDir(args.newProjectId);
      try {
        // A copy gets a fresh identity: new projectId, revision 0, new dates
        // and a cleared approval (project-format.md: portable copy rules).
        const copyProject: Project = {
          ...snapshot,
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
        await this.#fs.syncFile(join(stage.dir, PROJECT_FILE));

        const missingAssets = await this.#copyAssetsIntoStage(args.projectId, snapshot, stage.dir);
        if (snapshot.assets.length > 0) await this.#fs.syncDir(join(stage.dir, ASSETS_DIR));
        await this.#fs.syncDir(stage.dir);

        const target = this.#projectDir(stage.projectId);
        if ((await this.#lstatOrNull(target)) !== null) {
          throw new ProjectExistsError(stage.projectId);
        }
        await this.#fs.rename(stage.dir, target);
        stage.renamed = true;
        let uncertain = false;
        await this.#fs.syncDir(this.#root).catch(() => { uncertain = true; });

        // Verify the published bytes were the stage bytes, never a partial copy.
        const published = await this.#fs.readFile(this.#projectFile(stage.projectId));
        if ((await sha256Hex(published)) !== digest) {
          throw new CommitVerificationError(stage.projectId, digest, await sha256Hex(published));
        }

        const receipt: SaveReceipt = {
          projectId: stage.projectId,
          revision: 0,
          digest,
          operationId: args.operationId ?? newOperationId(),
          committedAt: this.#isoNow(),
          sync: uncertain ? 'uncertain' : 'confirmed',
        };
        this.#remember(stage.projectId, 0, digest);
        const result: CopyResult = {
          projectId: stage.projectId,
          receipt,
          revision: 0,
          digest,
          missingAssets,
        };
        if (operationKey !== undefined) this.#copyOperations.set(operationKey, { fingerprint, result });
        return result;
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

  //#region import

  /**
   * Imports an external schema-1 document into the workspace
   * (project-format.md, "Importar, reubicar y resolver faltantes").
   *
   * - Bytes are validated with the same parser used for disk reads, so hostile
   *   keys, depth, size and schema violations never reach the workspace.
   * - The document is published by renaming a staging directory; a failure
   *   leaves the previous state untouched.
   * - An existing projectId is never overwritten: the caller chooses `reject`
   *   or `copy` (fresh identity, revision 0, fresh dates).
   * - A non-null approval is cleared with a recorded edit (revision + date)
   *   because a seal from another workspace is not local editorial trust.
   * - Assets are not embedded in JSON: declared assets without a file are
   *   reported as missing and can be relinked later.
   */
  async importProject(args: ImportArgs): Promise<ImportResult> {
    this.#assertReady();
    const collision = args.collision ?? 'reject';
    if (collision !== 'reject' && collision !== 'copy') {
      throw new InvalidArgumentError("collision must be 'reject' or 'copy'");
    }
    const text = typeof args.text === 'string' ? new TextEncoder().encode(args.text) : args.text;
    const outcome = parseProjectText(text);
    if (!outcome.ok) {
      throw new InvalidProjectError('import', outcome.failure, outcome.issues);
    }
    const incoming = outcome.project;
    const approvalCleared = incoming.approval !== null;

    return this.#withWorkspace(async () => {
      const exists = (await this.#lstatOrNull(this.#projectDir(incoming.projectId))) !== null;
      if (exists && collision === 'reject') {
        throw new ProjectExistsError(incoming.projectId);
      }

      const projectId = exists ? await this.#freeProjectDirName() : incoming.projectId;
      const now = this.#isoNow();
      let project: Project;
      if (exists) {
        project = {
          ...incoming,
          projectId,
          revision: 0,
          createdAt: now,
          updatedAt: now,
          approval: null,
        };
      } else if (approvalCleared) {
        project = {
          ...incoming,
          approval: null,
          revision: incoming.revision + 1,
          updatedAt: now < incoming.updatedAt ? incoming.updatedAt : now,
        };
      } else {
        project = incoming;
      }

      // Validate the serialized wire shape, not the parser's internal inert
      // wrapper: otherwise an unknown visual is wrapped twice and a source
      // at the valid depth limit is incorrectly rejected.
      const bytes = this.#encode(project);
      const validated = parseProjectText(bytes);
      if (!validated.ok) {
        throw new InvalidProjectError(projectId, validated.failure, validated.issues);
      }

      if (bytes.length > LIMITS.maxJsonBytes) {
        throw new InvalidProjectError(projectId, 'too-large', [
          { path: '$', code: 'too-large', message: `project exceeds ${LIMITS.maxJsonBytes} bytes` },
        ]);
      }
      const digest = await sha256Hex(bytes);

      const stage = await this.#mkdirStage(projectId);
      try {
        await this.#fs.mkdir(join(stage.dir, ASSETS_DIR), { recursive: false });
        const stagedFile = join(stage.dir, PROJECT_FILE);
        await this.#fs.writeFile(stagedFile, bytes);
        await this.#fs.syncFile(stagedFile);
        await this.#fs.syncDir(join(stage.dir, ASSETS_DIR));
        await this.#fs.syncDir(stage.dir);

        const target = this.#projectDir(projectId);
        if ((await this.#lstatOrNull(target)) !== null) {
          throw new ProjectExistsError(projectId);
        }
        await this.#fs.rename(stage.dir, target);
        stage.renamed = true;
        let uncertain = false;
        await this.#fs.syncDir(this.#root).catch(() => { uncertain = true; });

        const published = await this.#fs.readFile(this.#projectFile(projectId));
        if ((await sha256Hex(published)) !== digest) {
          throw new CommitVerificationError(projectId, digest, await sha256Hex(published));
        }

        const receipt: SaveReceipt = {
          projectId,
          revision: project.revision,
          digest,
          operationId: newOperationId(),
          committedAt: this.#isoNow(),
          sync: uncertain ? 'uncertain' : 'confirmed',
        };
        this.#remember(projectId, project.revision, digest);
        return {
          projectId,
          receipt,
          revision: project.revision,
          digest,
          mode: validated.mode,
          missingAssets: await this.#missingAssets(projectId, project),
          approvalCleared,
          importedAsCopy: exists,
        };
      } finally {
        if (stage.renamed === false) {
          await this.#fs.rm(stage.dir, { recursive: true, force: false }).catch(() => undefined);
        }
      }
    });
  }

  //#endregion import

  //#region relink

  /**
   * Relinks a declared asset with bytes chosen explicitly by the user.
   *
   * - Content is inspected (container signature, audio duration, image
   *   dimensions) before anything is written; metadata is never trusted from
   *   the manifest or the client.
   * - Identical content just restores the file: no document edit, no revision.
   * - Different content requires `confirmReplace`; when confirmed the asset
   *   gets a new assetId, references move, affected scene revisions bump and
   *   the old file is removed only after the document commit.
   * - Media bindings are preserved as historical evidence: relink never
   *   silently certifies that old digests still apply.
   */
  async relinkAsset(args: RelinkArgs): Promise<RelinkResult> {
    this.#assertReady();
    assertValidProjectId(args.projectId);
    if (args.expectedDigest !== undefined && !/^[a-f0-9]{64}$/.test(args.expectedDigest)) {
      throw new InvalidArgumentError('expectedDigest must be a lowercase SHA-256 digest');
    }
    if (!(args.bytes instanceof Uint8Array) || args.bytes.byteLength === 0) {
      throw new InvalidArgumentError('asset bytes must be a non-empty Uint8Array');
    }
    const extension = MIME_EXTENSION[args.mimeType];
    if (extension === undefined) {
      throw new InvalidArgumentError(`unsupported asset mimeType ${JSON.stringify(args.mimeType)}`);
    }

    return this.#withProject(args.projectId, async () => {
      const current = await this.#readBytes(args.projectId);
      if (args.expectedRevision !== undefined && args.expectedRevision !== current.project.revision) {
        throw new ConflictError({ projectId: args.projectId, reason: 'revision', expectedRevision: args.expectedRevision, actualRevision: current.project.revision });
      }
      const expectedDigest = args.expectedDigest ??
        (args.expectedRevision === current.project.revision ? this.#lastSeen.get(args.projectId)?.digest : undefined);
      if (expectedDigest !== undefined && expectedDigest !== current.digest) {
        throw new ConflictError({ projectId: args.projectId, reason: 'digest', expectedDigest, actualDigest: current.digest });
      }
      if (current.mode === 'read-only') {
        throw new ReadOnlyProjectError(args.projectId);
      }
      const asset = current.project.assets.find((entry) => entry.assetId === args.assetId);
      if (asset === undefined) {
        throw new AssetNotFoundError(args.projectId, args.assetId);
      }
      if (asset.mimeType !== args.mimeType) {
        throw new AssetRejectedError(
          'mime-mismatch',
          `asset "${asset.assetId}" is declared ${asset.mimeType}, not ${args.mimeType}`,
        );
      }

      let inspection;
      try {
        inspection = await inspectMediaBounded(args.bytes, args.mimeType);
      } catch (error) {
        if (error instanceof InspectionError) {
          throw new AssetRejectedError(error.reason, error.message);
        }
        throw error;
      }

      const sha256 = await sha256Hex(args.bytes);
      const existing = await this.#existingAssetPath(args.projectId, asset.path);
      const previousHash = asset.sha256 ?? (existing === null ? null : await sha256Hex(await this.#fs.readFile(existing)));
      const contentChanged = previousHash !== null && previousHash !== sha256;
      if (contentChanged && args.confirmReplace !== true) {
        throw new ConflictError({
          projectId: args.projectId,
          reason: 'asset-content',
          assetId: asset.assetId,
        });
      }

      const nextAssetId = contentChanged ? this.#freeAssetId(current.project) : asset.assetId;
      const nextPath = `assets/${nextAssetId}.${extension}`;
      const nextAsset: Asset = {
        ...asset,
        assetId: nextAssetId,
        path: nextPath,
        byteLength: args.bytes.byteLength,
        sha256,
        durationMs: inspection.durationMs,
      };

      const metadataChanged =
        asset.sha256 === null ||
        asset.byteLength !== nextAsset.byteLength ||
        asset.durationMs !== nextAsset.durationMs;
      const assertSnapshotUnchanged = async () => {
        const fresh = await this.#readBytes(args.projectId);
        if (fresh.digest !== current.digest) {
          throw new ConflictError({ projectId: args.projectId, reason: 'digest', expectedDigest: current.digest, actualDigest: fresh.digest });
        }
      };
      if (!contentChanged && !metadataChanged) {
        await assertSnapshotUnchanged();
        await this.#writeAssetFile(args.projectId, nextPath, args.bytes);
        return {
          projectId: args.projectId,
          assetId: asset.assetId,
          previousAssetId: args.assetId,
          replaced: false,
          revision: current.project.revision,
          digest: current.digest,
          receipt: null,
          missingAssets: await this.#missingAssets(args.projectId, current.project),
          asset: nextAsset,
        };
      }

      const now = this.#isoNow();
      const project: Project = {
        ...current.project,
        revision: current.project.revision + 1,
        updatedAt: now < current.project.updatedAt ? current.project.updatedAt : now,
        assets: current.project.assets.map((entry) =>
          entry.assetId === asset.assetId ? nextAsset : entry,
        ),
        scenes: contentChanged
          ? current.project.scenes.map((scene) =>
              scene.audio?.assetId === asset.assetId
                ? { ...scene, revision: scene.revision + 1, audio: { ...scene.audio, assetId: nextAssetId } }
                : scene,
            )
          : current.project.scenes,
      };

      const validated = validateProject(project);
      if (!validated.ok) {
        throw new InvalidProjectError(args.projectId, 'invalid-schema', validated.issues);
      }

      const bytes = this.#encode(project);
      if (bytes.byteLength > LIMITS.maxJsonBytes) {
        throw new InvalidArgumentError('updated project exceeds the JSON byte limit');
      }
      const digest = await sha256Hex(bytes);
      // Validate the complete document before publishing any selected bytes.
      const targetExisted = (await this.#existingAssetPath(args.projectId, nextPath)) !== null;
      let receipt: SaveReceipt;
      try {
        await assertSnapshotUnchanged();
        await this.#writeAssetFile(args.projectId, nextPath, args.bytes);
        await assertSnapshotUnchanged();
        receipt = await this.#commitOver({
          projectId: args.projectId,
          bytes,
          digest,
          revision: project.revision,
          operationId: newOperationId(),
        });
      } catch (error) {
        // Delete only a new file when a reread proves the old document is
        // still authoritative. A post-rename read failure is ambiguous: keep
        // both files rather than destroying bytes the published JSON may use.
        if (!targetExisted) {
          const after = await this.#readBytes(args.projectId).catch(() => null);
          if (after?.digest === current.digest) {
            await this.#checkAssetsDir(args.projectId);
            await this.#fs.unlink(join(this.#projectDir(args.projectId), nextPath)).catch(() => undefined);
          }
        }
        throw error;
      }
      this.#remember(args.projectId, project.revision, receipt.digest);

      if (contentChanged && receipt.sync === 'confirmed') {
        // The old file is unreferenced only after the new document is durable.
        await this.#fs
          .unlink(join(this.#projectDir(args.projectId), asset.path))
          .catch(() => undefined);
      }

      return {
        projectId: args.projectId,
        assetId: nextAssetId,
        previousAssetId: args.assetId,
        replaced: contentChanged,
        revision: project.revision,
        digest: receipt.digest,
        receipt,
        missingAssets: await this.#missingAssets(args.projectId, project),
        asset: nextAsset,
      };
    });
  }

  //#endregion relink

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

  async #checkProjectDirectory(projectId: string): Promise<void> {
    const dir = this.#projectDir(projectId);
    const stats = await this.#lstatOrNull(dir);
    if (stats === null) throw new ProjectNotFoundError(projectId);
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new UnsafePathError(dir, 'project entry must be a plain directory');
    }
    if (await this.#fs.realpath(dir) !== join(this.#root, projectId)) {
      throw new UnsafePathError(dir, 'project directory resolves outside the workspace');
    }
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
    if (!(await this.#checkAssetsDir(projectId))) return null;
    const file = join(this.#projectDir(projectId), assetPath);
    const stats = await this.#lstatOrNull(file);
    if (stats === null || stats.isSymbolicLink() || !stats.isFile()) return null;
    return file;
  }

  async #checkAssetsDir(projectId: string): Promise<boolean> {
    const dir = join(this.#projectDir(projectId), ASSETS_DIR);
    const stats = await this.#lstatOrNull(dir);
    if (stats === null) return false;
    if (stats.isSymbolicLink() || !stats.isDirectory() || await this.#fs.realpath(dir) !== dir) {
      throw new UnsafePathError(dir, 'assets must be a plain directory inside the project');
    }
    return true;
  }

  async #missingAssets(projectId: string, project: Project): Promise<string[]> {
    const missing: string[] = [];
    for (const asset of project.assets) {
      if ((await this.#existingAssetPath(projectId, asset.path)) === null) missing.push(asset.assetId);
    }
    return missing;
  }

  /** Fresh asset ID (`a-<12 hex>`) that does not collide inside the project. */
  #freeAssetId(project: Project): string {
    const used = new Set(project.assets.map((asset) => asset.assetId));
    for (let attempt = 0; attempt < NAME_ATTEMPTS; attempt += 1) {
      const candidate = `a-${newOperationId().slice(3).replaceAll('-', '').slice(0, 12)}`;
      if (!used.has(candidate)) return candidate;
    }
    throw new StoreError('workspace-exhausted', 'could not allocate a unique assetId');
  }

  /**
   * Writes asset bytes through a temp file in `assets/` and an atomic rename,
   * so a crash never leaves a truncated file under a referenced path.
   */
  async #writeAssetFile(projectId: string, assetPath: string, bytes: Uint8Array): Promise<void> {
    const filename = assetFilename(assetPath);
    const assetsDir = join(this.#projectDir(projectId), ASSETS_DIR);
    if (!(await this.#checkAssetsDir(projectId))) {
      await this.#fs.mkdir(assetsDir, { recursive: false });
    }
    const target = join(assetsDir, filename);
    const temp = join(assetsDir, `.tmp-${newOperationId()}`);
    try {
      await this.#fs.writeFileExclusive(temp, bytes);
      await this.#fs.syncFile(temp);
      await this.#fs.rename(temp, target);
      // A failure here must not be reported as a successful restoration.
      await this.#fs.syncDir(assetsDir);
      // Also flush assets/'s entry in its parent. Always do this, including
      // retries after a prior mkdir became visible but its parent sync failed.
      await this.#fs.syncDir(this.#projectDir(projectId));
    } catch (error) {
      await this.#fs.unlink(temp).catch(() => undefined);
      if (error instanceof StoreError) throw error;
      throw new StoreCommitError('write', error instanceof Error ? error.message : String(error), {
        cause: error,
        tempPath: temp,
      });
    }
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
    await this.#checkProjectDirectory(projectId);

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
      raw: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes),
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

  #assertEditablePayload(project: Project, projectId: string): Project {
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
    return result.project;
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
      await this.#fs.syncFile(targetPath);
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
