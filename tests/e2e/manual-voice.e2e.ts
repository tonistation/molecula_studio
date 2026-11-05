import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { withStudio } from '../helpers/studio-browser.ts';
import { fixtureText } from '../helpers/fixtures.ts';
import { toneWav } from '../helpers/playable-audio.ts';
import { bindingDigests, sha256Hex } from '../../src/shared/digests.ts';

test('manual voice: real PCM upload, current bindings, frame-synced playback/seek and preserved dirty draft in Chromium', async t => {
  await withStudio(t, async ({ page, root, consoleErrors, resourceErrors }) => {
    page.setDefaultTimeout(15000);
    await page.setViewportSize({ width: 1280, height: 1400 });
    await page.evaluate(() => {
      const taps: AnalyserNode[] = [];
      const urls: { url: string; hash: string }[] = [];
      Object.assign(globalThis, { voiceTaps: taps, voiceUrls: urls });
      const createUrl = URL.createObjectURL.bind(URL);
      URL.createObjectURL = blob => {
        const url = createUrl(blob);
        if (blob instanceof Blob) void blob.arrayBuffer().then(bytes => crypto.subtle.digest('SHA-256', bytes)).then(hash => {
          urls.push({ url, hash: [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('') });
        });
        return url;
      };
      const original = AudioContext.prototype.createMediaElementSource;
      AudioContext.prototype.createMediaElementSource = function(media) {
        const source = original.call(this, media);
        const analyser = this.createAnalyser();
        source.connect(analyser); taps.push(analyser);
        return source;
      };
    });
    const source = JSON.parse(fixtureText('storyboard'));
    await page.getByLabel('JSON externo').setInputFiles({ name: 'project.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(source)) });
    const voice = page.getByRole('region', { name: 'Voz manual', exact: true });
    const preview = page.getByRole('region', { name: 'Vista previa del borrador' });
    await voice.getByText(/1\..*sin voz/).waitFor();
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true,
      value: { writeText: async () => { throw new Error('denied by test'); } } }));
    await voice.getByRole('button', { name: 'Copiar guion de locución', exact: true }).click();
    assert.equal(await voice.getByLabel('Guion de locución para copiar').inputValue(), source.scenes.map((s: any, i: number) => `${i + 1}. ${s.title}\n${s.text}`).join('\n\n'));
    assert.equal(await voice.getByLabel('Subir audio · escena 1').isDisabled(), true, 'no invented license');
    await voice.getByLabel('Licencia o permiso de uso del audio').fill('Señal sintética propia para prueba');
    await voice.getByLabel('Subir audio · escena 1').setInputFiles({ name: 'own-tone.wav', mimeType: 'audio/wav', buffer: toneWav() });
    await voice.getByText('Audio guardado.', { exact: false }).waitFor();
    await voice.getByText(/1\..*lista/).waitFor();
    await voice.getByLabel('Subir audio · escena 2').setInputFiles({ name: 'own-tone-2.wav', mimeType: 'audio/wav', buffer: toneWav(2000, 660) });
    await voice.getByText(/2\..*lista/).waitFor();
    if (process.env.PREVIEW_SCREENSHOT_DIR) await voice.screenshot({ path: join(process.env.PREVIEW_SCREENSHOT_DIR, 'manual-voice-desktop.png') });
    const saved = JSON.parse(await readFile(join(root, source.projectId, 'project.json'), 'utf8'));
    assert.equal(saved.output.durationMs, 4600);
    for (const [index, b] of (await bindingDigests(saved)).scenes.entries()) {
      assert.equal(saved.scenes[index].mediaBindings.audio.inputDigest, b.audioInputDigest);
      assert.equal(saved.scenes[index].mediaBindings.words.inputDigest, b.wordsInputDigest);
    }
    // Inspect the media decoded by the browser as well as the actual live audio graph.
    const decoded = await page.evaluate(async ({ projectId, assetId }) => {
      const context = new AudioContext();
      const token = document.querySelector<HTMLMetaElement>('meta[name="companion-token"]')!.content;
      const response = await fetch(`/api/projects/${projectId}/assets/${assetId}`, { headers: { authorization: `Bearer ${token}` } });
      const audio = await context.decodeAudioData(await response.arrayBuffer());
      const peak = audio.getChannelData(0).reduce((max, sample) => Math.max(max, Math.abs(sample)), 0);
      await context.close();
      return { duration: audio.duration, peak };
    }, { projectId: saved.projectId, assetId: saved.scenes[0].audio.assetId });
    assert.equal(decoded.duration, 2); assert.ok(decoded.peak > 0.1);
    await page.getByRole('button', { name: 'Ver escena 1', exact: true }).click();
    await preview.getByRole('button', { name: 'Play video', exact: true }).click();
    await page.waitForFunction(() => [...document.querySelectorAll('audio')].some(a => a.src.startsWith('blob:') && !a.paused && a.currentTime > 0.3));
    await page.waitForFunction(() => (globalThis as any).voiceTaps.some((a: AnalyserNode) => {
      const data = new Float32Array(a.fftSize); a.getFloatTimeDomainData(data);
      return data.some(sample => Math.abs(sample) > 0.01);
    }));
    await preview.getByRole('button', { name: 'Pause video', exact: true }).click();
    await page.getByRole('button', { name: 'Ver escena 2', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.preview-transport')?.textContent?.includes('0:02'));
    await preview.getByRole('button', { name: 'Play video', exact: true }).click();
    const secondHash = await sha256Hex(toneWav(2000, 660));
    await page.waitForFunction(hash => [...document.querySelectorAll('audio')].some(a => !a.paused
      && a.currentTime > 0.2 && a.currentTime < 1 && (globalThis as any).voiceUrls.some((entry: any) => entry.hash === hash && entry.url === a.currentSrc)), secondHash);
    await preview.getByRole('button', { name: 'Pause video', exact: true }).click();
    const bar = preview.locator('div[style*="touch-action: none"]');
    const bounds = await bar.boundingBox(); assert.ok(bounds);
    await bar.click({ position: { x: bounds.width * 0.72, y: bounds.height / 2 } });
    await page.waitForFunction(() => [...document.querySelectorAll('audio')].some(a => a.src.startsWith('blob:') && a.currentTime > 0.85 && a.currentTime < 1.25));
    if (process.env.PREVIEW_SCREENSHOT_DIR) await preview.screenshot({ path: join(process.env.PREVIEW_SCREENSHOT_DIR, 'manual-voice-preview.png') });
    await page.getByLabel('Texto').first().fill('Texto nuevo sin guardar');
    await voice.getByText(/1\..*desactualizada/).waitFor();
    await voice.getByText(/2\..*lista/).waitFor();
    assert.equal(await voice.getByLabel('Subir audio · escena 1').isDisabled(), true);
    await voice.getByText('Guarde los cambios antes de subir audio.').waitFor();
    assert.deepEqual(JSON.parse(await readFile(join(root, source.projectId, 'project.json'), 'utf8')), saved);
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await page.getByText('Sin cambios pendientes', { exact: false }).waitFor();
    await page.getByRole('button', { name: 'Proyectos', exact: true }).click();
    await page.getByRole('button', { name: 'Abrir', exact: true }).click();
    await voice.getByText(/1\..*desactualizada/).waitFor();
    await voice.getByText(/2\..*lista/).waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    await voice.scrollIntoViewIfNeeded();
    if (process.env.PREVIEW_SCREENSHOT_DIR) await voice.screenshot({ path: join(process.env.PREVIEW_SCREENSHOT_DIR, 'manual-voice-mobile.png') });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true,
      JSON.stringify(await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth, x: scrollX,
        outside: [...document.querySelectorAll('*')].filter(el => el.getBoundingClientRect().right + scrollX > innerWidth).map(el => [el.tagName, el.className, el.getBoundingClientRect().width]) }))));
    assert.deepEqual(consoleErrors, []); assert.deepEqual(resourceErrors, []);
  }, 'chromium');
});

