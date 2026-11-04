import test from 'node:test';
import assert from 'node:assert/strict';

import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright-core';

import { parseProjectText } from '../../src/shared/schema/parse.ts';
import { startCompanionServer } from '../../src/companion/server/http.ts';

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

    await page.close();
  } finally {
    await browser?.close().catch(() => undefined);
    lightpanda.kill('SIGTERM');
    await handle.close();
    await rm(workspace, { recursive: true, force: true });
  }
});
