import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectStore } from '../../../src/companion/store/project-store.ts';
import { newOperationId } from '../../../src/companion/store/ids.ts';
import { InvalidProjectError } from '../../../src/companion/store/errors.ts';
import { canonicalize } from '../../../src/shared/canonical.ts';
import { sha256Hex } from '../../../src/shared/digests.ts';
import { verifyModelSnapshots } from '../../../src/shared/models/integrity.ts';

const integrityError = (error: unknown) => error instanceof InvalidProjectError
  && error.issues.some(issue => issue.path === '$.models' && issue.message.includes('SHA-256'));

test('project persistence rejects forged and tampered snapshots without writes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'project-model-integrity-'));
  const store = new ProjectStore({ workspaceRoot: root });
  try {
    await store.init();
    const created = await store.createProject();
    const path = join(root, created.projectId, 'project.json');
    const original = await readFile(path, 'utf8');
    assert.equal((await store.readProject(created.projectId)).project.models, undefined);
    const model = { version: 1 as const, name: 'Brain', semanticId: 'brain', parts: [
      { shape: 'sphere' as const, position: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number], scale: [1, 1, 1] as [number, number, number], color: '#ffffff' },
    ] };
    const id = await sha256Hex(canonicalize(model));
    assert.ok(await verifyModelSnapshots([{ id, model }]));
    const project = structuredClone(created.project);
    project.revision++;
    project.models = [{ id: 'a'.repeat(64), model }];
    await assert.rejects(store.saveProject({ projectId: created.projectId, project, expectedRevision: 0, operationId: newOperationId() }), integrityError);
    assert.equal(await readFile(path, 'utf8'), original);
    await assert.rejects(store.importProject({ text: JSON.stringify(project), collision: 'copy' }), integrityError);
    await assert.rejects(store.saveCopy({ projectId: created.projectId, text: JSON.stringify(project) }), integrityError);
    project.models[0]!.id = id;
    const pending = store.saveProject({ projectId: created.projectId, project, expectedRevision: 0, operationId: newOperationId() });
    model.name = 'Changed after save';
    await pending;
    assert.equal((await store.readProject(created.projectId)).project.models![0]!.model.name, 'Brain');
    const persisted = JSON.parse(await readFile(path, 'utf8'));
    persisted.models[0].model.name = 'Tampered';
    await writeFile(path, JSON.stringify(persisted));
    await assert.rejects(store.readProject(created.projectId), integrityError);
    assert.equal((await store.listProjects())[0]!.mode, 'read-only');
  } finally {
    await store.close();
    await rm(root, { recursive: true, force: true });
  }
});
