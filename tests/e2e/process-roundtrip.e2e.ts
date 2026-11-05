import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { studioDir, withProcessWorkspace } from '../helpers/companion-process.ts';
import { processBrowser } from '../helpers/process-browser.ts';
import { fixtureJson } from '../helpers/fixtures.ts';
import { wavBytes } from '../helpers/media.ts';
import { bindingDigests, sha256Hex } from '../../src/shared/digests.ts';
import { parseProjectText } from '../../src/shared/schema/index.ts';
import type { Project } from '../../src/shared/schema/types.ts';
type ReadResult = { project: Project; missingAssets: string[] };

async function readProject(response: Promise<Response>): Promise<ReadResult> {
  const result = await response;
  assert.equal(result.status, 200);
  return await result.json() as ReadResult;
}

test('F08 offline processes: empty and partial UI saves survive browser and production companion restarts', async () => {
  await withProcessWorkspace(async ({ root, start }) => {
    let companion = await start({ studioDir });
    let browser = await processBrowser(companion.origin);
    try {
      await browser.page.getByLabel('Nombre', { exact: true }).fill('F08 empty');
      await browser.page.getByRole('button', { name: 'Nuevo proyecto' }).click();
      await browser.page.getByLabel('Idea').fill('Empty scenes, partial idea');
      await browser.page.getByRole('button', { name: 'Guardar', exact: true }).click();
      await browser.page.getByText(/Guardado · rev\. 1/).waitFor();
      const id = (await readdir(root)).find((name) => name.startsWith('p-'))!;
      const bytes = await readFile(join(root, id, 'project.json'));
      const empty = JSON.parse(bytes.toString());
      assert.deepEqual(empty.scenes, []);
      assert.deepEqual(empty.assets, []);
      assert.equal(empty.output.durationMs, 0);
      const oldPid = browser.pid;
      const oldCompanionPid = companion.child.pid;
      const oldToken = companion.token;
      browser.assertClean();
      await browser.close();
      await companion.stop();
      companion = await start({ studioDir, port: Number(new URL(companion.origin).port) });
      assert.notEqual(companion.child.pid, oldCompanionPid);
      assert.ok(companion.token !== oldToken, 'companion restart rotates the session token');
      assert.equal((await companion.request('/api/projects', 'GET', undefined, oldToken)).status, 401);
      browser = await processBrowser(companion.origin);
      assert.notEqual(browser.pid, oldPid);
      await browser.page.getByRole('button', { name: 'Abrir', exact: true }).click();
      assert.equal(await browser.page.getByLabel('Idea').inputValue(), empty.idea);
      assert.deepEqual((await readProject(companion.request(`/api/projects/${id}`))).project, empty);
      assert.deepEqual(await readFile(join(root, id, 'project.json')), bytes);
      await browser.page.getByRole('button', { name: 'Proyectos', exact: true }).click();
      const partial = fixtureJson('draft-partial');
      await browser.page.getByLabel('JSON externo').setInputFiles({ name: 'partial.json', mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify(partial)) });
      await browser.page.getByLabel('Idea').fill('Half written offline');
      await browser.page.getByLabel('Texto', { exact: true }).fill('Incomplete scene');
      await browser.page.getByRole('button', { name: 'Guardar', exact: true }).click();
      await browser.page.getByText(/Guardado · rev\. 2/).waitFor();
      const partialFile = join(root, partial.projectId, 'project.json');
      const partialBytes = await readFile(partialFile);
      const saved = JSON.parse(partialBytes.toString());
      assert.equal(saved.scenes[0].visual, null);
      assert.equal(saved.scenes[0].audio, null);
      assert.deepEqual(saved.scenes[0].words, []);
      assert.deepEqual(saved.assets, partial.assets);
      browser.assertClean();
      await browser.close();
      await companion.stop();
      companion = await start({ studioDir });
      browser = await processBrowser(companion.origin);
      await browser.page.getByRole('listitem').filter({ hasText: partial.title }).getByRole('button', { name: 'Abrir', exact: true }).click();
      assert.equal(await browser.page.getByLabel('Idea').inputValue(), saved.idea);
      // Lightpanda includes initial textarea text in the label's exact name.
      assert.equal(await browser.page.getByLabel('Texto').inputValue(), 'Incomplete scene');
      const loaded = await readProject(companion.request(`/api/projects/${partial.projectId}`));
      assert.deepEqual(loaded.project, saved);
      assert.deepEqual(loaded.missingAssets, ['asset_voice']);
      assert.deepEqual(await readFile(partialFile), partialBytes);
      browser.assertClean();
    } finally { await browser.close(); }
  });
});

