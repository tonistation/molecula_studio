import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseProjectText } from '../../src/shared/schema/parse.ts';
import { emptyProject } from '../../src/shared/schema/empty.ts';
import { fixtureText } from '../helpers/fixtures.ts';
import { withStudio, newDraft } from '../helpers/studio-browser.ts';

test('F06 uncertain save never confirms or clears dirty until explicit disk verification', async (t) => {
  await withStudio(t, async ({ page, root, fault, consoleErrors }) => {
    await newDraft(page);
    fault.value = 'sync';
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await page.getByText(/Persistencia incierta/).waitFor({ timeout: 4000 });
    assert.equal(await page.getByText(/Guardado ·/).count(), 0);
    await page.getByText('Cambios sin guardar', { exact: true }).waitFor();
    const id = (await readdir(root)).find((name) => name.startsWith('p-'))!;
    assert.equal(JSON.parse(await readFile(join(root, id, 'project.json'), 'utf8')).idea, 'Unsaved snapshot');
    fault.value = 'none';
    await page.getByRole('button', { name: 'Verificar guardado' }).click();
    await page.getByText(/Guardado · rev\. 1/).waitFor();
    assert.equal(await page.getByText('Cambios sin guardar', { exact: true }).count(), 0);
    assert.deepEqual(consoleErrors, []);
  });
});

test('F06 download contains current draft bytes and metadata but never clears dirty or writes the source', async (t) => {
  await withStudio(t, async ({ page, root, consoleErrors }) => {
    await newDraft(page);
    const id = (await readdir(root)).find((name) => name.startsWith('p-'))!;
    const before = await readFile(join(root, id, 'project.json'));
    await page.getByLabel('Nombre del proyecto').fill('');
    // Observe the actual Blob bytes passed to the browser download API. This
    // is not evidence that a browser/OS download was written successfully.
    await page.evaluate(() => {
      URL.createObjectURL = (blob: Blob) => {
        void blob.text().then((text) => { (globalThis as unknown as { downloaded: string }).downloaded = text; });
        return 'blob:local-download-oracle';
      };
      (globalThis as unknown as { HTMLAnchorElement: { prototype: { click: () => void } } }).HTMLAnchorElement.prototype.click = function () { /* do not navigate the test tab */ };
    });
    await page.getByRole('button', { name: 'Descargar copia JSON' }).click();
    await page.getByText(/Descarga solicitada con cambios no guardados/).waitFor();
    await page.waitForFunction(() => typeof (globalThis as unknown as { downloaded?: string }).downloaded === 'string');
    const text = await page.evaluate(() => (globalThis as unknown as { downloaded: string }).downloaded);
    const parsed = parseProjectText(text);
    assert.ok(parsed.ok);
    assert.equal(parsed.project.idea, 'Unsaved snapshot');
    assert.equal(parsed.project.title, 'Proyecto sin título');
    assert.equal(parsed.project.revision, 1);
    assert.equal(parsed.project.approval, null);
    assert.equal(parsed.project.projectId, id);
    await page.getByText('Cambios sin guardar', { exact: true }).waitFor();
    assert.deepEqual(await readFile(join(root, id, 'project.json')), before);
    assert.deepEqual(consoleErrors, []);
  });
});

