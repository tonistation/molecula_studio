import test from 'node:test';
import assert from 'node:assert/strict';

import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright-core';

import { parseProjectText } from '../../src/shared/schema/parse.ts';
import { startCompanionServer } from '../../src/companion/server/http.ts';
import { emptyProject } from '../../src/shared/schema/empty.ts';
import { wavBytes } from '../helpers/media.ts';

/**
 * Browser E2E of the M1 loop (create → edit → save → reopen) against the real
 * companion and real disk files.
 *
 * Runs on Lightpanda over CDP (DOM-only; no visual assertions). If Lightpanda
 * is unavailable the test skips instead of pretending to pass.
 */

const studioDist = fileURLToPath(new URL('../../dist/studio', import.meta.url));

function lightpandaAvailable(): boolean {
  try {
    execFileSync('lightpanda', ['version'], { stdio: 'ignore', env: { ...process.env, LIGHTPANDA_DISABLE_TELEMETRY: 'true' } });
    return true;
  } catch {
    return false;
  }
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        server.close();
        reject(new Error('no port'));
        return;
      }
      const port = address.port;
      server.close(() => resolve(port));
    });
  });
}

async function waitForCdp(url: string, child: ChildProcess): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`lightpanda exited with code ${child.exitCode}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('lightpanda CDP endpoint did not become ready');
}

test('studio E2E: create, edit, save and reopen a draft in a real browser', async (t) => {
  if (!lightpandaAvailable()) {
    t.skip('lightpanda is not installed; browser E2E skipped (not a pass)');
    return;
  }
  try {
    await readFile(join(studioDist, 'index.html'));
  } catch {
    t.skip('dist/studio is missing; run npm run build:studio first');
    return;
  }

  const workspace = await mkdtemp(join(tmpdir(), 'molecula-e2e-ws-'));
  const handle = await startCompanionServer({
    workspaceRoot: workspace,
    studioDir: studioDist,
    token: 'e2e-token',
  });
  const cdpPort = await freePort();
  const lightpanda = spawn(
    'lightpanda',
    ['serve', '--host', '127.0.0.1', '--port', String(cdpPort)],
    { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, LIGHTPANDA_DISABLE_TELEMETRY: 'true' } },
  );

  let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | null = null;
  try {
    await waitForCdp(`http://127.0.0.1:${cdpPort}/json/version`, lightpanda);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = await context.newPage();
    const runtimeErrors: string[] = [];
    const consoleErrors: string[] = [];
    page.on('pageerror', (error) => runtimeErrors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });

    await page.goto(handle.origin, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'Molecula Studio' }).waitFor();
    await page.getByLabel('Nombre').fill('El viaje de la sal');
    await page.getByRole('button', { name: 'Nuevo proyecto' }).click();

    // Editor opened for the new draft.
    await page.getByRole('button', { name: 'Guardar' }).waitFor();
    await page.getByLabel('Idea').fill('Explicar cómo llega la sal a nuestra mesa.');
    await page.getByRole('button', { name: 'Añadir escena' }).click();
    await page.getByLabel('Texto').fill('El agua se evapora y deja sal.');
    await page.getByText('Cambios sin guardar').waitFor();

    await page.getByRole('button', { name: 'Guardar' }).click();
    await page.getByText(/Guardado · rev\. 1/).waitFor();

    // Real disk oracle: the committed bytes parse and carry the edits.
    const projectDirs = (await readdir(workspace)).filter((name) => name.startsWith('p-'));
    assert.equal(projectDirs.length, 1);
    const projectId = projectDirs[0] as string;
    const onDisk = parseProjectText(await readFile(join(workspace, projectId, 'project.json')));
    assert.ok(onDisk.ok);
    assert.equal(onDisk.project.title, 'El viaje de la sal');
    assert.equal(onDisk.project.idea, 'Explicar cómo llega la sal a nuestra mesa.');
    assert.equal(onDisk.project.scenes.length, 1);
    assert.equal(onDisk.project.scenes[0]?.text, 'El agua se evapora y deja sal.');
    assert.equal(onDisk.project.revision, 1);

    // Reopen from the companion: the same draft is recovered.
    await page.goto(handle.origin, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Abrir' }).click();
    await page.getByRole('button', { name: 'Guardar' }).waitFor();
    assert.equal(await page.getByLabel('Idea').inputValue(), 'Explicar cómo llega la sal a nuestra mesa.');
    assert.equal(await page.getByLabel('Texto').inputValue(), 'El agua se evapora y deja sal.');
    await page.getByText(/rev\. 1/).waitFor();

    await page.getByRole('button', { name: 'Proyectos', exact: true }).click();
    const external = {
      ...emptyProject({ projectId: 'p-external', now: '2026-11-01T00:00:00.000Z', title: 'Externo' }),
      approval: { contentDigest: 'a'.repeat(64), approvedRevision: 0, approvedAt: '2026-11-01T00:00:00.000Z' },
      assets: [{ assetId: 'voz', kind: 'audio', path: 'assets/voz.wav', mimeType: 'audio/wav', byteLength: 1,
        sha256: null, durationMs: 1000, source: { origin: 'user', license: 'CC0', attribution: '' } }],
    };
    const upload = { name: 'project.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(external)) };
    await page.getByLabel('JSON externo').setInputFiles({ ...upload, buffer: Buffer.from('{invalid') });
    await page.getByRole('alert').waitFor();
    assert.equal((await readdir(workspace)).filter((name) => !name.startsWith('.')).length, 1);
    await page.getByLabel('JSON externo').setInputFiles(upload);
    await page.getByText(/La aprobación importada se eliminó/).waitFor();
    await page.getByRole('heading', { name: 'Manifest de recursos' }).waitFor();
    await page.evaluate(() => {
      const original = File.prototype.arrayBuffer;
      File.prototype.arrayBuffer = async function () {
        const bytes = await original.call(this);
        await new Promise<void>((resolve) => { (globalThis as unknown as { releaseFileRead: () => void }).releaseFileRead = resolve; });
        File.prototype.arrayBuffer = original;
        return bytes;
      };
    });
    await page.getByLabel('Revincular voz').setInputFiles({ name: 'voice.wav', mimeType: 'audio/wav', buffer: Buffer.from(wavBytes()) });
    await page.waitForFunction(() => typeof (globalThis as unknown as { releaseFileRead?: unknown }).releaseFileRead === 'function');
    await page.getByLabel('Idea').fill('No perder este borrador');
    await page.evaluate(() => (globalThis as unknown as { releaseFileRead: () => void }).releaseFileRead());
    await page.getByRole('alert').waitFor();
    assert.equal((parseProjectText(await readFile(join(workspace, 'p-external', 'project.json'))) as { project: { revision: number } }).project.revision, 1);
    assert.deepEqual(await readdir(join(workspace, 'p-external', 'assets')), []);
    assert.equal(await page.getByLabel('Revincular voz').isDisabled(), true);
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await page.getByText(/Guardado · rev\. 2/).waitFor();
    // Hold a real HTTP response after its disk write: pending UI cannot accept
    // edits/navigation and then overwrite them with an older response.
    await page.evaluate(() => {
      const original = globalThis.fetch.bind(globalThis);
      globalThis.fetch = async (...args: Parameters<typeof fetch>) => {
        const response = await original(...args);
        if (String(args[0]).includes('/assets/')) {
          await new Promise<void>((resolve) => { (globalThis as unknown as { releaseRelink: () => void }).releaseRelink = resolve; });
          globalThis.fetch = original;
        }
        return response;
      };
    });
    await page.getByLabel('Revincular voz').setInputFiles({ name: 'voice.wav', mimeType: 'audio/wav', buffer: Buffer.from(wavBytes()) });
    await page.getByText('Operación en curso…').waitFor();
    assert.equal(await page.getByLabel('Idea').isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: 'Proyectos', exact: true }).isDisabled(), true);
    await page.waitForFunction(() => typeof (globalThis as unknown as { releaseRelink?: unknown }).releaseRelink === 'function');
    await page.evaluate(() => (globalThis as unknown as { releaseRelink: () => void }).releaseRelink());
    await page.getByText(/Recurso revinculado/).waitFor();
    assert.deepEqual(await readFile(join(workspace, 'p-external', 'assets', 'voz.wav')), Buffer.from(wavBytes()));
    assert.equal(await page.getByLabel('Idea').inputValue(), 'No perder este borrador');
    await page.getByLabel('Revincular voz').setInputFiles({ name: 'different.wav', mimeType: 'audio/wav', buffer: Buffer.from(wavBytes({ durationMs: 800 })) });
    await page.getByRole('button', { name: 'Confirmar sustitución' }).waitFor();
    await page.getByRole('button', { name: 'Cancelar sustitución' }).click();
    assert.deepEqual(await readFile(join(workspace, 'p-external', 'assets', 'voz.wav')), Buffer.from(wavBytes()));
    await page.getByLabel('Revincular voz').setInputFiles({ name: 'different.wav', mimeType: 'audio/wav', buffer: Buffer.from(wavBytes({ durationMs: 800 })) });
    await page.getByRole('button', { name: 'Confirmar sustitución' }).click();
    await page.getByText(/Recurso revinculado con identificador nuevo/).waitFor();
    const replaced = parseProjectText(await readFile(join(workspace, 'p-external', 'project.json')));
    assert.ok(replaced.ok);
    assert.notEqual(replaced.project.assets[0]?.assetId, 'voz');
    assert.deepEqual(await readFile(join(workspace, 'p-external', replaced.project.assets[0]!.path)), Buffer.from(wavBytes({ durationMs: 800 })));
    const externalEdit = JSON.stringify({ ...replaced.project, idea: 'External same-revision edit' });
    await writeFile(join(workspace, 'p-external', 'project.json'), externalEdit);
    await page.getByLabel(`Revincular ${replaced.project.assets[0]!.assetId}`).setInputFiles({ name: 'same.wav', mimeType: 'audio/wav', buffer: Buffer.from(wavBytes({ durationMs: 800 })) });
    await page.getByRole('alert').waitFor();
    assert.equal(await page.getByLabel('Idea').inputValue(), 'No perder este borrador');
    assert.equal(await readFile(join(workspace, 'p-external', 'project.json'), 'utf8'), externalEdit);
    await page.getByRole('button', { name: 'Proyectos', exact: true }).click();
    await page.getByLabel('JSON externo').setInputFiles(upload);
    await page.getByRole('button', { name: 'Crear copia importada' }).waitFor();
    const originalBytes = await readFile(join(workspace, 'p-external', 'project.json'));
    await page.getByRole('button', { name: 'Crear copia importada' }).click();
    await page.getByRole('heading', { name: 'Manifest de recursos' }).waitFor();
    assert.deepEqual(await readFile(join(workspace, 'p-external', 'project.json')), originalBytes);
    assert.equal((await readdir(workspace)).filter((name) => !name.startsWith('.')).length, 3);
    assert.deepEqual(runtimeErrors, []);
    // Resource errors are expected only for the deliberately rejected invalid
    // import, three collision checks and one stale-digest rejection; no JS errors are ignored.
    assert.deepEqual(consoleErrors.sort(), [
      ...Array<string>(4).fill('Failed to load resource: the server responded with a status of 409 (Conflict)'),
      'Failed to load resource: the server responded with a status of 422 (Unprocessable Entity)',
    ].sort());

    await page.close();
  } finally {
    await browser?.close().catch(() => undefined);
    lightpanda.kill('SIGTERM');
    await handle.close();
    await rm(workspace, { recursive: true, force: true });
  }
});
