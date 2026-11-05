import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { OwnedChild, freeLoopbackPort, waitReady } from './companion-process.ts';

export async function closeOwnedBrowser(browser: Pick<Browser, 'close'>, child: Pick<OwnedChild, 'stop'>): Promise<void> {
  try { await browser.close(); }
  finally { await child.stop(); }
}

/** Fresh OS process, no cookies/storage restored. Chromium for projects mounting WebGL. */
export async function processBrowser(origin: string, engine: 'lightpanda' | 'chromium' = 'lightpanda'): Promise<{
  page: Page; pid: number; consoleErrors: string[]; runtimeErrors: string[];
  assertClean: (expectedConsole?: string[]) => void; close: () => Promise<void>;
}> {
  const port = await freeLoopbackPort();
  const profile = engine === 'chromium' ? await mkdtemp(join(tmpdir(), 'molecula-chrome-')) : null;
  const child = engine === 'chromium'
    ? new OwnedChild('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
      '--headless', '--use-gl=angle', '--disable-background-networking', '--disable-component-update',
      '--disable-sync', '--no-first-run', `--user-data-dir=${profile}`,
      '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${port}`, 'about:blank',
    ], process.env)
    : new OwnedChild('lightpanda', ['serve', '--host', '127.0.0.1', '--port', String(port)],
      { ...process.env, LIGHTPANDA_DISABLE_TELEMETRY: 'true' });
  let browser: Browser | undefined;
  try {
    await waitReady(child, async () => (await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: AbortSignal.timeout(500),
    })).ok);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const context = browser.contexts()[0] ?? await browser.newContext({ serviceWorkers: 'block' });
    const blocked: string[] = [];
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.origin === origin) await route.continue();
      else { blocked.push(url.origin); await route.abort('blockedbyclient'); }
    });
    // Prove interception before the application loads; never contact this IP.
    const probe = await context.newPage();
    assert.equal(await probe.evaluate(async () => {
      try { await fetch('http://198.51.100.1/f08-offline-probe'); return false; } catch { return true; }
    }), true);
    assert.deepEqual(blocked, ['http://198.51.100.1']);
    blocked.length = 0;
    await probe.close();
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    const consoleErrors: string[] = [];
    const runtimeErrors: string[] = [];
    page.on('pageerror', (error) => runtimeErrors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    return { page, pid: child.child.pid!, consoleErrors, runtimeErrors,
      assertClean: (expectedConsole = []) => {
        assert.deepEqual(runtimeErrors, [], 'no runtime errors');
        assert.deepEqual(consoleErrors, expectedConsole, 'only explicitly induced HTTP errors');
        assert.deepEqual(blocked, [], 'application requested no external network');
      },
      close: async () => {
        try { await closeOwnedBrowser(browser!, child); }
        finally { if (profile) await rm(profile, { recursive: true, force: true }); }
      },
    };
  } catch (error) {
    await browser?.close().catch(() => undefined);
    await child.stop();
    if (profile) await rm(profile, { recursive: true, force: true });
    throw error;
  }
}