test('F06 delayed save preserves edits, blocks double invocation, and retries a lost response idempotently', async (t) => {
  await withStudio(t, async ({ page, root, consoleErrors }) => {
    await newDraft(page);
    await page.evaluate(() => {
      const original = globalThis.fetch.bind(globalThis);
      let calls = 0;
      (globalThis as unknown as { saveCalls: () => number }).saveCalls = () => calls;
      globalThis.fetch = async (...args: Parameters<typeof fetch>) => {
        const response = await original(...args);
        if (args[1]?.method === 'PUT') {
          calls += 1;
          await new Promise<void>((resolve) => { (globalThis as unknown as { releaseSave: () => void }).releaseSave = resolve; });
          globalThis.fetch = original;
          throw new Error('injected lost HTTP response after real commit');
        }
        return response;
      };
    });
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await page.waitForFunction(() => typeof (globalThis as unknown as { releaseSave?: unknown }).releaseSave === 'function');
    await page.getByLabel('Idea').fill('Later edit');
    assert.equal(await page.getByRole('button', { name: 'Guardando…' }).isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: 'Copia portable', exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: 'Proyectos', exact: true }).isDisabled(), true);
    assert.equal(await page.evaluate(() => (globalThis as unknown as { saveCalls: () => number }).saveCalls()), 1);
    await page.evaluate(() => (globalThis as unknown as { releaseSave: () => void }).releaseSave());
    await page.getByRole('alert').waitFor();
    assert.equal(await page.getByLabel('Idea').inputValue(), 'Later edit');
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await page.getByText(/Guardado · rev\. 1/).waitFor();
    await page.getByText('Cambios sin guardar', { exact: true }).waitFor();
    const id = (await readdir(root)).find((name) => name.startsWith('p-'))!;
    assert.equal(JSON.parse(await readFile(join(root, id, 'project.json'), 'utf8')).idea, 'Unsaved snapshot');
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await page.getByText(/Guardado · rev\. 2/).waitFor();
    assert.equal(JSON.parse(await readFile(join(root, id, 'project.json'), 'utf8')).idea, 'Later edit');
    assert.deepEqual(consoleErrors, []);
  });
});

test('F06 a successful delayed HTTP save never overwrites later edits or navigates away', async (t) => {
  await withStudio(t, async ({ page, root, consoleErrors }) => {
    await newDraft(page);
    await page.getByRole('button', { name: 'Proyectos', exact: true }).click();
    await page.evaluate(() => {
      const original = globalThis.fetch.bind(globalThis);
      globalThis.fetch = async (...args: Parameters<typeof fetch>) => {
        const response = await original(...args);
        if (args[1]?.method === 'PUT') {
          await new Promise<void>((resolve) => { (globalThis as unknown as { releaseSuccess: () => void }).releaseSuccess = resolve; });
          globalThis.fetch = original;
        }
        return response;
      };
    });
    await page.getByRole('button', { name: 'Guardar y continuar', exact: true }).click();
    await page.waitForFunction(() => typeof (globalThis as unknown as { releaseSuccess?: unknown }).releaseSuccess === 'function');
    await page.getByLabel('Idea').fill('Later edit');
    await page.evaluate(() => (globalThis as unknown as { releaseSuccess: () => void }).releaseSuccess());
    await page.getByText(/Guardado · rev\. 1/).waitFor();
    await page.getByText('Cambios sin guardar', { exact: true }).waitFor();
    assert.equal(await page.getByLabel('Idea').inputValue(), 'Later edit');
    const id = (await readdir(root)).find((name) => name.startsWith('p-'))!;
    assert.equal(JSON.parse(await readFile(join(root, id, 'project.json'), 'utf8')).idea, 'Unsaved snapshot');
    await page.getByRole('button', { name: 'Guardar y continuar', exact: true }).click();
    await page.getByRole('heading', { name: 'Molecula Studio', exact: true }).waitFor();
    assert.equal(JSON.parse(await readFile(join(root, id, 'project.json'), 'utf8')).idea, 'Later edit');
    assert.deepEqual(consoleErrors, []);
  });
});