test('F08 offline processes: imported approval notice, identity and stale media survive restart and workspace transport', async () => {
  await withProcessWorkspace(async ({ root, start }) => {
    const companion = await start({ studioDir });
    // This imported storyboard now mounts a real WebGL preview; Lightpanda cannot run it.
    let browser = await processBrowser(companion.origin, 'chromium');
    try {
      const parsed = parseProjectText(JSON.stringify(fixtureJson('storyboard')));
      assert.ok(parsed.ok);
      const external: Project = parsed.project;
      const audio = wavBytes();
      external.assets.push({ assetId: 'f08_voice', kind: 'audio', path: 'assets/f08_voice.wav', mimeType: 'audio/wav',
        byteLength: audio.length, sha256: await sha256Hex(audio), durationMs: 1000,
        source: { origin: 'fixture', license: 'Synthetic test data', attribution: '' } });
      external.scenes[0]!.audio = { assetId: 'f08_voice', offsetMs: 0, gainDb: 0 };
      const bindings = await bindingDigests(external);
      external.scenes[0]!.mediaBindings.audio = { inputDigest: bindings.scenes[0]!.audioInputDigest!,
        outputDigest: bindings.scenes[0]!.audioOutputDigest! };
      external.approval = { contentDigest: bindings.contentDigest, approvedRevision: external.revision, approvedAt: external.updatedAt };
      // Deliberate historical bindings: do not recalculate them for the changed text.
      external.scenes[0]!.text += ' Changed after media review.';
      const history = structuredClone(external.scenes.map((scene) => scene.mediaBindings));
      const source = JSON.stringify(external);
      await browser.page.getByLabel('JSON externo').setInputFiles({ name: 'external.json', mimeType: 'application/json', buffer: Buffer.from(source) });
      await browser.page.getByText(/La aprobación importada se eliminó/).waitFor();
      await browser.page.getByText('Sin aprobación: se requiere revisión editorial antes de exportar.', { exact: true }).waitFor();
      await browser.page.getByLabel('Revincular f08_voice').setInputFiles({ name: 'voice.wav', mimeType: 'audio/wav', buffer: Buffer.from(audio) });
      await browser.page.getByText(/Recurso revinculado/).waitFor();
      await browser.page.getByLabel('Idea').fill('Identity and historical bindings retained');
      await browser.page.getByRole('button', { name: 'Guardar', exact: true }).click();
      await browser.page.getByText(/Guardado · rev\./).waitFor();
      const file = join(root, external.projectId, 'project.json');
      const savedBytes = await readFile(file);
      const saved = JSON.parse(savedBytes.toString());
      assert.equal(saved.approval, null);
      assert.deepEqual(saved.entities, external.entities); // Includes seed/version/proportions/material identity.
      assert.deepEqual(saved.scenes, external.scenes);
      assert.deepEqual(saved.assets, external.assets);
      assert.deepEqual(saved.scenes.map((scene: Project['scenes'][number]) => scene.mediaBindings), history);
      const expected = await bindingDigests(saved);
      assert.notEqual(saved.scenes[0].mediaBindings.audio.inputDigest, expected.scenes[0]!.audioInputDigest);
      assert.notEqual(saved.scenes[0].mediaBindings.words.inputDigest, expected.scenes[0]!.wordsInputDigest);
      browser.assertClean();
      await browser.close();
      await companion.stop();
      const fresh = await start({ studioDir });
      browser = await processBrowser(fresh.origin, 'chromium');
      await browser.page.getByRole('button', { name: 'Abrir', exact: true }).click();
      await browser.page.getByText('Sin aprobación: se requiere revisión editorial antes de exportar.', { exact: true }).waitFor();
      assert.deepEqual((await readProject(fresh.request(`/api/projects/${external.projectId}`))).project, saved);
      assert.deepEqual(await readFile(file), savedBytes);
      browser.assertClean();
      // Whole-folder transport, not an import that renews metadata or bindings.
      await withProcessWorkspace(async ({ root: target, start: startTarget }) => {
        await cp(join(root, external.projectId), join(target, external.projectId), { recursive: true });
        const targetCompanion = await startTarget({ studioDir });
        const targetBrowser = await processBrowser(targetCompanion.origin, 'chromium');
        try {
          await targetBrowser.page.getByRole('button', { name: 'Abrir', exact: true }).click();
          const read = await readProject(targetCompanion.request(`/api/projects/${external.projectId}`));
          assert.deepEqual(read.project, saved);
          assert.deepEqual(read.missingAssets, []);
          assert.deepEqual(await readFile(join(target, external.projectId, 'assets/f08_voice.wav')), Buffer.from(audio));
          targetBrowser.assertClean();
        } finally { await targetBrowser.close(); }
      });
    } finally { await browser.close(); }
  });
});

