import type { Issue, ParseFailure } from '../../shared/schema/types.ts';

/**
 * Typed failures raised by the companion store.
 *
 * Callers use `code` (stable, serializable) instead of matching error
 * messages. Paths and issues are kept on the error so the future loopback API
 * can report them without leaking stack traces.
 */
export class StoreError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
    this.code = code;
  }
}

export class StoreNotInitializedError extends StoreError {
  constructor() {
    super('store-not-initialized', 'ProjectStore.init() must be called before using the store');
  }
}

export class StoreClosedError extends StoreError {
  constructor() {
    super('store-closed', 'ProjectStore is closed');
  }
}

export class WorkspaceLockedError extends StoreError {
  readonly lockPath: string;
  readonly pid: number | null;
  readonly stale: boolean;

  constructor(args: { lockPath: string; pid: number | null; stale: boolean }) {
    const owner = args.pid === null ? 'another process' : `process ${args.pid}`;
    const suffix = args.stale
      ? ' The lock belongs to a process that is no longer running; retry with forceUnlock to reclaim it.'
      : '';
    super('workspace-locked', `workspace is locked by ${owner}.${suffix}`);
    this.lockPath = args.lockPath;
    this.pid = args.pid;
    this.stale = args.stale;
  }
}

export class InvalidProjectIdError extends StoreError {
  readonly projectId: string;

  constructor(projectId: string) {
    super(
      'invalid-project-id',
      `projectId ${JSON.stringify(projectId)} must match [a-z][a-z0-9_-]{0,63}`,
    );
    this.projectId = projectId;
  }
}

export class InvalidOperationIdError extends StoreError {
  readonly operationId: string;

  constructor(operationId: string) {
    super(
      'invalid-operation-id',
      `operationId ${JSON.stringify(operationId)} must match [A-Za-z0-9][A-Za-z0-9_-]{0,63}`,
    );
    this.operationId = operationId;
  }
}

export class InvalidArgumentError extends StoreError {
  constructor(message: string) {
    super('invalid-argument', message);
  }
}

export class InvalidProjectError extends StoreError {
  readonly projectId: string;
  readonly failure: ParseFailure;
  readonly issues: Issue[];

  constructor(projectId: string, failure: ParseFailure, issues: Issue[]) {
    super('invalid-project', `project "${projectId}" is not a valid schema-1 document (${failure})`);
    this.projectId = projectId;
    this.failure = failure;
    this.issues = issues;
  }
}

export class ProjectNotFoundError extends StoreError {
  readonly projectId: string;

  constructor(projectId: string) {
    super('project-not-found', `project "${projectId}" does not exist in this workspace`);
    this.projectId = projectId;
  }
}

export type ConflictReason = 'revision' | 'digest' | 'operation';

export class ConflictError extends StoreError {
  readonly projectId: string;
  readonly reason: ConflictReason;
  readonly expectedRevision?: number;
  readonly actualRevision?: number;
  readonly expectedDigest?: string;
  readonly actualDigest?: string;
  readonly operationId?: string;

  constructor(args: {
    projectId: string;
    reason: ConflictReason;
    expectedRevision?: number;
    actualRevision?: number;
    expectedDigest?: string;
    actualDigest?: string;
    operationId?: string;
  }) {
    super('conflict', conflictMessage(args));
    this.projectId = args.projectId;
    this.reason = args.reason;
    this.expectedRevision = args.expectedRevision;
    this.actualRevision = args.actualRevision;
    this.expectedDigest = args.expectedDigest;
    this.actualDigest = args.actualDigest;
    this.operationId = args.operationId;
  }
}

function conflictMessage(args: {
  projectId: string;
  reason: ConflictReason;
  expectedRevision?: number;
  actualRevision?: number;
  operationId?: string;
}): string {
  if (args.reason === 'operation') {
    return `operationId "${args.operationId ?? ''}" was already committed with a different payload`;
  }
  if (args.reason === 'digest') {
    return `project "${args.projectId}" changed on disk since it was last read`;
  }
  return `project "${args.projectId}" revision changed: expected ${args.expectedRevision ?? '?'}, found ${args.actualRevision ?? '?'}`;
}

export class ReadOnlyProjectError extends StoreError {
  readonly projectId: string;

  constructor(projectId: string) {
    super('read-only-project', `project "${projectId}" is read-only in this runtime`);
    this.projectId = projectId;
  }
}

export class UnsafePathError extends StoreError {
  readonly path: string;

  constructor(path: string, reason = 'path escapes the workspace or is a symbolic link') {
    super('unsafe-path', `unsafe path ${JSON.stringify(path)}: ${reason}`);
    this.path = path;
  }
}

export class ProjectExistsError extends StoreError {
  readonly projectId: string;

  constructor(projectId: string) {
    super('project-exists', `project directory "${projectId}" already exists`);
    this.projectId = projectId;
  }
}

export type CommitPhase = 'write' | 'fsync-file' | 'rename' | 'verify' | 'copy' | 'publish';

export class StoreCommitError extends StoreError {
  readonly phase: CommitPhase;
  readonly tempPath: string | null;

  constructor(
    phase: CommitPhase,
    message: string,
    args?: { cause?: unknown; tempPath?: string },
  ) {
    super('commit-failed', message, args?.cause === undefined ? undefined : { cause: args.cause });
    this.phase = phase;
    this.tempPath = args?.tempPath ?? null;
  }
}

export class CommitVerificationError extends StoreError {
  readonly committed = true;
  readonly projectId: string;
  readonly expectedDigest: string;
  readonly actualDigest: string | null;

  constructor(projectId: string, expectedDigest: string, actualDigest: string | null) {
    super(
      'commit-verification-failed',
      `project "${projectId}" was renamed but its bytes do not match the committed snapshot`,
    );
    this.projectId = projectId;
    this.expectedDigest = expectedDigest;
    this.actualDigest = actualDigest;
  }
}