test('F06 copy retry after a lost response preserves original snapshot and creates no duplicate', async (t) => {
  await withStudio(t, async ({ page, root, consoleErrors }) => {
    await newDraft(page);
    await page.evaluate(() => {
      const original = globalThis.fetch.bind(globalThis);
      globalThis.fetch = async (...args: Parameters<typeof fetch>) => {
        const response = await original(...args);
        if (String(args[0]).endsWith('/copy')) {
          await new Promise<void>((resolve) => { (globalThis as unknown as { releaseCopy: () => void }).releaseCopy = resolve; });
          globalThis.fetch = original;
          throw new Error('lost copy receipt');
        }
        return response;
      };
    });
    await page.getByRole('button', { name: 'Copia portable', exact: true }).click();
    await page.waitForFunction(() => typeof (globalThis as unknown as { releaseCopy?: unknown }).releaseCopy === 'function');
    await page.getByLabel('Idea').fill('Later copy edit');
    await page.evaluate(() => (globalThis as unknown as { releaseCopy: () => void }).releaseCopy());
    await page.getByRole('alert').waitFor();
    assert.equal((await readdir(root)).filter((name) => name.startsWith('p-')).length, 2);
    await page.getByRole('button', { name: 'Copia portable', exact: true }).click();
    await page.getByText(/Copia portable creada/).waitFor();
    assert.equal((await readdir(root)).filter((name) => name.startsWith('p-')).length, 2);
    assert.equal(await page.getByLabel('Idea').inputValue(), 'Later copy edit');
    await page.getByText('Cambios sin guardar', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Abrir copia', exact: true }).click();
    await page.getByRole('button', { name: 'Descartar cambios y continuar', exact: true }).click();
    await page.getByText(/Sin cambios pendientes/).waitFor();
    assert.equal(await page.getByLabel('Idea').inputValue(), 'Unsaved snapshot');
    assert.deepEqual(consoleErrors, []);
  });
});

test('F06 native browser reload and close can be cancelled with dirty changes (Chromium fallback)', async (t) => {
  // Lightpanda has no native beforeunload prompt UI. Use existing system Chrome
  // for actual browser cancellation; this is not a visual/layout assertion.
  await withStudio(t, async ({ page, consoleErrors, resourceErrors }) => {
    await newDraft(page);
    const reloadDialog = page.waitForEvent('dialog');
    const reloading = page.reload().catch(() => null);
    const first = await reloadDialog;
    assert.equal(first.type(), 'beforeunload');
    await first.dismiss();
    await reloading;
    assert.equal(await page.getByLabel('Idea').inputValue(), 'Unsaved snapshot');
    const closeDialog = page.waitForEvent('dialog');
    await page.close({ runBeforeUnload: true });
    const second = await closeDialog;
    assert.equal(second.type(), 'beforeunload');
    await second.dismiss();
    assert.equal(page.isClosed(), false);
    assert.equal(await page.getByLabel('Idea').inputValue(), 'Unsaved snapshot');
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await page.getByText(/Guardado · rev\. 1/).waitFor();
    let unexpectedDialogs = 0;
    page.on('dialog', (dialog) => { unexpectedDialogs += 1; void dialog.dismiss(); });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'Molecula Studio' }).waitFor();
    assert.equal(unexpectedDialogs, 0);
    assert.deepEqual(resourceErrors, []);
    assert.deepEqual(consoleErrors, []);
  }, 'chromium');
});

test('F06 real browser JSON download carries the dirty snapshot without claiming canonical save (Chromium fallback)', async (t) => {
  // Lightpanda does not supply Chromium's native download manager. Verify the
  // real Blob URL/anchor/download path without replacing click or URL APIs.
  await withStudio(t, async ({ page, root, consoleErrors }) => {
    await newDraft(page);
    const id = (await readdir(root)).find((name) => name.startsWith('p-'))!;
    const source = await readFile(join(root, id, 'project.json'));
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Descargar copia JSON' }).click();
    const download = await downloading;
    assert.equal(await download.failure(), null);
    assert.equal(download.suggestedFilename(), 'f06.json');
    const path = await download.path();
    assert.ok(path);
    const parsed = parseProjectText(await readFile(path));
    assert.ok(parsed.ok);
    assert.equal(parsed.project.idea, 'Unsaved snapshot');
    assert.equal(parsed.project.approval, null);
    assert.equal(parsed.project.revision, 1);
    await page.getByText(/Descarga solicitada con cambios no guardados/).waitFor();
    assert.equal(await page.getByText(/Guardado ·/).count(), 0);
    await page.getByText('Cambios sin guardar', { exact: true }).waitFor();
    assert.deepEqual(await readFile(join(root, id, 'project.json')), source);
    assert.deepEqual(consoleErrors, []);
  }, 'chromium');
});

