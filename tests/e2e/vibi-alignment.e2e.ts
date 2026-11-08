import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { withStudio } from '../helpers/studio-browser.ts';
import { fixtureText } from '../helpers/fixtures.ts';
import { toneWav } from '../helpers/playable-audio.ts';

test('Vibi alignment UI: duration and unknown tariff before explicit spend, cancel/stale protection, aligned and estimated feedback', async t => {
  let posts = 0; let mismatch = false;
  const source = JSON.parse(fixtureText('storyboard'));
  const tokens = source.scenes[0].text.match(/\S+/gu) as string[];
  const fake = createServer((req, res) => {
    req.resume(); assert.equal(req.headers['xi-api-key'], 'e2e-fake-only-key');
    if (req.method === 'POST') { posts++; res.writeHead(202).end(JSON.stringify({ task_id: 'e2e-stt' })); }
    else res.end(JSON.stringify({ status: 'completed', result: { words: (mismatch ? [...tokens, 'extra'] : tokens)
      .map((text, index) => ({ text, start: index * 0.1, end: (index + 1) * 0.1, type: 'word' })) } }));
  });
  await new Promise<void>(resolve => fake.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => fake.close(() => resolve())));
  await withStudio(t, async ({ page, root, consoleErrors, resourceErrors }) => {
    page.setDefaultTimeout(15000);
    await page.getByLabel('JSON externo').setInputFiles({ name: 'project.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(source)) });
    const voice = page.getByRole('region', { name: 'Voz manual', exact: true });
    await page.waitForFunction(() => !document.querySelector<HTMLOptionElement>('option[value="vibi"]')?.disabled);
    await voice.getByLabel('Licencia o permiso de uso del audio').fill('Señal propia de prueba');
    await voice.getByLabel('Alineación de subtítulos').selectOption('vibi');
    const select = () => voice.getByLabel('Subir audio · escena 1').setInputFiles({ name: 'tone.wav', mimeType: 'audio/wav', buffer: toneWav() });
    await select();
    const confirmation = voice.getByRole('region', { name: 'Confirmar alineación Vibi' });
    await confirmation.getByText(/aproximadamente 2.00 s/).waitFor();
    await confirmation.getByText(/Tarifa exacta no disponible/).waitFor();
    assert.equal(posts, 0, 'local decoding and selection do not spend');
    if (process.env.PREVIEW_SCREENSHOT_DIR) await confirmation.screenshot({ path: join(process.env.PREVIEW_SCREENSHOT_DIR, 'vibi-consent-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await confirmation.scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    if (process.env.PREVIEW_SCREENSHOT_DIR) await voice.screenshot({ path: join(process.env.PREVIEW_SCREENSHOT_DIR, 'vibi-consent-mobile.png') });
    await page.setViewportSize({ width: 1280, height: 1400 });
    await confirmation.getByRole('button', { name: 'Cancelar alineación' }).click();
    assert.equal(posts, 0);
    await select(); await confirmation.waitFor();
    await page.getByLabel('Texto').first().fill('Cambio sin guardar');
    assert.equal(await confirmation.count(), 0, 'pending consent invalidated by editor changes');
    assert.equal(posts, 0);
    await page.getByLabel('Texto').first().fill(source.scenes[0].text);
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await page.getByText('Sin cambios pendientes', { exact: false }).waitFor();
    await select(); await confirmation.waitFor();
    await confirmation.getByRole('button', { name: 'Confirmar envío y consumo de créditos' }).click();
    await voice.getByText('Audio guardado. Subtítulos alineados con Vibi.', { exact: true }).waitFor();
    assert.equal(posts, 1);
    const saved = JSON.parse(await readFile(join(root, source.projectId, 'project.json'), 'utf8'));
    assert.equal(saved.scenes[0].words[0].endMs, 100);
    assert.doesNotMatch(JSON.stringify(saved), /e2e-fake-only-key/);
    mismatch = true;
    await select(); await confirmation.waitFor();
    await confirmation.getByRole('button', { name: 'Confirmar envío y consumo de créditos' }).click();
    await voice.getByText(/Audio guardado\. La cantidad de palabras transcritas no coincide.*\[word-count-mismatch\].*estimados, no alineación real/).waitFor();
    assert.equal(posts, 2);
    assert.deepEqual(consoleErrors, []); assert.deepEqual(resourceErrors, []);
  }, 'chromium', undefined, { apiKey: 'e2e-fake-only-key', baseUrl: `http://127.0.0.1:${(fake.address() as { port: number }).port}`, pollIntervalMs: 2 });
});
