import test from 'node:test';
import assert from 'node:assert/strict';

import { mkdtemp, mkdir, readdir, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Asset, Project } from '../../../src/shared/schema/types.ts';
import { sha256Hex } from '../../../src/shared/digests.ts';
import { serializeProject } from '../../../src/shared/schema/serialize.ts';
import { parseProjectText } from '../../../src/shared/schema/parse.ts';
import {
  CommitVerificationError,
  ConflictError,
  InvalidArgumentError,
  InvalidOperationIdError,
  InvalidProjectError,
  ProjectExistsError,
  ReadOnlyProjectError,
  StoreCommitError,
  UnsafePathError,
  WorkspaceLockedError,
} from '../../../src/companion/store/errors.ts';
import { createNodeFsOps, type FsOps } from '../../../src/companion/store/fs-ops.ts';
import { ProjectStore } from '../../../src/companion/store/project-store.ts';
import type { SaveReceipt } from '../../../src/companion/store/receipts.ts';

//#region helpers

const createdRoots: string[] = [];
let operationCounter = 0;

function nextOperationId(prefix: string): string {
  operationCounter += 1;
  return `${prefix}-${operationCounter}`;
}

async function tempWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'molecula-store-'));
  createdRoots.push(root);
  return root;
}

async function newStore(root: string, options?: { forceUnlock?: boolean }): Promise<ProjectStore> {
  const store = new ProjectStore({ workspaceRoot: root });
  await store.init({ forceUnlock: options?.forceUnlock });
  return store;
}

/** Returns a mutable draft: updatedAt always moves forward (schema rule). */
function edited(base: Project, mutate: (p: Project) => void): Project {
  const cloned = structuredClone(base) as Project;
  mutate(cloned);
  const baseMs = new Date(base.createdAt).getTime();
  cloned.updatedAt = new Date(baseMs + 1000).toISOString();
  return cloned;
}

/** Bumps the revision like a UI edit would before calling saveProject. */
async function nextDraft(
  store: ProjectStore,
  projectId: string,
  mutate?: (p: Project) => void,
): Promise<{ project: Project; expectedRevision: number }> {
  const current = await store.readProject(projectId);
  const expectedRevision = current.project.revision;
  const project = edited(current.project, (p) => {
    p.revision = expectedRevision + 1;
    mutate?.(p);
  });
  return { project, expectedRevision };
}

/** Writes an asset file and registers it in the manifest (replaces same id). */
async function withAsset(store: ProjectStore, projectId: string, root: string, name = 'voz'): Promise<Project> {
  const current = await store.readProject(projectId);
  const bytes = new TextEncoder().encode('fake wav payload for testing');
  const sha = await sha256Hex(bytes);
  const asset: Asset = {
    assetId: name,
    kind: 'audio',
    path: `assets/${name}.wav`,
    mimeType: 'audio/wav',
    byteLength: bytes.byteLength,
    sha256: sha,
    durationMs: 2000,
    source: { origin: 'user', license: 'CC0 1.0', attribution: '' },
  };
  await writeFile(join(root, projectId, 'assets', `${name}.wav`), bytes);
  const project = edited(current.project, (p) => {
    p.revision += 1;
    const existing = p.assets.findIndex((entry) => entry.assetId === name);
    if (existing >= 0) {
      p.assets[existing] = asset;
    } else {
      p.assets.push(asset);
    }
  });
  await store.saveProject({
    projectId,
    project,
    expectedRevision: project.revision - 1,
    operationId: nextOperationId('op-asset'),
  });
  return project;
}

/** True when the path does not exist; rethrows anything else. */
async function pathMissing(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true;
    throw error;
  }
}

//#endregion helpers

test.after(async () => {
  await Promise.all(createdRoots.map((root) => rm(root, { recursive: true, force: true })));
});

