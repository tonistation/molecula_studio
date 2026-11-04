import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectStore } from '../../../src/companion/store/project-store.ts';
import { startCompanionServer } from '../../../src/companion/server/http.ts';
import { InvalidArgumentError, InvalidProjectError } from '../../../src/companion/store/errors.ts';
import { serializeProject } from '../../../src/shared/schema/serialize.ts';
import { fixtureJson } from '../../helpers/fixtures.ts';
import { wavBytes } from '../../helpers/media.ts';
import { sha256Hex } from '../../../src/shared/digests.ts';
import type { Project } from '../../../src/shared/schema/types.ts';

test('snapshot copy keeps entity/scene identities and bindings, copies real assets and reports missing ones', async () => {
  const root = await mkdtemp(join(tmpdir(), 'molecula-copy-assets-'));
  const store = new ProjectStore({ workspaceRoot: root });
  await store.init();
  try {
    const created = await store.createProject();
    const draft = fixtureJson('storyboard') as Project;
    draft.projectId = created.projectId;
    const bytes = wavBytes();
    draft.assets = ['present', 'missing'].map((assetId) => ({ assetId, kind: 'audio', path: `assets/${assetId}.wav`,
      mimeType: 'audio/wav', byteLength: bytes.length, sha256: null, durationMs: 1000,
      source: { origin: 'fixture', license: 'CC0', attribution: '' } }));
    draft.assets[0]!.sha256 = await sha256Hex(bytes);
    draft.scenes[0]!.audio = { assetId: 'present', offsetMs: 0, gainDb: 0 };
    draft.scenes[0]!.mediaBindings.audio = { inputDigest: 'b'.repeat(64), outputDigest: 'c'.repeat(64) };
    draft.approval = { approvedRevision: 0, approvedAt: draft.updatedAt, contentDigest: 'a'.repeat(64) };
    await writeFile(join(root, created.projectId, 'assets', 'present.wav'), bytes);
    const before = await readFile(join(root, created.projectId, 'project.json'));
    const result = await store.saveCopy({ projectId: created.projectId, text: serializeProject(draft) });
    const copy = await store.readProject(result.projectId);
    assert.deepEqual(result.missingAssets, ['missing']);
    assert.deepEqual(copy.project.entities, draft.entities);
    assert.deepEqual(copy.project.scenes, draft.scenes);
    assert.deepEqual(copy.project.assets, draft.assets);
    assert.equal(copy.project.approval, null);
    assert.equal(copy.project.revision, 0);
    assert.notEqual(copy.project.createdAt, draft.createdAt);
    assert.notEqual(copy.project.updatedAt, draft.updatedAt);
    assert.deepEqual(await readFile(join(root, result.projectId, 'assets', 'present.wav')), Buffer.from(bytes));
    assert.deepEqual(await readFile(join(root, created.projectId, 'project.json')), before);
  } finally { await store.close(); await rm(root, { recursive: true, force: true }); }
});

test('HTTP copies escaped snapshots idempotently, validates their envelope and carries the explicit save digest', async () => {
  const root = await mkdtemp(join(tmpdir(), 'molecula-copy-http-'));
  const handle = await startCompanionServer({ workspaceRoot: root, token: 'copy-test-token' });
  try {
    const created = await handle.store.createProject();
    const headers = { 'content-type': 'application/json', origin: handle.origin, authorization: `Bearer ${handle.token}` };
    const url = `${handle.origin}/api/projects/${created.projectId}`;
    const payload = { newProjectId: 'p-http-copy', operationId: 'op-http-copy',
      text: '\t'.repeat(1_200_000) + serializeProject({ ...created.project, idea: 'HTTP snapshot' }) };
    const response = await fetch(`${url}/copy`, { method: 'POST', headers, body: JSON.stringify(payload) });
    assert.equal(response.status, 201);
    const copy = await response.json();
    const retry = await fetch(`${url}/copy`, { method: 'POST', headers, body: JSON.stringify(payload) });
    assert.equal(retry.status, 201);
    assert.deepEqual(await retry.json(), copy);
    assert.equal((await handle.store.readProject('p-http-copy')).project.idea, 'HTTP snapshot');
    for (const body of [{ text: 1 }, { operationId: 1 }, { newProjectId: 1 }]) {
      assert.equal((await fetch(`${url}/copy`, { method: 'POST', headers, body: JSON.stringify(body) })).status, 400);
    }
    const external = serializeProject({ ...created.project, idea: 'External' });
    await writeFile(join(root, created.projectId, 'project.json'), external);
    await handle.store.readProject(created.projectId);
    const save = { project: { ...created.project, revision: 1, idea: 'Stale' }, expectedRevision: 0,
      expectedDigest: created.digest, operationId: 'op-http-save' };
    assert.equal((await fetch(url, { method: 'PUT', headers, body: JSON.stringify(save) })).status, 409);
    assert.equal((await fetch(url, { method: 'PUT', headers, body: JSON.stringify({ ...save, expectedDigest: 0 }) })).status, 400);
    assert.equal(await readFile(join(root, created.projectId, 'project.json'), 'utf8'), external);
  } finally { await handle.close(); await rm(root, { recursive: true, force: true }); }
});