test('F08 token rotation: stale browser cannot save; refreshed browser recovers canonical draft', async () => {
  await withProcessWorkspace(async ({ root, start }) => {
    const first = await start({ studioDir });
    const browser = await processBrowser(first.origin);
    try {
      await browser.page.getByRole('button', { name: 'Nuevo proyecto' }).click();
      await browser.page.getByLabel('Idea').waitFor();
      const id = (await readdir(root)).find((name) => name.startsWith('p-'))!;
      const bytes = await readFile(join(root, id, 'project.json'));
      await first.stop();
      const fresh = await start({ studioDir, port: Number(new URL(first.origin).port) });
      assert.ok(first.token !== fresh.token, 'companion restart rotates the session token');
      await browser.page.getByLabel('Idea').fill('Still in stale browser memory');
      await browser.page.getByRole('button', { name: 'Guardar', exact: true }).click();
      await browser.page.getByRole('alert').waitFor();
      await browser.page.getByText('Cambios sin guardar', { exact: true }).waitFor();
      assert.equal(await browser.page.getByLabel('Idea').inputValue(), 'Still in stale browser memory');
      assert.equal(await browser.page.getByText(/Guardado ·/).count(), 0);
      assert.deepEqual(await readFile(join(root, id, 'project.json')), bytes);
      // Explicitly abandon only this test's unsaved memory before refreshing.
      await browser.page.getByRole('button', { name: 'Proyectos', exact: true }).click();
      await browser.page.getByRole('button', { name: 'Descartar cambios y continuar', exact: true }).click();
      await browser.page.reload({ waitUntil: 'domcontentloaded' });
      await browser.page.getByRole('button', { name: 'Abrir', exact: true }).click();
      assert.equal(await browser.page.getByLabel('Idea').inputValue(), '');
      await browser.page.getByLabel('Idea').fill('Recovered with refreshed token');
      await browser.page.getByRole('button', { name: 'Guardar', exact: true }).click();
      await browser.page.getByText(/Guardado · rev\. 1/).waitFor();
      assert.equal(JSON.parse(await readFile(join(root, id, 'project.json'), 'utf8')).idea, 'Recovered with refreshed token');
      browser.assertClean(Array<string>(2).fill('Failed to load resource: the server responded with a status of 401 (Unauthorized)'));
    } finally { await browser.close(); }
  });
});