test('create, read and list roundtrip an empty project with real disk bytes', async () => {
  const root = await tempWorkspace();
  const store = await newStore(root);
  const created = await store.createProject({ title: 'El armario' });
  assert.ok(created.projectId.startsWith('p-'));
  assert.equal(created.revision, 0);

  const raw = await readFile(join(root, created.projectId, 'project.json'), 'utf8');
  const parsed = parseProjectText(raw);
  assert.ok(parsed.ok && parsed.project.projectId === created.projectId);
  assert.equal(serializeProject(created.project), raw);

  const summaries = await store.listProjects();
  assert.equal(summaries.length, 1);
  assert.equal(summaries[0]?.projectId, created.projectId);
  assert.equal(summaries[0]?.title, 'El armario');
  assert.equal(summaries[0]?.mode, 'editable');
  assert.deepEqual(summaries[0]?.missingAssets, []);
  assert.deepEqual(summaries[0]?.orphanTemps, []);

  const reopened = await store.readProject(created.projectId);
  assert.equal(reopened.revision, 0);
  assert.equal(reopened.mode, 'editable');
  assert.equal(reopened.digest, created.digest);
  await store.close();
});

test('saveProject writes atomically and revisions advance one per save', async () => {
  const root = await tempWorkspace();
  const store = await newStore(root);
  const created = await store.createProject();

  const op1 = await store.saveProject({
    projectId: created.projectId,
    project: edited(created.project, (p) => {
      p.revision = 1;
      p.idea = 'Por qué se afloja una tuerca';
    }),
    expectedRevision: 0,
    operationId: 'op-save-1',
  });
  assert.equal(op1.receipt.sync, 'confirmed');
  assert.equal(op1.revision, 1);

  const bytes1 = await readFile(join(root, created.projectId, 'project.json'));
  const parsed1 = parseProjectText(bytes1);
  assert.ok(parsed1.ok && parsed1.project.idea === 'Por qué se afloja una tuerca');

  const op2 = await store.saveProject({
    projectId: created.projectId,
    project: edited(created.project, (p) => {
      p.revision = 2;
      p.idea = 'Por qué se afloja una tuerca y por qué el motor se calienta';
    }),
    expectedRevision: 1,
    operationId: 'op-save-2',
  });
  assert.equal(op2.revision, 2);
  const bytes2 = await readFile(join(root, created.projectId, 'project.json'));
  const parsed2 = parseProjectText(bytes2);
  assert.ok(parsed2.ok && parsed2.project.revision === 2);
  await store.close();
});

test('idempotent replay of the same operationId returns the identical receipt without rewriting', async () => {
  const root = await tempWorkspace();
  const store = await newStore(root);
  const created = await store.createProject();
  const payload = edited(created.project, (p) => {
    p.revision = 1;
    p.title = 'Idempotente';
  });

  const first = await store.saveProject({
    projectId: created.projectId,
    project: payload,
    expectedRevision: 0,
    operationId: 'op-idem',
  });
  const before = await readFile(join(root, created.projectId, 'project.json'));

  const second = await store.saveProject({
    projectId: created.projectId,
    project: structuredClone(payload),
    expectedRevision: 0,
    operationId: 'op-idem',
  });
  assert.equal(second.receipt.digest, first.receipt.digest);
  assert.equal(second.receipt.operationId, first.receipt.operationId);
  assert.equal(second.revision, first.revision);
  const after = await readFile(join(root, created.projectId, 'project.json'));
  assert.deepEqual(after, before);
  await store.close();
});

test('replaying the same operationId with different content conflicts without touching disk', async () => {
  const root = await tempWorkspace();
  const store = await newStore(root);
  const created = await store.createProject();
  await store.saveProject({
    projectId: created.projectId,
    project: edited(created.project, (p) => {
      p.revision = 1;
      p.title = 'Original';
    }),
    expectedRevision: 0,
    operationId: 'op-clash',
  });
  const before = await readFile(join(root, created.projectId, 'project.json'));

  await assert.rejects(
    store.saveProject({
      projectId: created.projectId,
      project: edited(created.project, (p) => {
        p.revision = 1;
        p.title = 'Otro contenido distinto';
      }),
      expectedRevision: 1,
      operationId: 'op-clash',
    }),
    (error: unknown) => error instanceof ConflictError && error.reason === 'operation',
  );
  assert.deepEqual(await readFile(join(root, created.projectId, 'project.json')), before);
  await store.close();
});