test('F06 exit and reload cancellation, failed save-and-exit, and failed open preserve the draft', async (t) => {
  await withStudio(t, async ({ page, root, fault, consoleErrors }) => {
    await newDraft(page);
    await page.getByRole('button', { name: 'Proyectos', exact: true }).click();
    await page.getByRole('button', { name: 'Seguir editando', exact: true }).click();
    assert.equal(await page.getByLabel('Idea').inputValue(), 'Unsaved snapshot');
    await page.getByRole('button', { name: 'Proyectos', exact: true }).click();
    fault.value = 'write';
    await page.getByRole('button', { name: 'Guardar y continuar', exact: true }).click();
    await page.getByRole('alert').waitFor();
    await page.getByText('Cambios sin guardar', { exact: true }).waitFor();
    assert.equal(await page.getByLabel('Idea').inputValue(), 'Unsaved snapshot');
    fault.value = 'none';
    await page.getByRole('button', { name: 'Seguir editando', exact: true }).click();
    const id = (await readdir(root)).find((name) => name.startsWith('p-'))!;
    const source = join(root, id, 'project.json');
    const external = { ...JSON.parse(await readFile(source, 'utf8')), revision: 2, idea: 'External' };
    await writeFile(source, JSON.stringify(external));
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await page.getByRole('button', { name: 'Recargar desde disco' }).click();
    await page.getByRole('button', { name: 'Seguir editando', exact: true }).click();
    assert.equal(await page.getByLabel('Idea').inputValue(), 'Unsaved snapshot');
    assert.equal(JSON.parse(await readFile(source, 'utf8')).idea, 'External');
    await page.getByRole('button', { name: 'Copia portable', exact: true }).click();
    await page.getByRole('button', { name: 'Abrir copia', exact: true }).waitFor();
    const copy = (await readdir(root)).find((name) => name.startsWith('p-') && name !== id)!;
    await writeFile(join(root, copy, 'project.json'), '{invalid');
    await page.getByRole('button', { name: 'Abrir copia', exact: true }).click();
    await page.getByRole('button', { name: 'Descartar cambios y continuar', exact: true }).click();
    await page.getByRole('alert').waitFor();
    assert.equal(await page.getByLabel('Idea').inputValue(), 'Unsaved snapshot');
    await page.getByText('Cambios sin guardar', { exact: true }).waitFor();
    assert.deepEqual(consoleErrors.sort(), [
      'Failed to load resource: the server responded with a status of 500 (Internal Server Error)',
      'Failed to load resource: the server responded with a status of 409 (Conflict)',
      'Failed to load resource: the server responded with a status of 422 (Unprocessable Entity)',
    ].sort());
  });
});

test('F06 a rejected invalid snapshot can be corrected instead of retrying invalid bytes forever', async (t) => {
  await withStudio(t, async ({ page, root, consoleErrors }) => {
    await newDraft(page);
    await page.getByLabel('Idea').fill('x'.repeat(4001));
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await page.getByRole('alert').waitFor();
    await page.getByLabel('Idea').fill('Corrected draft');
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await page.getByText(/Guardado · rev\. 1/).waitFor();
    const id = (await readdir(root)).find((name) => name.startsWith('p-'))!;
    assert.equal(JSON.parse(await readFile(join(root, id, 'project.json'), 'utf8')).idea, 'Corrected draft');
    assert.deepEqual(consoleErrors, ['Failed to load resource: the server responded with a status of 422 (Unprocessable Entity)']);
  });
});

test('F06 rejected copies can be corrected and never offer a nonexistent published destination', async (t) => {
  await withStudio(t, async ({ page, root, consoleErrors }) => {
    await newDraft(page);
    await page.getByLabel('Idea').fill('x'.repeat(4001));
    await page.getByRole('button', { name: 'Copia portable', exact: true }).click();
    await page.getByRole('alert').waitFor();
    assert.equal(await page.getByRole('button', { name: 'Abrir copia', exact: true }).count(), 0);
    await page.getByLabel('Idea').fill('Corrected copy');
    await page.getByRole('button', { name: 'Copia portable', exact: true }).click();
    await page.getByText(/Copia portable creada/).waitFor();
    const files = (await readdir(root)).filter((name) => name.startsWith('p-'));
    assert.equal(files.length, 2);
    const snapshots = await Promise.all(files.map(async (id) => JSON.parse(await readFile(join(root, id, 'project.json'), 'utf8'))));
    assert.equal(snapshots.filter((snapshot) => snapshot.idea === 'Corrected copy').length, 1);
    await page.getByText('Cambios sin guardar', { exact: true }).waitFor();
    assert.deepEqual(consoleErrors, ['Failed to load resource: the server responded with a status of 422 (Unprocessable Entity)']);
  });
});

