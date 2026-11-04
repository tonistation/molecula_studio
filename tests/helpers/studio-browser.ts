import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TestContext } from 'node:test';
import { chromium, type Page } from 'playwright-core';
import { startCompanionServer } from '../../src/companion/server/http.ts';
import { ProjectStore } from '../../src/companion/store/project-store.ts';
import { createNodeFsOps } from '../../src/companion/store/fs-ops.ts';

/** DOM/logic only. Faults wrap real filesystem operations; no fake save receipts. */
export async function withStudio(t: TestContext, run: (args: {
  page: Page; root: string; store: ProjectStore; fault: { value: 'none' | 'write' | 'sync' | 'copy-sync' };
  consoleErrors: string[];
  resourceErrors: string[];
  restartCompanion: () => Promise<ProjectStore>;
}) => Promise<void>, engine: 'lightpanda' | 'chromium' = 'lightpanda'): Promise<void> {
  if (engine === 'lightpanda') {
    try { execFileSync('lightpanda', ['version'], { stdio: 'ignore', env: { ...process.env, LIGHTPANDA_DISABLE_TELEMETRY: 'true' } }); }
    catch { t.skip('Lightpanda unavailable; not a pass'); return; }
  }
  const root = await mkdtemp(join(tmpdir(), 'molecula-f06-'));
  const fault = { value: 'none' as 'none' | 'write' | 'sync' | 'copy-sync' };
  const fs = createNodeFsOps();
  const canonicalRoot = await fs.realpath(root);
  const store = new ProjectStore({ workspaceRoot: root, fsOps: {
    ...fs,
    writeFileExclusive: async (path, bytes) => {
      if (fault.value === 'write' && path.includes('project.json.tmp-')) throw new Error('injected write failure');
      return fs.writeFileExclusive(path, bytes);
    },
    syncDir: async (path) => {
      if (fault.value === 'sync' && /\/p-[^/]+$/.test(path)) throw new Error('injected sync failure');
      if (fault.value === 'copy-sync' && path === canonicalRoot) throw new Error('injected copy publication sync failure');
      return fs.syncDir(path);
    },
  } });
  await store.init();
  let handle = await startCompanionServer({ workspaceRoot: root, store,
    studioDir: fileURLToPath(new URL('../../dist/studio', import.meta.url)), token: 'f06-token' });
  const restartCompanion = async () => {
    const port = handle.port;
    await handle.close();
    // Fresh store/server instances, no receipt maps carried across. Keeping the
    // explicitly configured test token isolates retry safety from token rotation.
    handle = await startCompanionServer({ workspaceRoot: root, port,
      studioDir: fileURLToPath(new URL('../../dist/studio', import.meta.url)), token: 'f06-token' });
    return handle.store;
  };
  const port = await new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      assert.ok(address && typeof address !== 'string');
      server.close(() => resolve(address.port));
    });
  });
  const child = engine === 'lightpanda' ? spawn('lightpanda', ['serve', '--host', '127.0.0.1', '--port', String(port)], {
    stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, LIGHTPANDA_DISABLE_TELEMETRY: 'true' },
  }) : null;
  let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | undefined;
  try {
    if (engine === 'chromium') {
      browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        headless: true, args: ['--disable-background-networking', '--disable-component-update', '--disable-sync'] });
    } else {
      assert.ok(child);
      let ready = false;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if (child.exitCode !== null) throw new Error('Lightpanda exited');
        try { ready = (await fetch(`http://127.0.0.1:${port}/json/version`)).ok; } catch { /* starting */ }
        if (ready) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.ok(ready, 'CDP became ready');
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    }
    const context = browser.contexts()[0] ?? await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(4000);
    const runtimeErrors: string[] = [];
    const consoleErrors: string[] = [];
    const resourceErrors: string[] = [];
    page.on('pageerror', (error) => runtimeErrors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    page.on('response', (response) => { if (response.status() >= 400) resourceErrors.push(new URL(response.url()).pathname); });
    await page.goto(handle.origin, { waitUntil: 'domcontentloaded' });
    await run({ page, root, store, fault, consoleErrors, resourceErrors, restartCompanion });
    assert.deepEqual(runtimeErrors, [], 'no runtime errors');
    await page.close();
  } finally {
    await browser?.close().catch(() => undefined);
    child?.kill('SIGTERM');
    await handle.close();
    await store.close();
    await rm(root, { recursive: true, force: true });
  }
}

export async function newDraft(page: Page): Promise<void> {
  await page.getByLabel('Nombre', { exact: true }).fill('F06');
  await page.getByRole('button', { name: 'Nuevo proyecto' }).click();
  await page.getByLabel('Idea', { exact: true }).fill('Unsaved snapshot');
}
