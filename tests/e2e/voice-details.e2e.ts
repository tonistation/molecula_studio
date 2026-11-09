import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { withStudio } from '../helpers/studio-browser.ts';
import { fixtureText } from '../helpers/fixtures.ts';
import { toneWav } from '../helpers/playable-audio.ts';

test('voice details and existing samples work on desktop/mobile; switching/unmounting stops, cancels and revokes without TTS/STT', async t => {
  let samples = 0; let posts = 0; let calls = 0;
  let notify!: () => void; let disconnected!: () => void;
  const requested = new Promise<void>(resolve => { notify = resolve; });
  const closed = new Promise<void>(resolve => { disconnected = resolve; });
  const audio = toneWav(8000);
  const fake = createServer((req, res) => {
    calls++; assert.equal(req.headers['xi-api-key'], 'fixture-sample-key');
    if (req.method === 'POST') { posts++; res.writeHead(500).end(); return; }
    if (req.url?.startsWith('/v1/capcut/system-voices')) {
      res.end(JSON.stringify({ voice_list: [
        { voice_id: 'sample', name: 'Narradora de muestra', language: 'es', gender: 'Female', tags: ['steady'], preview_url: `${base}/v1/capcut/voices/sample/preview` },
        { voice_id: 'unknown', name: 'Voz sin datos' },
        { voice_id: 'slow', name: 'Muestra lenta', preview_url: `${base}/v1/capcut/voices/slow/preview` },
      ], has_more: false })); return;
    }
    samples++;
    if (req.url === '/v1/capcut/voices/slow/preview') { res.once('close', disconnected); notify(); return; }
    assert.equal(req.url, '/v1/capcut/voices/sample/preview');
    res.writeHead(200, { 'content-type': 'audio/wav' }).end(audio);
  });
  await new Promise<void>(resolve => fake.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(fake.address() as { port: number }).port}`;
  t.after(() => new Promise<void>(resolve => fake.close(() => resolve())));
  await withStudio(t, async ({ page, consoleErrors, resourceErrors }) => {
    page.setDefaultTimeout(15000);
    await page.evaluate(() => {
      const revoked: string[] = []; (window as unknown as { sampleRevocations: string[] }).sampleRevocations = revoked;
      const revoke = URL.revokeObjectURL.bind(URL);
      URL.revokeObjectURL = url => { revoked.push(url); revoke(url); };
    });
    await page.getByLabel('JSON externo').setInputFiles({ name: 'project.json', mimeType: 'application/json', buffer: Buffer.from(fixtureText('storyboard')) });
    const voice = page.getByRole('region', { name: 'Voz automática', exact: true });
    const select = voice.getByLabel('Voz para generar');
    const details = voice.getByRole('region', { name: 'Detalles de la voz' });
    await voice.getByRole('button', { name: 'Cargar voces Vibi', exact: true }).click();
    await select.selectOption('sample');
    assert.equal(await select.locator('option:checked').textContent(), 'Narradora de muestra · Español');
    await details.getByText('Español', { exact: true }).waitFor(); await details.getByText('Femenina', { exact: true }).waitFor();
    await details.getByText('Estable', { exact: true }).waitFor();
    assert.equal(await details.getByText('Acento', { exact: true }).count(), 0, 'CapCut steady is not geography');
    assert.equal(samples, 0);
    await details.getByRole('button', { name: 'Escuchar muestra', exact: true }).focus(); await page.keyboard.press('Enter');
    await page.waitForFunction(() => { const audio = document.querySelector('.voice-details audio') as HTMLAudioElement; return audio && !audio.paused && audio.currentTime > 0; });
    const player = await details.locator('audio').elementHandle(); assert.ok(player);
    const src = await player.getAttribute('src'); assert.ok(src?.startsWith('blob:'));
    if (process.env.PREVIEW_SCREENSHOT_DIR) await details.screenshot({ path: join(process.env.PREVIEW_SCREENSHOT_DIR, 'voice-details-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await details.scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await details.getByRole('button', { name: 'Detener', exact: true }).isVisible(), true);
    if (process.env.PREVIEW_SCREENSHOT_DIR) await details.screenshot({ path: join(process.env.PREVIEW_SCREENSHOT_DIR, 'voice-details-mobile.png') });
    await select.selectOption('unknown');
    await details.getByText('Idioma/acento no informado', { exact: true }).waitFor();
    assert.equal(await details.getByRole('button', { name: 'Escuchar muestra', exact: true }).isDisabled(), true);
    assert.equal(await player.evaluate(audio => (audio as HTMLAudioElement).paused && !audio.getAttribute('src')), true);
    assert.equal(await page.evaluate(url => (window as unknown as { sampleRevocations: string[] }).sampleRevocations.includes(url!), src), true);
    await select.selectOption('slow'); await details.getByRole('button', { name: 'Escuchar muestra', exact: true }).click();
    await requested; await details.getByText('Cargando muestra…', { exact: true }).waitFor();
    await select.selectOption('unknown'); await closed;
    assert.equal(await details.locator('audio').getAttribute('src'), null);
    await select.selectOption('sample'); await details.getByRole('button', { name: 'Escuchar muestra', exact: true }).click();
    await page.waitForFunction(() => !(document.querySelector('.voice-details audio') as HTMLAudioElement).paused);
    await details.getByRole('button', { name: 'Detener', exact: true }).click();
    assert.equal(await details.locator('audio').getAttribute('src'), null);
    await details.getByRole('button', { name: 'Escuchar muestra', exact: true }).click();
    await page.waitForFunction(() => !(document.querySelector('.voice-details audio') as HTMLAudioElement).paused);
    const last = await details.locator('audio').elementHandle(); assert.ok(last);
    await page.getByRole('button', { name: 'Proyectos', exact: true }).click();
    assert.equal(await last.evaluate(audio => (audio as HTMLAudioElement).paused && !audio.getAttribute('src')), true);
    assert.equal(posts, 0); assert.equal(samples, 4); assert.equal(calls, 5, 'only one catalog plus four existing samples');
    assert.deepEqual(consoleErrors, []); assert.deepEqual(resourceErrors, []);
  }, 'chromium', undefined, { apiKey: 'fixture-sample-key', voiceId: '', provider: 'capcut', modelId: 'capcut', baseUrl: base });
});

test('a failed existing sample shows recoverable feedback instead of generating a replacement', async t => {
  let fail = true; let samples = 0; let posts = 0;
  const fake = createServer((req, res) => {
    if (req.method === 'POST') { posts++; res.writeHead(500).end(); return; }
    if (req.url?.startsWith('/v1/capcut/system-voices')) {
      res.end(JSON.stringify({ voice_list: [{ voice_id: 'retry', name: 'Muestra recuperable', preview_url: `${base}/v1/capcut/voices/retry/preview` }], has_more: false })); return;
    }
    assert.equal(req.url, '/v1/capcut/voices/retry/preview'); samples++;
    res.writeHead(200, { 'content-type': fail ? 'text/html' : 'audio/wav' }).end(fail ? 'not audio' : toneWav());
  });
  await new Promise<void>(resolve => fake.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(fake.address() as { port: number }).port}`;
  t.after(() => new Promise<void>(resolve => fake.close(() => resolve())));
  await withStudio(t, async ({ page, consoleErrors, resourceErrors }) => {
    page.setDefaultTimeout(15000);
    await page.getByLabel('JSON externo').setInputFiles({ name: 'project.json', mimeType: 'application/json', buffer: Buffer.from(fixtureText('storyboard')) });
    const voice = page.getByRole('region', { name: 'Voz automática', exact: true });
    await voice.getByRole('button', { name: 'Cargar voces Vibi', exact: true }).click();
    await voice.getByLabel('Voz para generar').selectOption('retry');
    const details = voice.getByRole('region', { name: 'Detalles de la voz' });
    await details.getByRole('button', { name: 'Escuchar muestra', exact: true }).click();
    await details.getByText('Muestra no disponible: formato no compatible (text/html). No se generó audio nuevo. Puede continuar con esta voz o volver a intentar la muestra.', { exact: true }).waitFor();
    assert.equal(await details.locator('audio').getAttribute('src'), null);
    assert.equal(samples, 1); assert.equal(posts, 0);
    fail = false; await details.getByRole('button', { name: 'Escuchar muestra', exact: true }).click();
    await page.waitForFunction(() => !(document.querySelector('.voice-details audio') as HTMLAudioElement).paused);
    assert.equal(samples, 2); assert.equal(posts, 0);
    assert.deepEqual(consoleErrors, ['Failed to load resource: the server responded with a status of 502 (Bad Gateway)']);
    assert.deepEqual(resourceErrors, ['/api/vibi/voices/capcut/retry/preview']);
  }, 'chromium', undefined, { apiKey: 'fixture-failure-only', provider: 'capcut', voiceId: '', modelId: 'capcut', baseUrl: base });
});
