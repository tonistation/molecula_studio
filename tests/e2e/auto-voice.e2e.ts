import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { withStudio } from '../helpers/studio-browser.ts';
import { fixtureText } from '../helpers/fixtures.ts';
import { toneMp3 } from '../helpers/playable-audio.ts';

test('automatic voice shows cost consent, queries credits only on demand, generates sequentially and preserves prior scenes on failure', async t => {
  const source = JSON.parse(fixtureText('storyboard'));
  let audio: Buffer; let root = ''; let posts = 0; let accounts = 0; let catalogs = 0; let failSecond = true;
  const choices: string[] = [];
  let releaseFirst!: () => void;
  const firstWait = new Promise<void>(resolve => { releaseFirst = resolve; });
  t.after(() => releaseFirst());
  let tokens: string[] = []; const order: string[] = [];
  const fake = createServer(async (req, res) => {
    assert.equal(req.headers['xi-api-key'], 'e2e-fake-only');
    if (req.url === '/v1/default-voices?page_size=30') { catalogs++; res.end(JSON.stringify({ voices: [
      { voice_id: 'narrator-a', name: 'Narradora A' }, { voice_id: 'narrator-b', name: 'Narrador B' }], has_more: false })); return; }
    if (req.url === '/v1/auth/me') { accounts++; res.end(JSON.stringify({ credit_balance: 9876, email: 'PRIVATE', api_key: 'e2e-fake-only' })); return; }
    if (req.method === 'POST') {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      if (req.url?.includes('text-to-speech')) {
        posts++; choices.push(req.url!); order.push(`tts${posts}`);
        if (posts === 2) {
          const saved = JSON.parse(await readFile(join(root, source.projectId, 'project.json'), 'utf8'));
          assert.ok(saved.scenes[0].audio); assert.equal(saved.scenes[1].audio, null, 'first scene committed before second paid submit');
        }
        tokens = JSON.parse(Buffer.concat(chunks).toString()).text.match(/\S+/gu);
        res.writeHead(202).end(JSON.stringify({ id: `tts-${posts}` }));
      } else { order.push(`stt${posts}`); res.writeHead(202).end(JSON.stringify({ task_id: 'stt' })); }
    } else if (req.url?.startsWith('/v1/history/')) {
      if (posts === 1) await firstWait;
      res.end(JSON.stringify(failSecond && posts === 2 ? { status: 'failed', error: 'e2e-fake-only PRIVATE' }
        : { status: 'completed', result: { audio_url: `${base}/audio/test.mp3` } }));
    }
    else if (req.url === '/audio/test.mp3') res.end(audio);
    else res.end(JSON.stringify({ status: 'completed', result: { words: tokens.map((text, i) => ({ text, type: 'word', start: i * 0.1, end: (i + 1) * 0.1 })) } }));
  });
  await new Promise<void>(resolve => fake.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(fake.address() as { port: number }).port}`;
  t.after(() => new Promise<void>(resolve => fake.close(() => resolve())));
  await withStudio(t, async context => {
    const { page, consoleErrors, resourceErrors } = context;
    root = context.root; audio = await toneMp3(root);
    page.setDefaultTimeout(20000);
    await page.getByLabel('JSON externo').setInputFiles({ name: 'project.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(source)) });
    const voice = page.getByRole('region', { name: 'Voz automática', exact: true });
    const all = voice.getByRole('button', { name: 'Generar todas las voces', exact: true });
    await all.waitFor();
    assert.equal(await all.isDisabled(), true, 'missing default voice requires catalog selection, not another secret');
    assert.equal(catalogs, 0);
    await voice.getByRole('button', { name: 'Cargar voces Vibi', exact: true }).click();
    const selector = voice.getByLabel('Voz para generar', { exact: true });
    await selector.selectOption('narrator-a');
    await all.click();
    const confirmation = voice.getByRole('region', { name: 'Confirmar generación Vibi' });
    await confirmation.getByText(/Voz elegida: Narradora A · elevenlabs \/ narrator-a/).waitFor();
    await selector.selectOption('narrator-b');
    assert.equal(await confirmation.count(), 0, 'changing voice invalidates financial consent');
    await selector.selectOption('narrator-a');
    await all.click();
    const count = source.scenes.reduce((sum: number, scene: { text: string }) => sum + [...scene.text].length, 0);
    await confirmation.getByText(new RegExp(`Se enviarán ${count} caracteres de 2 escenas`)).waitFor();
    await confirmation.getByText(/STT por duración del audio generado, todavía desconocida/).waitFor();
    assert.equal(posts, 0); assert.equal(accounts, 0);
    assert.equal(catalogs, 1);
    if (process.env.PREVIEW_SCREENSHOT_DIR) await voice.screenshot({ path: join(process.env.PREVIEW_SCREENSHOT_DIR, 'auto-voice-consent-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await confirmation.scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    if (process.env.PREVIEW_SCREENSHOT_DIR) await voice.screenshot({ path: join(process.env.PREVIEW_SCREENSHOT_DIR, 'auto-voice-consent-mobile.png') });
    await page.setViewportSize({ width: 1280, height: 1400 });
    await confirmation.getByRole('button', { name: 'Cancelar generación', exact: true }).click();
    assert.equal(posts, 0);
    await voice.getByRole('button', { name: 'Consultar créditos Vibi' }).click();
    await voice.getByText(/Créditos disponibles al consultar: 9876/).waitFor(); assert.equal(accounts, 1);
    await all.click();
    await page.getByLabel('Texto').first().fill('Cambio sin guardar');
    assert.equal(await confirmation.count(), 0); assert.equal(await all.isDisabled(), true); assert.equal(posts, 0);
    await page.getByLabel('Texto').first().fill(source.scenes[0].text);
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await page.getByText('Sin cambios pendientes', { exact: false }).waitFor();
    await all.click();
    await confirmation.getByRole('button', { name: 'Confirmar generación y consumo TTS + STT' }).click();
    assert.equal(await selector.isDisabled(), true, 'the captured batch voice cannot change while pending');
    assert.equal(await voice.getByRole('button', { name: 'Cargar voces Vibi', exact: true }).isDisabled(), true);
    releaseFirst();
    await voice.getByText(/Se conservaron 1 escenas ya guardadas/).waitFor();
    assert.deepEqual(order, ['tts1', 'stt1', 'tts2']);
    assert.deepEqual(choices, ['/v1/text-to-speech/narrator-a', '/v1/text-to-speech/narrator-a']);
    const file = join(root, source.projectId, 'project.json');
    const previous = JSON.parse(await readFile(file, 'utf8'));
    assert.ok(previous.scenes[0].audio); assert.equal(previous.scenes[1].audio, null);
    assert.doesNotMatch(JSON.stringify(previous), /e2e-fake-only|PRIVATE/);
    await page.getByRole('button', { name: 'Recargar desde disco', exact: true }).click();
    failSecond = false;
    await selector.selectOption('narrator-b');
    await voice.getByRole('button', { name: 'Generar voz · escena 2', exact: true }).click();
    await confirmation.getByRole('button', { name: 'Confirmar generación y consumo TTS + STT' }).click();
    await voice.getByText(/1 escenas con audio guardado/).waitFor();
    const saved = JSON.parse(await readFile(file, 'utf8'));
    assert.deepEqual(saved.scenes[0], previous.scenes[0]); assert.ok(saved.scenes[1].audio);
    assert.equal(saved.scenes[1].words[0].text, source.scenes[1].text.split(/\s+/)[0]);
    assert.equal(posts, 3); assert.equal(accounts, 1);
    assert.equal(choices[2], '/v1/text-to-speech/narrator-b');
    const savedAsset = saved.assets.find((asset: { assetId: string }) => asset.assetId === saved.scenes[1].audio.assetId);
    assert.equal(savedAsset.source.attribution, 'elevenlabs/narrator-b');
    assert.deepEqual(consoleErrors, ['Failed to load resource: the server responded with a status of 502 (Bad Gateway)']);
    assert.deepEqual(resourceErrors, [`/api/projects/${source.projectId}/scenes/${source.scenes[1].sceneId}/voice`], 'only the deliberately failed TTS request');
  }, 'chromium', undefined, { apiKey: 'e2e-fake-only', voiceId: '', baseUrl: base, pollIntervalMs: 1 });
});

test('leaving the editor aborts an explicit pending voice catalog without late updates or generation', async t => {
  let notify!: () => void; let closed!: () => void; let calls = 0;
  const requested = new Promise<void>(resolve => { notify = resolve; });
  const disconnected = new Promise<void>(resolve => { closed = resolve; });
  const fake = createServer((req, res) => {
    calls++;
    assert.equal(req.method, 'GET');
    assert.equal(req.url, '/v1/default-voices?page_size=30');
    res.once('close', closed); notify();
  });
  await new Promise<void>(resolve => fake.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => fake.close(() => resolve())));
  await withStudio(t, async ({ page, consoleErrors, resourceErrors }) => {
    page.setDefaultTimeout(15000);
    await page.getByLabel('JSON externo').setInputFiles({ name: 'project.json', mimeType: 'application/json', buffer: Buffer.from(fixtureText('storyboard')) });
    const voice = page.getByRole('region', { name: 'Voz automática', exact: true });
    await voice.getByRole('button', { name: 'Cargar voces Vibi', exact: true }).click();
    await requested;
    await voice.getByText('Cargando voces…', { exact: true }).waitFor();
    assert.equal(await voice.getByLabel('Voz para generar').isDisabled(), true);
    assert.equal(await voice.getByRole('button', { name: 'Generar todas las voces', exact: true }).isDisabled(), true);
    await page.getByRole('button', { name: 'Proyectos', exact: true }).click();
    await disconnected;
    assert.equal(await voice.count(), 0);
    assert.equal(calls, 1);
    assert.deepEqual(consoleErrors, []); assert.deepEqual(resourceErrors, []);
  }, 'chromium', undefined, { apiKey: 'fake-catalog', voiceId: 'voice', baseUrl: `http://127.0.0.1:${(fake.address() as { port: number }).port}` });
});