test('stale expectedRevision and external-digest drift conflict without overwriting', async () => {
  const root = await tempWorkspace();
  const store = await newStore(root);
  const created = await store.createProject();

  // Another writer advances the disk to revision 1.
  await store.saveProject({
    projectId: created.projectId,
    project: edited(created.project, (p) => {
      p.revision = 1;
      p.title = 'Revision 1';
    }),
    expectedRevision: 0,
    operationId: 'op-advance',
  });

  // A stale writer still believes the disk is at revision 0.
  await assert.rejects(
    store.saveProject({
      projectId: created.projectId,
      project: edited(created.project, (p) => {
        p.revision = 1;
        p.title = 'Escritor atrasado';
      }),
      expectedRevision: 0,
      operationId: 'op-stale',
    }),
    (error: unknown) => error instanceof ConflictError && error.reason === 'revision',
  );

  // An external tool edits the file keeping revision 1 but changing bytes.
  const drifted = edited(created.project, (p) => {
    p.revision = 1;
    p.idea = 'Editado por una herramienta exterior no cooperativa';
  });
  await writeFile(join(root, created.projectId, 'project.json'), new TextEncoder().encode(serializeProject(drifted)));

  // The companion observed revision 1 but is blind to the drift: digest conflict.
  await assert.rejects(
    store.saveProject({
      projectId: created.projectId,
      project: edited(created.project, (p) => {
        p.revision = 2;
        p.title = 'Escritura ciega';
      }),
      expectedRevision: 1,
      operationId: 'op-blind',
    }),
    (error: unknown) => error instanceof ConflictError && error.reason === 'digest',
  );

  const untouched = await readFile(join(root, created.projectId, 'project.json'), 'utf8');
  assert.ok(untouched.includes('no cooperativa'));
  await store.close();
});

test('two concurrent saves serialize: exactly one wins, the other conflicts, disk stays valid', async () => {
  const root = await tempWorkspace();
  const store = await newStore(root);
  const created = await store.createProject();

  const build = (op: string, title: string) => ({
    projectId: created.projectId,
    project: edited(created.project, (p) => {
      p.revision = 1;
      p.title = title;
    }),
    expectedRevision: 0,
    operationId: op,
  });

  const outcome = await Promise.allSettled([
    store.saveProject(build('op-a', 'Escritor A')),
    store.saveProject(build('op-b', 'Escritor B')),
  ]);
  const succeeded = outcome.filter((r) => r.status === 'fulfilled');
  const conflicted = outcome.filter((r) => r.status === 'rejected');
  assert.equal(succeeded.length, 1);
  assert.equal(conflicted.length, 1);
  const bytes = await readFile(join(root, created.projectId, 'project.json'));
  const parsed = parseProjectText(bytes);
  assert.ok(parsed.ok && parsed.project.revision === 1);
  assert.ok(parsed.ok && ['Escritor A', 'Escritor B'].includes(parsed.project.title));
  await store.close();
});

test('a second live companion is rejected; only forceUnlock reclaims a stale lock', async () => {
  const root = await tempWorkspace();
  const first = await newStore(root);

  await assert.rejects(newStore(root), (error: unknown) => error instanceof WorkspaceLockedError);

  await first.close();
  const second = await newStore(root);
  await second.close();

  // A lock owned by a dead process blocks a normal start…
  const staleLock = join(root, '.companion.lock');
  await writeFile(staleLock, JSON.stringify({ pid: 2147483647, startedAt: '2020-01-01T00:00:00.000Z' }));
  await assert.rejects(
    newStore(root),
    (error: unknown) => error instanceof WorkspaceLockedError && error.stale === true,
  );
  // …and forceUnlock reclaims it.
  const third = await newStore(root, { forceUnlock: true });
  const lockBytes = JSON.parse(await readFile(staleLock, 'utf8')) as { pid: number };
  assert.equal(lockBytes.pid, process.pid);
  await third.close();
});

