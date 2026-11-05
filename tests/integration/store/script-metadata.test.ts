import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectStore } from '../../../src/companion/store/project-store.ts';
import { serializeProject } from '../../../src/shared/schema/index.ts';
import { bindingDigests } from '../../../src/shared/digests.ts';

test('script metadata survives saved disk reopen, import and copy without fetching sources', async () => {
  const root = await mkdtemp(join(tmpdir(), 'molecula-script-'));
  let store = new ProjectStore({ workspaceRoot: root });
  try {
    await store.init();
    const created = await store.createProject();
    const metadata = { sources: [{ title: 'Referencia sin acceso', url: 'https://example.invalid/source' }], cover: { headline: 'Sal' }, postText: 'Comparte.' };
    const project = { ...created.project, ...metadata, revision: 1 };
    const digest = (await bindingDigests(project)).contentDigest;
    project.approval = { contentDigest: digest, approvedRevision: 1, approvedAt: project.updatedAt };
    await store.saveProject({ projectId: created.projectId, project, expectedRevision: 0, expectedDigest: created.digest, operationId: 'script-save' });
    await store.close();
    store = new ProjectStore({ workspaceRoot: root });
    await store.init();
    const opened = await store.readProject(created.projectId);
    assert.deepEqual(opened.project, project);
    assert.equal(await readFile(join(root, created.projectId, 'project.json'), 'utf8'), serializeProject(project));
    const edited = { ...opened.project, postText: 'Otro cierre.', revision: 2 };
    await store.saveProject({ projectId: created.projectId, project: edited, expectedRevision: 1, expectedDigest: opened.digest, operationId: 'script-edit' });
    const saved = await store.readProject(created.projectId);
    assert.equal(saved.project.approval?.contentDigest, digest);
    assert.notEqual((await bindingDigests(saved.project)).contentDigest, digest);
    const imported = await store.importProject({ text: serializeProject(project), collision: 'copy' });
    const copied = await store.saveCopy({ projectId: created.projectId });
    for (const id of [imported.projectId, copied.projectId]) {
      const result = await store.readProject(id);
      assert.deepEqual(result.project.sources, metadata.sources);
      assert.deepEqual(result.project.cover, metadata.cover);
      assert.equal(result.project.approval, null);
      assert.equal(result.project.postText, id === imported.projectId ? metadata.postText : edited.postText);
    }
  } finally {
    await store.close();
    await rm(root, { recursive: true, force: true });
  }
});
