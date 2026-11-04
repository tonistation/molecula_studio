import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { withProcessWorkspace, waitReady } from '../helpers/companion-process.ts';
import type { Project } from '../../src/shared/schema/types.ts';
type CreateResult = { projectId: string; project: Project; digest: string };
type ReadResult = { project: Project; orphanTemps: string[] };

test('F08 real processes: live lock cannot be stolen; dead owner requires explicit recovery', { timeout: 30_000 }, async () => {
  await withProcessWorkspace(async ({ root, start, spawn }) => {
    const owner = await start();
    const createdResponse = await owner.request('/api/projects', 'POST', { title: 'Last confirmed' });
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json() as CreateResult;
    const file = join(root, created.projectId, 'project.json');
    const bytes = await readFile(file);
    for (const forceUnlock of [false, true]) {
      const contender = await spawn({ forceUnlock });
      assert.notEqual((await contender.exited).code, 0);
      assert.match(contender.output, /WorkspaceLockedError/);
      assert.equal((await owner.request('/api/health')).status, 200);
      assert.deepEqual(await readFile(file), bytes);
    }
    await owner.stop('SIGKILL'); // Only a task-owned PID and temporary workspace.
    const rejected = await spawn();
    assert.notEqual((await rejected.exited).code, 0);
    assert.match(rejected.output, /WorkspaceLockedError/);
    const recovered = await start({ forceUnlock: true });
    assert.notEqual(recovered.child.pid, owner.child.pid);
    assert.equal((await recovered.request('/api/projects')).status, 200);
    assert.deepEqual(await readFile(file), bytes);
    assert.equal((await recovered.request(`/api/projects/${created.projectId}`)).status, 200);
  });
});

test('F08 real processes: failed write and SIGKILL during partial temporary preserve canonical bytes', { timeout: 30_000 }, async () => {
  await withProcessWorkspace(async ({ root, start }) => {
    const first = await start();
    const create = await first.request('/api/projects', 'POST', { title: 'Canonical snapshot' });
    const created = await create.json() as CreateResult;
    const file = join(root, created.projectId, 'project.json');
    const bytes = await readFile(file);
    await first.stop();
    const payload = { project: { ...created.project, revision: 1, idea: 'Must not publish',
      updatedAt: new Date().toISOString() }, expectedRevision: 0, expectedDigest: created.digest, operationId: 'op-f08-write' };
    const failing = await start({ fault: 'write' });
    assert.equal((await failing.request(`/api/projects/${created.projectId}`, 'PUT', payload)).status, 500);
    assert.deepEqual(await readFile(file), bytes);
    await failing.stop();
    const paused = await start({ fault: 'pause' });
    const pending = paused.request(`/api/projects/${created.projectId}`, 'PUT', payload).catch(() => null);
    await waitReady(paused, async () => paused.output.includes('F08_PARTIAL_TEMP_WRITTEN'));
    await paused.stop('SIGKILL');
    await pending;
    const recovered = await start({ forceUnlock: true });
    const response = await recovered.request(`/api/projects/${created.projectId}`);
    assert.equal(response.status, 200);
    const loaded = await response.json() as ReadResult;
    assert.deepEqual(loaded.project, created.project);
    assert.deepEqual(loaded.orphanTemps, ['project.json.tmp-op-f08-write']);
    assert.deepEqual(await readFile(file), bytes);
    assert.equal((await readFile(join(root, created.projectId, loaded.orphanTemps[0]!))).length, 17);
    // A valid-looking newer orphan is also never promoted, even with corrupt canonical JSON.
    const orphan = 'project.json.tmp-op-f08-valid';
    const candidate = JSON.stringify(payload.project);
    await writeFile(join(root, created.projectId, orphan), candidate);
    await writeFile(file, '{truncated');
    await recovered.stop();
    const fresh = await start();
    assert.equal((await fresh.request(`/api/projects/${created.projectId}`)).status, 422);
    const listing = await (await fresh.request('/api/projects')).json() as { projects: { orphanTemps: string[] }[] };
    assert.deepEqual(listing.projects[0]!.orphanTemps.sort(), ['project.json.tmp-op-f08-write', orphan].sort());
    assert.equal(await readFile(file, 'utf8'), '{truncated');
    assert.equal(await readFile(join(root, created.projectId, orphan), 'utf8'), candidate);
  });
});