test('faults before and after the rename keep the previous file and never fabricate confirmation', async () => {
  const root = await tempWorkspace();
  const faults = {
    failWrite: 0,
    failFsyncFile: 0,
    failRename: 0,
    corruptAfterRename: 0,
    failSyncDirProject: 0,
  };
  const store = new ProjectStore({ workspaceRoot: root, fsOps: faultFsOps(faults) });
  await store.init();
  const created = await store.createProject();
  const goodBytes = await readFile(join(root, created.projectId, 'project.json'));

  const payload1 = edited(created.project, (p) => {
    p.revision = 1;
    p.title = 'Fallo inyectado';
  });
  const call = (op: string, payload: Project) => ({
    projectId: created.projectId,
    project: payload,
    expectedRevision: 0,
    operationId: op,
  });

  faults.failWrite = 1;
  await assert.rejects(store.saveProject(call('op-write', payload1)), StoreCommitError);
  assert.deepEqual(await readFile(join(root, created.projectId, 'project.json')), goodBytes);
  const afterWrite = await readdir(join(root, created.projectId));
  assert.ok(!afterWrite.some((name) => name.startsWith('project.json.tmp-')));

  faults.failFsyncFile = 1;
  await assert.rejects(store.saveProject(call('op-fsync', payload1)), StoreCommitError);
  assert.deepEqual(await readFile(join(root, created.projectId, 'project.json')), goodBytes);

  faults.failRename = 1;
  await assert.rejects(store.saveProject(call('op-rename', payload1)), StoreCommitError);
  assert.deepEqual(await readFile(join(root, created.projectId, 'project.json')), goodBytes);

  // A directory fsync failing AFTER the rename is committed but uncertain.
  faults.failSyncDirProject = 1;
  const uncertain: { receipt: SaveReceipt; revision: number } = await store.saveProject(
    call('op-uncertain', payload1),
  );
  assert.equal(uncertain.receipt.sync, 'uncertain');
  const verification = await store.verifyReceipt({
    projectId: created.projectId,
    receipt: uncertain.receipt,
  });
  assert.equal(verification.confirmed, true);
  assert.equal(verification.revision, 1);

  // Byte corruption after the rename is caught by the verification re-read.
  faults.corruptAfterRename = 1;
  const payload2 = edited(created.project, (p) => {
    p.revision = 2;
    p.title = 'Intento corrupto';
  });
  await assert.rejects(
    store.saveProject({
      projectId: created.projectId,
      project: payload2,
      expectedRevision: 1,
      operationId: 'op-corrupt',
    }),
    (error: unknown) => error instanceof CommitVerificationError,
  );
  await store.close();
});

test('crash leftovers are reported as orphan temps and are never promoted', async () => {
  const root = await tempWorkspace();
  const store = await newStore(root);
  const created = await store.createProject();

  await writeFile(join(root, created.projectId, 'project.json.tmp-op-zombie'), new TextEncoder().encode('{"truncated'));

  const temps = await store.findOrphanTemps();
  assert.deepEqual(temps[created.projectId], ['project.json.tmp-op-zombie']);
  const read = await store.readProject(created.projectId);
  assert.deepEqual(read.orphanTemps, ['project.json.tmp-op-zombie']);

  // A later save must not adopt the temp file as a valid project.
  const saved = await store.saveProject({
    projectId: created.projectId,
    project: edited(created.project, (p) => {
      p.revision = 1;
    }),
    expectedRevision: 0,
    operationId: 'op-after-crash',
  });
  assert.equal(saved.revision, 1);
  const summaries = await store.listProjects();
  assert.equal(summaries.length, 1);
  assert.equal(summaries[0]?.revision, 1);
  await store.close();
});

