import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { withStudio, newDraft } from '../helpers/studio-browser.ts';
import { fixtureText } from '../helpers/fixtures.ts';

test('review P1: historical save replay cannot clean dirty or navigate after external replacement', async (t) => {
  await withStudio(t, async ({ page, root, consoleErrors }) => {
    await newDraft(page);
    const id = (await readdir(root)).find((name) => name.startsWith('p-'))!;
    await page.evaluate(() => {
      const original = globalThis.fetch.bind(globalThis);
      globalThis.fetch = async (...args: Parameters<typeof fetch>) => {
        const response = await original(...args);
        if (args[1]?.method === 'PUT') {
          globalThis.fetch = original;
          throw new Error('lost response after actual disk commit');
        }
        return response;
      };
    });
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await page.getByRole('alert').waitFor();
    const file = join(root, id, 'project.json');
    const external = { ...JSON.parse(await readFile(file, 'utf8')), revision: 2, idea: 'External writer revision 2' };
    const bytes = JSON.stringify(external);
    await writeFile(file, bytes);
    await page.getByRole('button', { name: 'Proyectos', exact: true }).click();
    await page.getByRole('button', { name: 'Guardar y continuar', exact: true }).click();
    await page.getByRole('button', { name: 'Recargar desde disco' }).waitFor();
    await page.getByText('Cambios sin guardar', { exact: true }).waitFor();
    assert.equal(await page.getByText(/Guardado ·/).count(), 0);
    assert.equal(await page.getByLabel('Idea').inputValue(), 'Unsaved snapshot');
    assert.equal(await readFile(file, 'utf8'), bytes);
    assert.deepEqual(consoleErrors, []);
  });
});

test('review P2: failed reload and corrupt disk never prevent copying the preserved editor draft', async (t) => {
  await withStudio(t, async ({ page, root, consoleErrors }) => {
    await newDraft(page);
    const id = (await readdir(root)).find((name) => name.startsWith('p-'))!;
    const file = join(root, id, 'project.json');
    const external = { ...JSON.parse(await readFile(file, 'utf8')), revision: 1, idea: 'External' };
    await writeFile(file, JSON.stringify(external));
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await page.getByRole('button', { name: 'Recargar desde disco' }).click();
    await writeFile(file, '{truncated');
    await page.getByRole('button', { name: 'Descartar cambios y continuar', exact: true }).click();
    await page.getByRole('alert').waitFor();
    assert.equal(await page.getByLabel('Idea').inputValue(), 'Unsaved snapshot');
    await page.getByText('Cambios sin guardar', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Copia portable', exact: true }).click();
    await page.getByText(/Copia portable creada/).waitFor();
    const copyId = (await readdir(root)).find((name) => name.startsWith('p-') && name !== id)!;
    assert.equal(JSON.parse(await readFile(join(root, copyId, 'project.json'), 'utf8')).idea, 'Unsaved snapshot');
    assert.equal(await readFile(file, 'utf8'), '{truncated');
    await page.getByText('Cambios sin guardar', { exact: true }).waitFor();
    assert.deepEqual(consoleErrors.sort(), [
      'Failed to load resource: the server responded with a status of 409 (Conflict)',
      'Failed to load resource: the server responded with a status of 422 (Unprocessable Entity)',
    ].sort());
  });
});

test('review P2: native read-only download preserves accepted UTF-8 BOM bytes', async (t) => {
  await withStudio(t, async ({ page, store, root, consoleErrors }) => {
    const imported = await store.importProject({ text: fixtureText('unknown-style') });
    const file = join(root, imported.projectId, 'project.json');
    const original = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), await readFile(file)]);
    await writeFile(file, original);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Abrir', exact: true }).click();
    await page.getByText(/Solo lectura:/).waitFor();
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Descargar copia JSON' }).click();
    const download = await downloading;
    const path = await download.path();
    assert.ok(path);
    assert.deepEqual(await readFile(path), original);
    assert.deepEqual(await readFile(file), original);
    assert.deepEqual(consoleErrors, []);
  }, 'chromium');
});