test('cancelling automatic voice aborts local waiting without late UI success or disk publication', async t => {
  const source = JSON.parse(fixtureText('storyboard'));
  let posts = 0; let notify!: () => void; let closed!: () => void;
  const polling = new Promise<void>(r => { notify = r; });
  const disconnected = new Promise<void>(r => { closed = r; });
  const fake = createServer((req, res) => {
    req.resume();
    if (req.method === 'POST') { posts++; res.writeHead(202).end(JSON.stringify({ id: 'pending' })); }
    else { res.once('close', closed); notify(); }
  });
  await new Promise<void>(r => fake.listen(0, '127.0.0.1', r));
  t.after(() => new Promise<void>(r => fake.close(() => r())));
  await withStudio(t, async ({ page, root }) => {
    page.setDefaultTimeout(15000);
    await page.getByLabel('JSON externo').setInputFiles({ name: 'project.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(source)) });
    const voice = page.getByRole('region', { name: 'Voz automática', exact: true });
    await voice.getByRole('button', { name: 'Generar todas las voces', exact: true }).click();
    const file = join(root, source.projectId, 'project.json');
    const before = await readFile(file);
    await voice.getByRole('button', { name: 'Confirmar generación y consumo TTS + STT' }).click();
    await polling;
    await page.getByRole('button', { name: 'Cancelar espera de voz' }).click();
    await voice.getByText(/Espera cancelada. Las tareas ya enviadas pueden continuar/).waitFor();
    await disconnected;
    await page.getByRole('button', { name: 'Recargar desde disco', exact: true }).click();
    assert.deepEqual(await readFile(file), before); assert.equal(posts, 1);
    assert.equal(await voice.getByText(/escenas con audio guardado/).count(), 0);
  }, 'chromium', undefined, { apiKey: 'fake-cancel', voiceId: 'voice', baseUrl: `http://127.0.0.1:${(fake.address() as { port: number }).port}`, pollIntervalMs: 1 });
});