test('invalid bytes, symlinked project.json and non-directory projects are rejected non-destructively', async () => {
  const root = await tempWorkspace();
  const store = await newStore(root);

  // Broken JSON: listed as unverifiable, reading fails with the parse failure.
  await mkdir(join(root, 'p-broken'), { recursive: true });
  await writeFile(join(root, 'p-broken', 'project.json'), new TextEncoder().encode('{"schemaVersion":1,'));

  // project.json as a symlink (even to a file inside the workspace) is refused.
  const targetFile = join(root, 'outside.json');
  await writeFile(targetFile, 'placeholder');
  await mkdir(join(root, 'p-links'), { recursive: true });
  await symlink(targetFile, join(root, 'p-links', 'project.json'));

  const summaries = await store.listProjects();
  assert.equal(summaries.length, 1);
  const broken = summaries.find((entry) => entry.projectId === 'p-broken');
  assert.ok(broken);
  assert.equal(broken.revision, -1);

  await assert.rejects(
    store.readProject('p-broken'),
    (error: unknown) => error instanceof InvalidProjectError && error.failure === 'invalid-json',
  );
  await assert.rejects(
    store.readProject('p-links'),
    (error: unknown) => error instanceof UnsafePathError,
  );

  // Foreign or hostile names never appear as projects.
  await mkdir(join(root, 'Weird Name'), { recursive: true });
  await mkdir(join(root, '.hidden'), { recursive: true });
  const afterHostile = await store.listProjects();
  assert.equal(afterHostile.length, 1);
  assert.ok(afterHostile.every((entry) => /^p-/.test(entry.projectId)));

  await unlink(join(root, 'p-links', 'project.json')).catch(() => undefined);
  await rm(join(root, 'Weird Name'), { recursive: true, force: true });
  await rm(join(root, '.hidden'), { recursive: true, force: true });
  await store.close();
});

test('read-only projects open but the store refuses to rewrite them', async () => {
  const root = await tempWorkspace();
  const store = await newStore(root);

  const fixtureBytes = await readFile(new URL('../../../fixtures/projects/unknown-style.json', import.meta.url));
  await mkdir(join(root, 'project_future_style'), { recursive: true });
  await writeFile(join(root, 'project_future_style', 'project.json'), fixtureBytes);

  const read = await store.readProject('project_future_style');
  assert.equal(read.mode, 'read-only');
  const summaries = await store.listProjects();
  assert.equal(summaries.find((entry) => entry.projectId === 'project_future_style')?.mode, 'read-only');

  await assert.rejects(
    store.saveProject({
      projectId: 'project_future_style',
      project: read.project,
      expectedRevision: read.revision,
      operationId: 'op-readonly',
    }),
    (error: unknown) => error instanceof ReadOnlyProjectError,
  );
  await store.close();
});

test('saveCopy publishes a portable folder with assets and reports missing files', async () => {
  const root = await tempWorkspace();
  const store = await newStore(root);
  const created = await store.createProject({ title: 'Con activo' });
  await withAsset(store, created.projectId, root);

  const copy = await store.saveCopy({ projectId: created.projectId });
  assert.ok(copy.projectId.startsWith('p-'));
  assert.notEqual(copy.projectId, created.projectId);
  assert.equal(copy.revision, 0);
  assert.deepEqual(copy.missingAssets, []);

  const copiedProject = await store.readProject(copy.projectId);
  assert.equal(copiedProject.mode, 'editable');
  assert.equal(copiedProject.project.projectId, copy.projectId);
  assert.notEqual(copiedProject.project.projectId, created.projectId);
  assert.equal(copiedProject.project.revision, 0);
  assert.equal(copiedProject.project.approval, null);
  const copiedAsset = copiedProject.project.assets.find((entry) => entry.assetId === 'voz');
  assert.ok(copiedAsset && copiedAsset.sha256 !== null);
  const copiedBytes = await readFile(join(root, copy.projectId, 'assets', 'voz.wav'));
  assert.equal(await sha256Hex(copiedBytes), copiedAsset.sha256);

  // The source is untouched by the copy.
  const sourceAfterCopy = await store.readProject(created.projectId);
  assert.equal(sourceAfterCopy.project.revision, 1);
  assert.equal(sourceAfterCopy.project.projectId, created.projectId);

  // Missing asset: still a valid draft, reported, never labelled complete.
  await unlink(join(root, created.projectId, 'assets', 'voz.wav'));
  const partial = await store.saveCopy({ projectId: created.projectId, newProjectId: 'p-partialcopy' });
  assert.deepEqual(partial.missingAssets, ['voz']);
  const partialRead = await store.readProject('p-partialcopy');
  assert.equal(partialRead.project.assets.length, 1);
  assert.ok(await pathMissing(join(root, 'p-partialcopy', 'assets', 'voz.wav')));

  // A second saveCopy with the same explicit ID never overwrites.
  await withAsset(store, created.projectId, root); // restores the asset file
  await assert.rejects(
    store.saveCopy({ projectId: created.projectId, newProjectId: 'p-partialcopy' }),
    (error: unknown) => error instanceof ProjectExistsError,
  );
  assert.equal((await store.readProject('p-partialcopy')).project.revision, 0);
  await store.close();
});

