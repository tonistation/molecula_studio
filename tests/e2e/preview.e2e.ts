import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixtureText } from '../helpers/fixtures.ts';
import { wavBytes } from '../helpers/media.ts';
import { toneWav } from '../helpers/playable-audio.ts';
import { withStudio } from '../helpers/studio-browser.ts';

test('preview: live unsaved captions, draft scene seek, play/pause and visible 9:16 WebGL in Chromium', async t => {
  await withStudio(t, async ({ page, root, consoleErrors, resourceErrors }) => {
    page.setDefaultTimeout(15000);
    await page.setViewportSize({ width: 1280, height: 1400 });
    await page.getByLabel('JSON externo').setInputFiles({ name: 'project.json', mimeType: 'application/json', buffer: Buffer.from(fixtureText('storyboard')) });
    const preview = page.getByRole('region', { name: 'Vista previa del borrador' });
    const player = preview.locator('.preview-transport');
    await player.locator('canvas').waitFor();
    await page.waitForFunction(() => document.fonts.check('800 48px "Molecula Montserrat"'));
    const id = JSON.parse(fixtureText('storyboard')).projectId;
    const saved = await readFile(join(root, id, 'project.json'));
    const bounds = await player.boundingBox();
    assert.ok(bounds);
    assert.ok(Math.abs(bounds.width / bounds.height - 9 / 16) < 0.001);

    await page.getByLabel('Texto').first().fill('Borrador visible ahora');
    await preview.locator('[data-caption-word="Borrador"]').waitFor();
    await page.getByText('Cambios sin guardar', { exact: true }).waitFor();
    assert.deepEqual(await readFile(join(root, id, 'project.json')), saved, 'preview never saves');
    await page.getByLabel('Duración en segundos').first().fill('3');
    await page.getByRole('button', { name: 'Ver escena 2', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.preview-transport')?.textContent?.includes('0:03'));
    await page.getByRole('button', { name: 'Ver escena 1', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.preview-transport')?.textContent?.includes('0:00'));
    await preview.getByRole('button', { name: 'Play video', exact: true }).click();
    await preview.getByRole('button', { name: 'Pause video', exact: true }).waitFor();
    await page.waitForFunction(() => document.querySelector('.preview-transport')?.textContent?.includes('0:01'));
    await preview.getByRole('button', { name: 'Pause video', exact: true }).click();
    await preview.getByRole('button', { name: 'Play video', exact: true }).waitFor();
    const pausedTime = await player.innerText();
    await page.waitForTimeout(250);
    assert.equal(await player.innerText(), pausedTime, 'pause freezes the frame');
    // Real pointer input to Remotion's built-in scrub bar, not a DOM click bypass.
    const bar = player.locator('div[style*="touch-action: none"]');
    const barBounds = await bar.boundingBox();
    assert.ok(barBounds);
    await bar.click({ position: { x: barBounds.width * 0.8, y: barBounds.height / 2 } });
    await page.waitForFunction(() => document.querySelector('.preview-transport')?.textContent?.includes('0:07'));
    await page.getByRole('button', { name: 'Ver escena 1', exact: true }).click();
    await preview.locator('[data-caption-word="Borrador"]').waitFor();
    // Invalid intermediate text is visible and correction remounts a working preview.
    await page.getByLabel('Texto').first().fill('x'.repeat(81));
    await preview.getByText(/No se puede mostrar este borrador/).waitFor();
    await page.getByLabel('Texto').first().fill('Borrador visible ahora');
    await player.locator('canvas').waitFor();
    await page.waitForTimeout(500);
    if (process.env.PREVIEW_SCREENSHOT_DIR) {
      await preview.screenshot({ path: join(process.env.PREVIEW_SCREENSHOT_DIR, 'preview-desktop.png') });
      await page.screenshot({ path: join(process.env.PREVIEW_SCREENSHOT_DIR, 'preview-editor.png'), fullPage: true });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await preview.scrollIntoViewIfNeeded();
    assert.ok(await preview.getByRole('button', { name: 'Play video', exact: true }).isVisible());
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    if (process.env.PREVIEW_SCREENSHOT_DIR) await preview.screenshot({ path: join(process.env.PREVIEW_SCREENSHOT_DIR, 'preview-mobile.png') });
    assert.deepEqual(consoleErrors, [], 'no console/CSP errors');
    assert.deepEqual(resourceErrors, [], 'all local resources load');
  }, 'chromium');
});

test('preview: React cleanup revokes live blobs and aborts pending media without creating late URLs', async t => {
  await withStudio(t, async ({ page, consoleErrors, resourceErrors }) => {
    await page.evaluate(() => {
      const state = { created: [] as string[], revoked: [] as string[], hold: false, aborted: false,
        release: null as (() => void) | null };
      Object.assign(globalThis, { previewLifecycle: state });
      const create = URL.createObjectURL.bind(URL);
      const revoke = URL.revokeObjectURL.bind(URL);
      URL.createObjectURL = blob => { const url = create(blob); state.created.push(url); return url; };
      URL.revokeObjectURL = url => { state.revoked.push(url); revoke(url); };
      const request = globalThis.fetch.bind(globalThis);
      globalThis.fetch = async (...args: Parameters<typeof fetch>) => {
        const response = await request(...args);
        if (state.hold && String(args[0]).includes('/assets/') && args[1]?.method === 'GET') {
          args[1].signal?.addEventListener('abort', () => { state.aborted = true; });
          await new Promise<void>(resolve => { state.release = resolve; });
        }
        return response;
      };
    });
    const source = JSON.parse(fixtureText('storyboard'));
    const audio = wavBytes();
    source.assets = [{ assetId: 'preview_voice', kind: 'audio', path: 'assets/preview_voice.wav',
      mimeType: 'audio/wav', byteLength: audio.length, sha256: null, durationMs: 1000,
      source: { origin: 'fixture', license: 'Synthetic test data', attribution: '' } }];
    source.scenes[0].audio = { assetId: 'preview_voice', offsetMs: 0, gainDb: 0 };
    await page.getByLabel('JSON externo').setInputFiles({ name: 'project.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(source)) });
    await page.getByLabel('Revincular preview_voice').setInputFiles({ name: 'voice.wav', mimeType: 'audio/wav', buffer: Buffer.from(audio) });
    await page.getByText(/Recurso revinculado/).waitFor();
    await page.waitForFunction(() => (globalThis as any).previewLifecycle.created.length === 1);
    // Verify actual blob media is permitted by CSP, without adding voice to the composition.
    await page.evaluate(async () => {
      const media = new Audio((globalThis as any).previewLifecycle.created[0]);
      await new Promise<void>((resolve, reject) => {
        media.onloadedmetadata = () => resolve();
        media.onerror = () => reject(new Error('local blob media failed to load'));
      });
      media.removeAttribute('src');
      media.load();
    });
    await page.getByRole('button', { name: 'Proyectos', exact: true }).click();
    await page.waitForFunction(() => (globalThis as any).previewLifecycle.revoked.length === 1);
    await page.evaluate(() => { (globalThis as any).previewLifecycle.hold = true; });
    await page.getByRole('button', { name: 'Abrir', exact: true }).click();
    await page.waitForFunction(() => (globalThis as any).previewLifecycle.release !== null);
    await page.getByRole('button', { name: 'Proyectos', exact: true }).click();
    await page.waitForFunction(() => (globalThis as any).previewLifecycle.aborted);
    await page.evaluate(() => (globalThis as any).previewLifecycle.release());
    await page.waitForTimeout(100);
    const state = await page.evaluate(() => (globalThis as any).previewLifecycle);
    assert.equal(state.created.length, 1, 'no late blob created after unmount');
    assert.deepEqual(state.revoked, state.created, 'every live URL revoked');
    assert.deepEqual(consoleErrors, []);
    assert.deepEqual(resourceErrors, []);
  }, 'chromium');
});

test('preview: playback waits for the current audio blobs before starting', async t => {
  await withStudio(t, async ({ page }) => {
    await page.evaluate(() => {
      const state = { hold: false, release: null as (() => void) | null };
      Object.assign(globalThis, { previewDelay: state });
      const request = globalThis.fetch.bind(globalThis);
      globalThis.fetch = async (...args: Parameters<typeof fetch>) => {
        const response = await request(...args);
        if (state.hold && String(args[0]).includes('/assets/') && args[1]?.method === 'GET') {
          await new Promise<void>(resolve => { state.release = resolve; });
        }
        return response;
      };
    });
    const source = JSON.parse(fixtureText('storyboard'));
    const audio = toneWav(1000);
    source.output.voiceMode = 'withVoice';
    source.assets = [{ assetId: 'preview_voice', kind: 'audio', path: 'assets/preview_voice.wav',
      mimeType: 'audio/wav', byteLength: audio.length, sha256: null, durationMs: 1000,
      source: { origin: 'fixture', license: 'Synthetic test data', attribution: '' } }];
    source.scenes[0].audio = { assetId: 'preview_voice', offsetMs: 0, gainDb: 0 };
    await page.getByLabel('JSON externo').setInputFiles({ name: 'project.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(source)) });
    await page.getByLabel('Revincular preview_voice').setInputFiles({ name: 'voice.wav', mimeType: 'audio/wav', buffer: Buffer.from(audio) });
    await page.getByText(/Recurso revinculado/).waitFor();
    await page.getByRole('button', { name: 'Proyectos', exact: true }).click();
    await page.evaluate(() => { (globalThis as any).previewDelay.hold = true; });
    await page.getByRole('button', { name: 'Abrir', exact: true }).click();
    await page.waitForFunction(() => (globalThis as any).previewDelay.release !== null);
    const preview = page.getByRole('region', { name: 'Vista previa del borrador' });
    assert.equal(await preview.getByRole('button', { name: 'Play video', exact: true }).count(), 0,
      'cannot start the timeline before audio arrives');
    await page.evaluate(() => (globalThis as any).previewDelay.release());
    await preview.getByRole('button', { name: 'Play video', exact: true }).waitFor();
    await preview.getByRole('button', { name: 'Play video', exact: true }).click();
    await page.waitForFunction(() => [...document.querySelectorAll('audio')].some(audio =>
      audio.src.startsWith('blob:') && !audio.paused && audio.currentTime > 0.1));
  }, 'chromium');
});
