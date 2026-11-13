import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withStudio } from '../helpers/studio-browser.ts';
import { fixtureText } from '../helpers/fixtures.ts';
import { toneMp3 } from '../helpers/playable-audio.ts';
import { VOICE_SAMPLE_PHRASE } from '../../src/shared/voice/sample-phrase.ts';
import { SPANISH_ACCENT_PREFIX } from '../../src/shared/voice/speech-input.ts';

test('generated sample requires visible fixed-phrase consent and plays only after confirmation', async t => {
  const temp = await mkdtemp(join(tmpdir(), 'sample-e2e-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const audio = await toneMp3(temp);
  let posts = 0; let stt = 0;
  const fake = createServer(async (req, res) => {
    if (req.url === '/v1/default-voices?page_size=30') { res.end(JSON.stringify({ voices: [{ voice_id: 'first', name: 'Primera' }, { voice_id: 'second', name: 'Segunda' }], has_more: false })); return; }
    if (req.url === '/v1/text-to-speech/first') {
      const parts = []; for await (const chunk of req) parts.push(chunk);
      assert.equal(JSON.parse(Buffer.concat(parts).toString()).text, SPANISH_ACCENT_PREFIX + VOICE_SAMPLE_PHRASE);
      posts++; res.writeHead(202).end(JSON.stringify({ id: 'job' })); return;
    }
    if (req.url === '/v1/text-to-speech/second') { req.resume(); posts++; res.writeHead(500).end('secret detail'); return; }
    if (req.url === '/v1/history/job') { res.end(JSON.stringify({ status: 'completed', result: { audio_url: `${base}/audio/job.mp3` } })); return; }
    if (req.url === '/audio/job.mp3') { res.end(audio); return; }
    stt++; res.writeHead(500).end();
  });
  await new Promise<void>(resolve => fake.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(fake.address() as { port: number }).port}`;
  t.after(() => new Promise<void>(resolve => fake.close(() => resolve())));
  await withStudio(t, async ({ page, consoleErrors, resourceErrors }) => {
    page.setDefaultTimeout(15000);
    await page.getByLabel('JSON externo').setInputFiles({ name: 'project.json', mimeType: 'application/json', buffer: Buffer.from(fixtureText('storyboard')) });
    const voice = page.getByRole('region', { name: 'Voz automática', exact: true });
    await voice.getByRole('button', { name: 'Cargar voces Vibi' }).click();
    const select = voice.getByLabel('Voz para generar'); await select.selectOption('first');
    const details = voice.getByRole('region', { name: 'Detalles de la voz' });
    await details.getByRole('button', { name: 'Generar muestra en español' }).click();
    const confirmation = details.getByRole('region', { name: 'Confirmar muestra generada' });
    assert.match(await confirmation.innerText(), new RegExp(`${VOICE_SAMPLE_PHRASE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*${[...(SPANISH_ACCENT_PREFIX + VOICE_SAMPLE_PHRASE)].length} caracteres`));
    assert.match(await confirmation.innerText(), /créditos/); assert.equal(posts, 0);
    if (process.env.PREVIEW_SCREENSHOT_DIR) await details.screenshot({ path: join(process.env.PREVIEW_SCREENSHOT_DIR, 'generated-sample-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 }); await details.scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    if (process.env.PREVIEW_SCREENSHOT_DIR) await details.screenshot({ path: join(process.env.PREVIEW_SCREENSHOT_DIR, 'generated-sample-mobile.png') });
    await confirmation.getByRole('button', { name: 'Cancelar muestra' }).click(); assert.equal(posts, 0);
    await page.route('**/generated-sample/quote', async route => {
      const response = await route.fetch();
      const body = await response.json() as { sampleText: string };
      body.sampleText = body.sampleText.replace('Hola', 'Ojal');
      await route.fulfill({ response, json: body });
    }, { times: 1 });
    await details.getByRole('button', { name: 'Generar muestra en español' }).click();
    await confirmation.getByText(/Ojal, esta es una muestra/).waitFor();
    await confirmation.getByRole('button', { name: 'Cancelar muestra' }).click(); assert.equal(posts, 0);
    await details.getByRole('button', { name: 'Generar muestra en español' }).click();
    await confirmation.getByRole('button', { name: 'Confirmar generación de muestra TTS' }).click();
    await page.waitForFunction(() => { const audio = document.querySelector('.voice-details audio') as HTMLAudioElement; return audio && !audio.paused && audio.currentTime > 0; });
    const player = await details.locator('audio').elementHandle(); assert.ok(player);
    assert.equal(posts, 1); assert.equal(stt, 0);
    await select.selectOption('second');
    assert.equal(await player.evaluate(audio => (audio as HTMLAudioElement).paused && !audio.getAttribute('src')), true);
    await select.selectOption('first');
    await details.getByRole('button', { name: 'Escuchar muestra generada guardada' }).click();
    await page.waitForFunction(() => !(document.querySelector('.voice-details audio') as HTMLAudioElement).paused);
    assert.equal(posts, 1); assert.equal(stt, 0);
    assert.deepEqual(consoleErrors, []); assert.deepEqual(resourceErrors, []);
    await select.selectOption('second');
    await details.getByRole('button', { name: 'Generar muestra en español' }).click();
    await confirmation.getByRole('button', { name: 'Confirmar generación de muestra TTS' }).click();
    await details.getByText(/Una solicitud anterior puede seguir en curso/).waitFor();
    assert.equal(await details.getByRole('button', { name: 'Generar muestra en español' }).isDisabled(), true);
    assert.equal(posts, 2); assert.equal(stt, 0);
    assert.deepEqual(consoleErrors, ['Failed to load resource: the server responded with a status of 409 (Conflict)']);
    assert.deepEqual(resourceErrors, ['/api/vibi/voices/elevenlabs/second/generated-sample']);
  }, 'chromium', undefined, { apiKey: 'fake-key', voiceId: '', baseUrl: base, pollIntervalMs: 1 });
});

test('cache-only authentication and network failures remain retryable and do not imply a paid request', async t => {
  const fake = createServer((req, res) => {
    if (req.url === '/v1/default-voices?page_size=30') { res.end(JSON.stringify({ voices: [{ voice_id: 'voice', name: 'Voz' }], has_more: false })); return; }
    res.writeHead(500).end();
  });
  await new Promise<void>(resolve => fake.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(fake.address() as { port: number }).port}`;
  t.after(() => new Promise<void>(resolve => fake.close(() => resolve())));
  await withStudio(t, async ({ page }) => {
    await page.getByLabel('JSON externo').setInputFiles({ name: 'project.json', mimeType: 'application/json', buffer: Buffer.from(fixtureText('storyboard')) });
    const voice = page.getByRole('region', { name: 'Voz automática', exact: true });
    await voice.getByRole('button', { name: 'Cargar voces Vibi' }).click();
    await voice.getByLabel('Voz para generar').selectOption('voice');
    const details = voice.getByRole('region', { name: 'Detalles de la voz' });
    let network = false;
    await page.route('**/generated-sample', route => network ? route.abort() : route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":{"code":"unauthorized","message":"No autorizado"}}' }));
    const cached = details.getByRole('button', { name: 'Escuchar muestra generada guardada' });
    await cached.click();
    await details.getByText(/No se pudo consultar la muestra guardada/).waitFor();
    assert.equal(await details.getByRole('button', { name: 'Generar muestra en español' }).isEnabled(), true);
    assert.equal(await details.getByText(/solicitud anterior/).count(), 0);
    network = true; await cached.click();
    await details.getByText(/No se pudo consultar la muestra guardada/).waitFor();
    assert.equal(await details.getByRole('button', { name: 'Generar muestra en español' }).isEnabled(), true);
    assert.equal(await details.getByText(/solicitud anterior/).count(), 0);
  }, 'chromium', undefined, { apiKey: 'fake-key', voiceId: '', baseUrl: base });
});
