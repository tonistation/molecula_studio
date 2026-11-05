import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectStore } from '../../../src/companion/store/project-store.ts';
import { ConflictError } from '../../../src/companion/store/errors.ts';
import { sha256Hex } from '../../../src/shared/digests.ts';
import { fixtureText } from '../../helpers/fixtures.ts';
import type { Project } from '../../../src/shared/schema/types.ts';

test('opens v1 without rewriting bytes, saves v2 atomically and preserves disk-digest conflicts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'molecula-kit-'));
  let store = new ProjectStore({ workspaceRoot: root });
  try {
    const source = fixtureText('storyboard');
    const id = JSON.parse(source).projectId;
    await mkdir(join(root, id, 'assets'), { recursive: true });
    const path = join(root, id, 'project.json');
    await writeFile(path, source);
    await store.init();
    const opened = await store.readProject(id);
    assert.equal(opened.project.schemaVersion, 2);
    assert.equal(opened.raw, source);
    assert.equal(opened.digest, await sha256Hex(source));
    assert.equal(await readFile(path, 'utf8'), source);
    const project = { ...opened.project, revision: opened.revision + 1 };
    await writeFile(path, `${source}\n`);
    await assert.rejects(store.saveProject({ projectId: id, project, expectedRevision: opened.revision,
      expectedDigest: opened.digest, operationId: 'kit-conflict' }), ConflictError);
    await writeFile(path, source);
    const saved = await store.saveProject({ projectId: id, project, expectedRevision: opened.revision,
      expectedDigest: opened.digest, operationId: 'kit-save' });
    assert.equal(JSON.parse(await readFile(path, 'utf8')).schemaVersion, 2);
    await store.close();
    store = new ProjectStore({ workspaceRoot: root });
    await store.init();
    const reopened = await store.readProject(id);
    assert.deepEqual(reopened.project, project);
    assert.equal(reopened.digest, saved.digest);
  } finally {
    await store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('save normalizes a validated legacy wire payload before serializing it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'molecula-kit-save-'));
  const store = new ProjectStore({ workspaceRoot: root });
  try {
    await store.init();
    const created = await store.createProject();
    const legacy = JSON.parse(fixtureText('storyboard')) as Project;
    legacy.projectId = created.projectId;
    legacy.revision = 1;
    await store.saveProject({ projectId: created.projectId, project: legacy, expectedRevision: 0, operationId: 'save-legacy' });
    const raw = JSON.parse(await readFile(join(root, created.projectId, 'project.json'), 'utf8'));
    assert.equal(raw.schemaVersion, 2);
    assert.equal(raw.scenes[0].visual.kind, 'kit');
    assert.equal((await store.readProject(created.projectId)).project.schemaVersion, 2);
  } finally {
    await store.close();
    await rm(root, { recursive: true, force: true });
  }
});