test('F06 download and save remain schema-valid after importing dates ahead of the local clock', async (t) => {
  await withStudio(t, async ({ page, store, consoleErrors }) => {
    const project = emptyProject({ projectId: 'p-future-clock', now: '2099-01-01T00:00:00.000Z' });
    await store.importProject({ text: JSON.stringify(project) });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Abrir', exact: true }).click();
    await page.getByLabel('Idea').fill('Future clock draft');
    await page.evaluate(() => {
      URL.createObjectURL = (blob: Blob) => {
        void blob.text().then((text) => { (globalThis as unknown as { downloaded: string }).downloaded = text; });
        return 'blob:download-oracle';
      };
      (globalThis as unknown as { HTMLAnchorElement: { prototype: { click: () => void } } }).HTMLAnchorElement.prototype.click = () => {};
    });
    await page.getByRole('button', { name: 'Descargar copia JSON' }).click();
    await page.waitForFunction(() => typeof (globalThis as unknown as { downloaded?: string }).downloaded === 'string');
    assert.ok(parseProjectText(await page.evaluate(() => (globalThis as unknown as { downloaded: string }).downloaded)).ok);
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await page.getByText(/Guardado · rev\. 1/).waitFor();
    assert.equal((await store.readProject('p-future-clock')).project.idea, 'Future clock draft');
    assert.deepEqual(consoleErrors, []);
  });
});

test('F06 uncertain portable copy and missing assets are reported without confirming the source', async (t) => {
  await withStudio(t, async ({ page, store, fault, root, consoleErrors }) => {
    await store.importProject({ text: fixtureText('draft-partial') });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Abrir', exact: true }).click();
    await page.getByLabel('Idea').fill('Copy with missing audio');
    const before = await readFile(join(root, 'project_draft', 'project.json'));
    fault.value = 'copy-sync';
    await page.getByRole('button', { name: 'Copia portable', exact: true }).click();
    await page.getByText(/Persistencia de copia incierta/).waitFor();
    assert.equal(await page.getByText(/Copia portable creada/).count(), 0);
    await page.getByText(/Faltan activos: asset_voice/).waitFor();
    await page.getByText('Cambios sin guardar', { exact: true }).waitFor();
    assert.deepEqual(await readFile(join(root, 'project_draft', 'project.json')), before);
    fault.value = 'none';
    assert.deepEqual(consoleErrors, []);
  });
});

test('F06 read-only download preserves exact original bytes including unknown visual payload', async (t) => {
  await withStudio(t, async ({ page, store, root, consoleErrors }) => {
    const source = fixtureText('unknown-style');
    const imported = await store.importProject({ text: source });
    const raw = await readFile(join(root, imported.projectId, 'project.json'), 'utf8');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Abrir', exact: true }).click();
    await page.getByText(/Solo lectura:/).waitFor();
    await page.evaluate(() => {
      URL.createObjectURL = (blob: Blob) => {
        void blob.text().then((text) => { (globalThis as unknown as { downloaded: string }).downloaded = text; });
        return 'blob:read-only-oracle';
      };
      (globalThis as unknown as { HTMLAnchorElement: { prototype: { click: () => void } } }).HTMLAnchorElement.prototype.click = () => {};
    });
    await page.getByRole('button', { name: 'Descargar copia JSON' }).click();
    await page.waitForFunction(() => typeof (globalThis as unknown as { downloaded?: string }).downloaded === 'string');
    assert.equal(await page.evaluate(() => (globalThis as unknown as { downloaded: string }).downloaded), raw);
    assert.equal(await readFile(join(root, imported.projectId, 'project.json'), 'utf8'), raw);
    assert.deepEqual(consoleErrors, []);
  });
});