test('saveCopy refuses to silently substitute assets whose bytes drifted from the recorded hash', async () => {
  const root = await tempWorkspace();
  const store = await newStore(root);
  const created = await store.createProject({ title: 'Hash estricto' });
  await withAsset(store, created.projectId, root);

  await writeFile(join(root, created.projectId, 'assets', 'voz.wav'), new TextEncoder().encode('tampered'));
  await assert.rejects(
    store.saveCopy({ projectId: created.projectId }),
    (error: unknown) => error instanceof StoreCommitError && error.phase === 'copy',
  );

  // The source project stays intact and no staging folder is published.
  const summaries = await store.listProjects();
  assert.ok(summaries.some((entry) => entry.projectId === created.projectId && entry.revision === 1));
  const entries = (await readdir(root)).filter((name) => name.startsWith('.copying-'));
  assert.deepEqual(entries, []);
  await store.close();
});

test('concurrent copy and save serialize without corrupting either outcome', async () => {
  const root = await tempWorkspace();
  const store = await newStore(root);
  const created = await store.createProject();
  const draft = await nextDraft(store, created.projectId, (p) => {
    p.idea = 'Editado en paralelo con la copia';
  });

  const [saved, copied] = await Promise.all([
    store.saveProject({
      projectId: created.projectId,
      project: draft.project,
      expectedRevision: draft.expectedRevision,
      operationId: 'op-parallel-save',
    }),
    store.saveCopy({ projectId: created.projectId }),
  ]);
  assert.equal(saved.revision, 1);
  assert.equal(copied.receipt.sync, 'confirmed');

  // Both outcomes are readable and consistent on disk.
  const sourceRead = await store.readProject(created.projectId);
  assert.equal(sourceRead.project.revision, 1);
  const copyRead = await store.readProject(copied.projectId);
  assert.equal(copyRead.project.revision, 0);
  assert.equal(copyRead.project.projectId, copied.projectId);
  await store.close();
});

test('hostile projectId and operationId inputs are rejected before touching the filesystem', async () => {
  const root = await tempWorkspace();
  const store = await newStore(root);

  // Path-like and grammar-invalid ids are rejected before the payload check.
  await assert.rejects(
    store.saveProject({
      projectId: '../escape',
      project: null as unknown as Project,
      expectedRevision: 0,
      operationId: 'op-x',
    }),
    (error: unknown) => error instanceof InvalidArgumentError,
  );
  await assert.rejects(
    store.saveProject({
      projectId: 'p-A-upper',
      project: null as unknown as Project,
      expectedRevision: 0,
      operationId: 'op-x',
    }),
    (error: unknown) => error instanceof InvalidArgumentError,
  );
  assert.throws(
    () => new ProjectStore({ workspaceRoot: '' }),
    (error: unknown) => error instanceof InvalidArgumentError,
  );
  await store.close();
});

test('the store refuses operation ids that could not stay inside a temp file name', async () => {
  const root = await tempWorkspace();
  const store = await newStore(root);
  const created = await store.createProject();

  for (const badOperationId of ['../escape', 'op with spaces', 'op. liaison', '']) {
    await assert.rejects(
      store.saveProject({
        projectId: created.projectId,
        project: edited(created.project, (p) => {
          p.revision = 1;
        }),
        expectedRevision: 0,
        operationId: badOperationId,
      }),
      (error: unknown) => error instanceof InvalidOperationIdError || error instanceof InvalidArgumentError,
    );
  }
  await store.close();
});