test('review gap: edits during uncertain receipt verification remain dirty after the matching disk read', async (t) => {
  await withStudio(t, async ({ page, root, fault, consoleErrors }) => {
    await newDraft(page);
    fault.value = 'sync';
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await page.getByText(/Persistencia incierta/).waitFor();
    fault.value = 'none';
    await page.evaluate(() => {
      const original = globalThis.fetch.bind(globalThis);
      globalThis.fetch = async (...args: Parameters<typeof fetch>) => {
        const response = await original(...args);
        if (args[1]?.method === 'GET') {
          await new Promise<void>((resolve) => { (globalThis as unknown as { releaseVerify: () => void }).releaseVerify = resolve; });
          globalThis.fetch = original;
        }
        return response;
      };
    });
    await page.getByRole('button', { name: 'Verificar guardado' }).click();
    await page.waitForFunction(() => typeof (globalThis as unknown as { releaseVerify?: unknown }).releaseVerify === 'function');
    await page.getByLabel('Idea').fill('Edited during verification');
    await page.evaluate(() => (globalThis as unknown as { releaseVerify: () => void }).releaseVerify());
    await page.getByText(/Guardado · rev\. 1/).waitFor();
    await page.getByText('Cambios sin guardar', { exact: true }).waitFor();
    assert.equal(await page.getByLabel('Idea').inputValue(), 'Edited during verification');
    const id = (await readdir(root)).find((name) => name.startsWith('p-'))!;
    assert.equal(JSON.parse(await readFile(join(root, id, 'project.json'), 'utf8')).idea, 'Unsaved snapshot');
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await page.getByText(/Guardado · rev\. 2/).waitFor();
    assert.equal(JSON.parse(await readFile(join(root, id, 'project.json'), 'utf8')).idea, 'Edited during verification');
    assert.deepEqual(consoleErrors, []);
  });
});

test('review gap: browser save/copy retries after fresh companion instances preserve drafts and reserved destinations', async (t) => {
  await withStudio(t, async ({ page, root, consoleErrors, restartCompanion }) => {
    await newDraft(page);
    const id = (await readdir(root)).find((name) => name.startsWith('p-'))!;
    await page.evaluate(() => {
      const original = globalThis.fetch.bind(globalThis);
      globalThis.fetch = async (...args: Parameters<typeof fetch>) => {
        const response = await original(...args);
        if (args[1]?.method === 'PUT') {
          globalThis.fetch = original;
          throw new Error('lost save receipt before restart');
        }
        return response;
      };
    });
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await page.getByRole('alert').waitFor();
    const savedBytes = await readFile(join(root, id, 'project.json'));
    await restartCompanion();
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await page.getByRole('button', { name: 'Recargar desde disco' }).waitFor();
    await page.getByText('Cambios sin guardar', { exact: true }).waitFor();
    assert.equal(await page.getByText(/Guardado ·/).count(), 0);
    assert.deepEqual(await readFile(join(root, id, 'project.json')), savedBytes);
    await page.evaluate(() => {
      const original = globalThis.fetch.bind(globalThis);
      globalThis.fetch = async (...args: Parameters<typeof fetch>) => {
        const response = await original(...args);
        if (String(args[0]).endsWith('/copy')) {
          globalThis.fetch = original;
          throw new Error('lost copy receipt before restart');
        }
        return response;
      };
    });
    await page.getByRole('button', { name: 'Copia portable', exact: true }).click();
    await page.getByText(/Destino reservado:/).waitFor();
    const copyId = (await readdir(root)).find((name) => name.startsWith('p-') && name !== id)!;
    const copyBytes = await readFile(join(root, copyId, 'project.json'));
    await restartCompanion();
    await page.getByRole('button', { name: 'Copia portable', exact: true }).click();
    await page.getByText(/Ya existe un proyecto con ese identificador/).waitFor();
    assert.equal(await page.getByText(/Copia portable creada/).count(), 0);
    assert.equal((await readdir(root)).filter((name) => name.startsWith('p-')).length, 2);
    assert.deepEqual(await readFile(join(root, copyId, 'project.json')), copyBytes);
    assert.equal(await page.getByLabel('Idea').inputValue(), 'Unsaved snapshot');
    await page.getByText('Cambios sin guardar', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Abrir copia', exact: true }).click();
    await page.getByRole('button', { name: 'Descartar cambios y continuar', exact: true }).click();
    await page.getByText(/Sin cambios pendientes/).waitFor();
    assert.equal(await page.getByLabel('Idea').inputValue(), 'Unsaved snapshot');
    assert.deepEqual(consoleErrors, Array<string>(2).fill('Failed to load resource: the server responded with a status of 409 (Conflict)'));
  });
});