test('F06 editable JSON download clears approval only in exported bytes and leaves a clean source untouched', async (t) => {
  await withStudio(t, async ({ page, store, root, consoleErrors }) => {
    const created = await store.createProject();
    await store.saveProject({ projectId: created.projectId, expectedRevision: 0, operationId: 'op-approved-fixture',
      project: { ...created.project, revision: 1, approval: {
        approvedRevision: 1, approvedAt: created.project.updatedAt, contentDigest: 'a'.repeat(64),
      } } });
    const before = await readFile(join(root, created.projectId, 'project.json'));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Abrir', exact: true }).click();
    await page.evaluate(() => {
      URL.createObjectURL = (blob: Blob) => {
        void blob.text().then((text) => { (globalThis as unknown as { downloaded: string }).downloaded = text; });
        return 'blob:approval-oracle';
      };
      (globalThis as unknown as { HTMLAnchorElement: { prototype: { click: () => void } } }).HTMLAnchorElement.prototype.click = () => {};
    });
    await page.getByRole('button', { name: 'Descargar copia JSON' }).click();
    await page.getByText(/Sin aprobación en la descarga/).waitFor();
    await page.waitForFunction(() => typeof (globalThis as unknown as { downloaded?: string }).downloaded === 'string');
    const parsed = parseProjectText(await page.evaluate(() => (globalThis as unknown as { downloaded: string }).downloaded));
    assert.ok(parsed.ok);
    assert.equal(parsed.project.approval, null);
    assert.equal(parsed.project.revision, 2);
    assert.deepEqual(await readFile(join(root, created.projectId, 'project.json')), before);
    await page.getByText(/Sin cambios pendientes/).waitFor();
    assert.deepEqual(consoleErrors, []);
  });
});

test('F06 confirmed reload adopts read-only mode when the replacement uses an unknown style', async (t) => {
  await withStudio(t, async ({ page, root, consoleErrors }) => {
    await newDraft(page);
    const id = (await readdir(root)).find((name) => name.startsWith('p-'))!;
    const file = join(root, id, 'project.json');
    const external = { ...JSON.parse(await readFile(file, 'utf8')), revision: 1, styleId: 'unknown-style' };
    await writeFile(file, JSON.stringify(external));
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await page.getByRole('button', { name: 'Recargar desde disco' }).click();
    await page.getByRole('button', { name: 'Descartar cambios y continuar', exact: true }).click();
    await page.getByText(/Solo lectura:/).waitFor();
    assert.equal(await page.getByLabel('Idea').isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: 'Guardar', exact: true }).isDisabled(), true);
    assert.deepEqual(consoleErrors, ['Failed to load resource: the server responded with a status of 409 (Conflict)']);
  });
});

test('F06 conflict copy uses dirty snapshot, cancellation preserves source, opening resets editor', async (t) => {
  await withStudio(t, async ({ page, root, consoleErrors }) => {
    await newDraft(page);
    const id = (await readdir(root)).find((name) => name.startsWith('p-'))!;
    const sourceFile = join(root, id, 'project.json');
    const external = JSON.parse(await readFile(sourceFile, 'utf8'));
    external.idea = 'External';
    external.revision = 1;
    await writeFile(sourceFile, JSON.stringify(external));
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await page.getByRole('alert').waitFor();
    await page.getByRole('button', { name: 'Copia portable', exact: true }).click();
    await page.getByRole('button', { name: 'Abrir copia', exact: true }).waitFor();
    const copyId = (await readdir(root)).find((name) => name.startsWith('p-') && name !== id)!;
    assert.equal(JSON.parse(await readFile(join(root, copyId, 'project.json'), 'utf8')).idea, 'Unsaved snapshot');
    await page.getByText('Cambios sin guardar', { exact: true }).waitFor();
    await page.getByText(/Sin aprobación/).waitFor();
    await page.getByRole('button', { name: 'Abrir copia', exact: true }).click();
    await page.getByRole('button', { name: 'Seguir editando', exact: true }).click();
    assert.equal(await page.getByLabel('Idea').inputValue(), 'Unsaved snapshot');
    await page.getByRole('button', { name: 'Abrir copia', exact: true }).click();
    await page.getByRole('button', { name: 'Descartar cambios y continuar', exact: true }).click();
    await page.getByText(/Sin cambios pendientes/).waitFor();
    assert.equal(await page.getByLabel('Idea').inputValue(), 'Unsaved snapshot');
    assert.equal(JSON.parse(await readFile(sourceFile, 'utf8')).idea, 'External');
    assert.deepEqual(consoleErrors, ['Failed to load resource: the server responded with a status of 409 (Conflict)']);
  });
});