test('manual voice: pending uploads lock edits; stale disk and uncertain persistence preserve the current draft', async t => {
  await withStudio(t, async ({ page, store, root, fault }) => {
    page.setDefaultTimeout(15000);
    const source = JSON.parse(fixtureText('storyboard'));
    source.projectId = 'p-manual-voice';
    await page.getByLabel('JSON externo').setInputFiles({ name: 'project.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(source)) });
    const voice = page.getByRole('region', { name: 'Voz manual', exact: true });
    await voice.getByLabel('Licencia o permiso de uso del audio').fill('Prueba propia');
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let arrived!: () => void;
    const received = new Promise<void>(resolve => { arrived = resolve; });
    await page.route('**/scenes/*/audio', async route => { arrived(); await gate; await route.continue(); });
    await voice.getByLabel('Subir audio · escena 1').setInputFiles({ name: 'tone.wav', mimeType: 'audio/wav', buffer: toneWav() });
    await received;
    assert.equal(await page.getByLabel('Texto').first().isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: 'Guardar', exact: true }).isDisabled(), true);
    // Competing authenticated writer changes disk after this editor opened it.
    const current = await store.readProject(source.projectId);
    await store.saveProject({ projectId: source.projectId, expectedRevision: current.revision,
      expectedDigest: current.digest, operationId: crypto.randomUUID(),
      project: { ...current.project, title: 'External change', revision: current.revision + 1 } });
    const external = await readFile(join(root, source.projectId, 'project.json'));
    release();
    await voice.getByRole('alert').waitFor();
    assert.equal(await page.getByLabel('Nombre del proyecto').inputValue(), source.title);
    assert.equal(await page.getByLabel('Texto').first().isDisabled(), false);
    assert.deepEqual(await readFile(join(root, source.projectId, 'project.json')), external);
    await page.getByRole('button', { name: 'Recargar desde disco', exact: true }).click();
    await page.waitForFunction(() => document.querySelector<HTMLInputElement>('.title-input')?.value === 'External change');
    assert.equal(await page.getByLabel('Nombre del proyecto').inputValue(), 'External change');
    fault.value = 'audio-sync';
    await voice.getByLabel('Subir audio · escena 1').setInputFiles({ name: 'tone.wav', mimeType: 'audio/wav', buffer: toneWav() });
    await voice.getByRole('alert').filter({ hasText: /persistencia del audio es incierta/ }).waitFor();
    assert.equal(await voice.getByText('Audio guardado.', { exact: false }).count(), 0, 'never confirm an uncertain receipt');
    await voice.getByText(/1\..*sin voz/).waitFor();
    assert.ok(JSON.parse(await readFile(join(root, source.projectId, 'project.json'), 'utf8')).scenes[0].audio, 'uncertain commit may be visible');
    fault.value = 'none';
    await page.getByRole('button', { name: 'Recargar desde disco', exact: true }).click();
    await voice.getByText(/1\..*lista/).waitFor();
    assert.equal(await voice.getByRole('alert').count(), 0);
  }, 'chromium');
});
