import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectStore } from '../../../src/companion/store/project-store.ts';
import { InvalidProjectError, StoreCommitError, UnsafePathError } from '../../../src/companion/store/errors.ts';
import { serializeProject } from '../../../src/shared/schema/serialize.ts';
import { sha256Hex } from '../../../src/shared/digests.ts';
import { fixtureText } from '../../helpers/fixtures.ts';
import { wavBytes } from '../../helpers/media.ts';
import type { Project } from '../../../src/shared/schema/types.ts';

test('review P2: valid snapshot copy recovers corrupt canonical JSON with real assets and unchanged source', async () => {
  const root = await mkdtemp(join(tmpdir(), 'molecula-corrupt-copy-'));
  const store = new ProjectStore({ workspaceRoot: root });
  await store.init();
  try {
    const created = await store.createProject();
    const bytes = wavBytes();
    const draft: Project = { ...created.project, idea: 'Recover this unsaved draft', assets: [{
      assetId: 'voice', path: 'assets/voice.wav', kind: 'audio', mimeType: 'audio/wav', byteLength: bytes.length,
      durationMs: 1000, sha256: await sha256Hex(bytes), source: { origin: 'fixture', license: 'CC0', attribution: '' },
    }] };
    await writeFile(join(root, created.projectId, 'assets', 'voice.wav'), bytes);
    const file = join(root, created.projectId, 'project.json');
    await writeFile(file, '{truncated');
    const copy = await store.saveCopy({ projectId: created.projectId, text: serializeProject(draft) });
    assert.equal((await store.readProject(copy.projectId)).project.idea, draft.idea);
    assert.deepEqual(await readFile(join(root, copy.projectId, 'assets', 'voice.wav')), Buffer.from(bytes));
    assert.equal(await readFile(file, 'utf8'), '{truncated');
    await assert.rejects(store.saveCopy({ projectId: created.projectId }), InvalidProjectError);
    await assert.rejects(store.saveCopy({ projectId: created.projectId, text: '{invalid' }), InvalidProjectError);
    assert.equal((await readdir(root)).filter((name) => !name.startsWith('.')).length, 2);
  } finally { await store.close(); await rm(root, { recursive: true, force: true }); }
});

test('review P2: corrupt-source recovery still rejects source/asset symlinks and wrong asset hashes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'molecula-recovery-paths-'));
  const store = new ProjectStore({ workspaceRoot: root });
  await store.init();
  try {
    const created = await store.createProject();
    const dir = join(root, created.projectId);
    const held = join(root, '.held-source');
    const draft: Project = { ...created.project, assets: [{ assetId: 'voice', path: 'assets/voice.wav', kind: 'audio',
      mimeType: 'audio/wav', byteLength: 1, durationMs: 1000, sha256: 'a'.repeat(64),
      source: { origin: 'fixture', license: 'CC0', attribution: '' } }] };
    const request = { projectId: created.projectId, text: serializeProject(draft) };
    await writeFile(join(dir, 'project.json'), '{truncated');
    await rename(dir, held);
    await symlink(held, dir);
    await assert.rejects(store.saveCopy(request), UnsafePathError);
    await unlink(dir);
    await rename(held, dir);
    await rename(join(dir, 'assets'), join(root, '.held-assets'));
    await symlink(join(root, '.held-assets'), join(dir, 'assets'));
    await assert.rejects(store.saveCopy(request), UnsafePathError);
    await unlink(join(dir, 'assets'));
    await rename(join(root, '.held-assets'), join(dir, 'assets'));
    await writeFile(join(dir, 'assets', 'voice.wav'), 'x');
    await assert.rejects(store.saveCopy(request), (error: unknown) => error instanceof StoreCommitError && error.phase === 'copy');
    const json = join(dir, 'project.json');
    await rename(json, join(dir, '.held-json'));
    await symlink(join(dir, '.held-json'), json);
    await assert.rejects(store.saveCopy(request), UnsafePathError);
    await unlink(json);
    await rename(join(dir, '.held-json'), json);
    assert.equal((await readdir(root)).filter((name) => name.startsWith('p-')).length, 1);
    assert.equal(await readFile(join(dir, 'project.json'), 'utf8'), '{truncated');
  } finally { await store.close(); await rm(root, { recursive: true, force: true }); }
});

test('review P2: read result raw text re-encodes exactly to accepted UTF-8 BOM bytes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'molecula-bom-read-'));
  const store = new ProjectStore({ workspaceRoot: root });
  await store.init();
  try {
    const imported = await store.importProject({ text: fixtureText('unknown-style') });
    const file = join(root, imported.projectId, 'project.json');
    const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), await readFile(file)]);
    await writeFile(file, bytes);
    const loaded = await store.readProject(imported.projectId);
    assert.equal(loaded.mode, 'read-only');
    assert.equal(loaded.digest, await sha256Hex(bytes));
    assert.deepEqual(Buffer.from(loaded.raw, 'utf8'), bytes);
    assert.deepEqual(await readFile(file), bytes);
  } finally { await store.close(); await rm(root, { recursive: true, force: true }); }
});

test('review gap: restarting companion loses receipt memory but retries never overwrite or duplicate', async () => {
  const root = await mkdtemp(join(tmpdir(), 'molecula-restart-retry-'));
  let store = new ProjectStore({ workspaceRoot: root });
  await store.init();
  try {
    const created = await store.createProject();
    const save = { projectId: created.projectId, expectedRevision: 0, expectedDigest: created.digest,
      operationId: 'op-restart-save', project: { ...created.project, revision: 1, idea: 'Committed snapshot' } };
    await store.saveProject(save);
    const copy = { projectId: created.projectId, newProjectId: 'p-restart-copy', operationId: 'op-restart-copy',
      text: serializeProject(save.project) };
    await store.saveCopy(copy);
    const originalBytes = await readFile(join(root, created.projectId, 'project.json'));
    const copiedBytes = await readFile(join(root, 'p-restart-copy', 'project.json'));
    await store.close();
    store = new ProjectStore({ workspaceRoot: root });
    await store.init();
    await assert.rejects(store.saveProject(save), { code: 'conflict' });
    await assert.rejects(store.saveCopy(copy), { code: 'project-exists' });
    assert.deepEqual(await readFile(join(root, created.projectId, 'project.json')), originalBytes);
    assert.deepEqual(await readFile(join(root, 'p-restart-copy', 'project.json')), copiedBytes);
    assert.equal((await readdir(root)).filter((name) => name.startsWith('p-')).length, 2);
  } finally { await store.close(); await rm(root, { recursive: true, force: true }); }
});