test('copy retries reuse the operation and destination after a lost response', async () => {
  const root = await mkdtemp(join(tmpdir(), 'molecula-copy-retry-'));
  const store = new ProjectStore({ workspaceRoot: root });
  await store.init();
  try {
    const created = await store.createProject();
    const args = { projectId: created.projectId, newProjectId: 'p-retry-copy',
      operationId: 'op-copy-retry', text: serializeProject({ ...created.project, idea: 'Sent snapshot' }) };
    const committed = await store.saveCopy(args);
    assert.equal(committed.receipt.operationId, args.operationId);
    const retried = await store.saveCopy(args);
    assert.deepEqual(retried, committed);
    await assert.rejects(store.saveCopy({ ...args, text: serializeProject({ ...created.project, idea: 'Different' }) }), { code: 'conflict' });
    assert.equal((await readdir(root)).filter((entry) => entry.startsWith('p-')).length, 2);
  } finally { await store.close(); await rm(root, { recursive: true, force: true }); }
});

test('save uses the editor digest even if a different reader refreshed the store baseline', async () => {
  const root = await mkdtemp(join(tmpdir(), 'molecula-save-reader-'));
  const store = new ProjectStore({ workspaceRoot: root });
  await store.init();
  try {
    const created = await store.createProject();
    const external = serializeProject({ ...created.project, idea: 'External same revision' });
    await writeFile(join(root, created.projectId, 'project.json'), external);
    await store.readProject(created.projectId);
    await assert.rejects(store.saveProject({ projectId: created.projectId, expectedRevision: 0,
      expectedDigest: created.digest, operationId: 'op-reader-race',
      project: { ...created.project, revision: 1, idea: 'Stale local draft' },
    }), { code: 'conflict' });
    assert.equal(await readFile(join(root, created.projectId, 'project.json'), 'utf8'), external);
  } finally { await store.close(); await rm(root, { recursive: true, force: true }); }
});

test('portable copy preserves an unsaved snapshot despite an external conflict, without touching either source', async () => {
  const root = await mkdtemp(join(tmpdir(), 'molecula-draft-copy-'));
  const store = new ProjectStore({ workspaceRoot: root });
  await store.init();
  try {
    const created = await store.createProject();
    const draft = { ...created.project, idea: 'Unsaved draft', approval: {
      approvedRevision: 0, approvedAt: created.project.updatedAt, contentDigest: 'a'.repeat(64),
    } };
    const external = serializeProject({ ...created.project, idea: 'External edit', revision: 1 });
    await writeFile(join(root, created.projectId, 'project.json'), external);
    const copy = await store.saveCopy({ projectId: created.projectId, text: serializeProject(draft) });
    const saved = await store.readProject(copy.projectId);
    assert.equal(saved.project.idea, 'Unsaved draft');
    assert.equal(saved.project.approval, null);
    assert.equal(saved.project.revision, 0);
    assert.notEqual(saved.project.projectId, created.projectId);
    assert.equal(await readFile(join(root, created.projectId, 'project.json'), 'utf8'), external);
  } finally { await store.close(); await rm(root, { recursive: true, force: true }); }
});

test('copy rejects hostile, oversized and mismatched draft snapshots before publishing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'molecula-draft-invalid-'));
  const store = new ProjectStore({ workspaceRoot: root });
  await store.init();
  try {
    const created = await store.createProject();
    for (const text of ['{"__proto__":{}}', ' '.repeat(2 * 1024 * 1024 + 1)]) {
      await assert.rejects(store.saveCopy({ projectId: created.projectId, text }), InvalidProjectError);
    }
    await assert.rejects(store.saveCopy({ projectId: created.projectId,
      text: serializeProject({ ...created.project, projectId: 'p-other' }),
    }), InvalidArgumentError);
    assert.deepEqual((await readdir(root)).filter((entry) => !entry.startsWith('.')), [created.projectId]);
  } finally { await store.close(); await rm(root, { recursive: true, force: true }); }
});

test('copying a conflict snapshot does not refresh the source save baseline', async () => {
  const root = await mkdtemp(join(tmpdir(), 'molecula-copy-baseline-'));
  const store = new ProjectStore({ workspaceRoot: root });
  await store.init();
  try {
    const created = await store.createProject();
    await writeFile(join(root, created.projectId, 'project.json'), serializeProject({ ...created.project, idea: 'External' }));
    await store.saveCopy({ projectId: created.projectId });
    await assert.rejects(store.saveProject({ projectId: created.projectId, expectedRevision: 0,
      operationId: 'op-after-copy', project: { ...created.project, revision: 1, idea: 'Local' },
    }), { code: 'conflict' });
  } finally { await store.close(); await rm(root, { recursive: true, force: true }); }
});