test('saveProject validates the payload before writing anything to disk', async () => {
  const root = await tempWorkspace();
  const store = await newStore(root);
  const created = await store.createProject();
  const before = await readFile(join(root, created.projectId, 'project.json'));

  // Mismatched payload projectId never writes.
  const tampered = structuredClone(created.project) as Project;
  tampered.projectId = 'p-other';
  tampered.revision = 1;
  await assert.rejects(
    store.saveProject({
      projectId: created.projectId,
      project: tampered,
      expectedRevision: 0,
      operationId: 'op-mismatch',
    }),
    (error: unknown) => error instanceof InvalidArgumentError,
  );

  assert.deepEqual(await readFile(join(root, created.projectId, 'project.json')), before);
  await store.close();
});

test('createProject rejects titles outside the 1..120 code-point range', async () => {
  const root = await tempWorkspace();
  const store = await newStore(root);
  await assert.rejects(
    store.createProject({ title: '' }),
    (error: unknown) => error instanceof InvalidArgumentError,
  );
  await assert.rejects(
    store.createProject({ title: 'a'.repeat(121) }),
    (error: unknown) => error instanceof InvalidArgumentError,
  );
  const ok = await store.createProject({ title: 'Nombre válido' });
  assert.equal(ok.project.title, 'Nombre válido');
  await store.close();
});

test('a fresh ProjectStore instance reopens the last committed state after a simulated crash', async () => {
  const root = await tempWorkspace();
  const first = await newStore(root);
  const created = await first.createProject({ title: 'Persistido' });
  await first.saveProject({
    projectId: created.projectId,
    project: edited(created.project, (p) => {
      p.revision = 1;
      p.idea = 'Sobrevive al reinicio';
    }),
    expectedRevision: 0,
    operationId: 'op-restart',
  });
  // No close(): simulates an abrupt process end with a live lock still present.
  const lockPath = join(root, '.companion.lock');
  const lock = JSON.parse(await readFile(lockPath, 'utf8')) as { pid: number };
  assert.equal(lock.pid, process.pid); // the simulated crash ran in this process

  // Once the owner is gone the lock is stale and forceUnlock reclaims it.
  await writeFile(lockPath, JSON.stringify({ pid: 2147483647, startedAt: '2020-01-01T00:00:00.000Z' }));
  const second = await newStore(root, { forceUnlock: true });
  const reopened = await second.readProject(created.projectId);
  assert.equal(reopened.project.idea, 'Sobrevive al reinicio');
  assert.equal(reopened.revision, 1);
  const temps = await second.findOrphanTemps();
  assert.deepEqual(temps[created.projectId], []);
  await second.close();
});

//#region fault injection

interface FaultCounters {
  failWrite: number;
  failFsyncFile: number;
  failRename: number;
  corruptAfterRename: number;
  failSyncDirProject: number;
}

function faultFsOps(faults: FaultCounters): FsOps {
  const real = createNodeFsOps();
  const isProjectDirPath = (path: string) => /p-[a-z0-9_-]+\/assets$/.test(path) || /p-[a-z0-9_-]+$/.test(path);
  return {
    ...real,
    async writeFileExclusive(path, data) {
      if (faults.failWrite > 0) {
        faults.failWrite -= 1;
        throw new Error('simulated write fault');
      }
      return real.writeFileExclusive(path, data);
    },
    async syncFile(path) {
      if (faults.failFsyncFile > 0) {
        faults.failFsyncFile -= 1;
        throw new Error('simulated fsync fault');
      }
      return real.syncFile(path);
    },
    async rename(from, to) {
      if (faults.failRename > 0) {
        faults.failRename -= 1;
        throw new Error('simulated rename fault');
      }
      await real.rename(from, to);
      if (faults.corruptAfterRename > 0 && faults.corruptAfterRename !== undefined) {
        faults.corruptAfterRename -= 1;
        await real.writeFile(to, new TextEncoder().encode(`CORRUPTED-${Date.now()}`));
      }
    },
    async syncDir(path) {
      if (faults.failSyncDirProject > 0 && isProjectDirPath(path)) {
        faults.failSyncDirProject -= 1;
        throw new Error('simulated directory fsync fault');
      }
      return real.syncDir(path);
    },
  };
}

//#endregion fault injection
