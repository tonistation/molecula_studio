import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { copyFile, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { withStudio } from '../helpers/studio-browser.ts';
import { fakeCodex } from '../helpers/fake-codex.ts';
import { toneWav } from '../helpers/playable-audio.ts';

const exec = promisify(execFile);
const remotion = resolve('node_modules/.bin/remotion');

for (const [label, style, kind, mode] of [
  ['2D vectorial', 'vector-2d', 'vector', 'manual'],
  ['Motion', 'motion-graphics', 'motion', 'auto'],
] as const) {
  test(`${label}: fresh project through drawing, audio, preview, download and reopen`, { timeout: 240_000 }, async t => {
    const fake = await fakeCodex('fixture');
    const fixture = join(fake.root, 'visual.json');
    const common = { position: [540, 700], rotation: 0, scale: 1, opacity: 1, startMs: 0, endMs: 1000, fill: '#FFFFFF', animations: [] };
    const visual = { kind, version: 1, background: '#123456', layers: [
      { ...common, id: 'shape', type: 'rect', position: [540, 1100], fill: '#FFCC00', width: 400, height: 350 },
      kind === 'motion'
        ? { ...common, id: 'counter', type: 'counter', from: 0, to: 100, fontId: 'builtin-sans-heavy-v1', fontSize: 150,
          animations: [{ type: 'scale', startMs: 0, endMs: 900, easing: 'ease-out', from: 0.5, to: 1.5 }] }
        : { ...common, id: 'title', type: 'text', text: 'VECTOR', fontId: 'builtin-sans-heavy-v1', fontSize: 150 },
    ] };
    await writeFile(fixture, JSON.stringify(visual));
    try {
      await withStudio(t, async ({ page, root, consoleErrors, resourceErrors }) => {
        root = await realpath(root);
        page.setDefaultTimeout(15000);
        await page.setViewportSize({ width: 1280, height: 1000 });
        assert.deepEqual((await readdir(root)).filter(name => !name.startsWith('.')), []);
        await page.getByLabel('Nombre', { exact: true }).fill(`Prueba ${label}`);
        await page.getByRole('button', { name: 'Nuevo proyecto', exact: true }).click();
        await page.getByLabel('Idea', { exact: true }).fill('Una figura y su movimiento');
        const [id] = (await readdir(root)).filter(name => !name.startsWith('.'));
        assert.ok(id);
        const input = join(root, id, 'project.json');
        await page.getByRole('radio', { name: new RegExp(label) }).check();
        const script = page.getByRole('region', { name: 'Guion manual', exact: true });
        const proposal = { title: `Historia ${label}`, sources: [], cover: { headline: 'Una figura' }, postText: 'Una figura.',
          scenes: [{ title: 'Figura', narration: 'Una figura brillante.', visualIntent: 'Figura amarilla', seconds: 1 }] };
        await script.getByLabel('Pegar respuesta', { exact: true }).fill(JSON.stringify(proposal));
        await script.getByRole('button', { name: 'Revisar', exact: true }).click();
        await script.getByRole('button', { name: 'Aplicar al borrador', exact: true }).click();
        await script.getByText(/Aplicado al borrador/).waitFor();
        const card = page.locator('.scene-card').first();
        await card.locator('summary').click();
        if (mode === 'auto') {
          await page.waitForFunction(() => !document.querySelector<HTMLOptionElement>('select option[value="auto"]')?.disabled);
          await card.getByLabel('Modo de dibujo').selectOption('auto');
          await card.getByRole('button', { name: 'Generar con Codex' }).click();
        } else {
          await card.getByLabel('Pegar escena').fill(JSON.stringify(visual));
          await card.getByRole('button', { name: 'Revisar', exact: true }).click();
        }
        await card.getByRole('region', { name: 'Revisión del dibujo' }).waitFor();
        await card.getByRole('button', { name: 'Aplicar al borrador' }).click();
        await card.getByText(/Aplicado al borrador/).waitFor();
        await page.getByRole('button', { name: 'Guardar', exact: true }).click();
        await page.getByText(/Guardado · rev\./).waitFor();
        const voice = page.getByRole('region', { name: 'Voz manual', exact: true });
        await voice.getByLabel('Licencia o permiso de uso del audio').fill('Señal sintética propia de prueba');
        await voice.getByLabel('Subir audio · escena 1').setInputFiles({ name: 'tone.wav', mimeType: 'audio/wav', buffer: toneWav(1000) });
        await voice.getByText(/1\..*lista/).waitFor();
        const savedBytes = await readFile(input);
        const saved = JSON.parse(savedBytes.toString());
        assert.equal(saved.schemaVersion, 3); assert.equal(saved.styleId, style);
        assert.equal(saved.scenes[0].visual.kind, kind);
        assert.equal(saved.scenes[0].visual.layers.length, 2);
        assert.ok(saved.scenes[0].audio && saved.scenes[0].words.length);
        if (mode === 'auto') {
          const records = (await readFile(fake.env.FAKE_CODEX_RECORD, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
          assert.equal(records.length, 1);
          assert.deepEqual(records[0].schema.properties.kind.enum, [kind]);
          assert.equal(records[0].inheritedProviderSecret, false);
        }
        const preview = page.getByRole('region', { name: 'Vista previa del borrador' });
        await preview.locator('svg g[fill="#FFCC00"] rect').waitFor();
        await preview.locator('[data-caption-word="Una"]').waitFor();
        await preview.locator(kind === 'motion' ? 'svg text' : '[data-vector-text]').waitFor();
        await preview.getByRole('button', { name: 'Play video', exact: true }).click();
        await page.waitForFunction(() => [...document.querySelectorAll('audio')].some(a => a.src.startsWith('blob:') && !a.paused && a.currentTime > 0.2));
        await preview.getByRole('button', { name: 'Pause video', exact: true }).click();
        const bar = preview.locator('div[style*="touch-action: none"]');
        const bounds = await bar.boundingBox(); assert.ok(bounds);
        await bar.click({ position: { x: bounds.width * 0.6, y: bounds.height / 2 } });
        if (kind === 'motion') {
          await page.waitForFunction(() => [...document.querySelectorAll('svg text')].some(node => Number(node.textContent) > 0));
        } else assert.equal(await preview.locator('[data-vector-text]').textContent(), 'VECTOR');
        if (process.env.FULL_WORKFLOW_SCREENSHOT_DIR) await preview.screenshot({ path: join(process.env.FULL_WORKFLOW_SCREENSHOT_DIR, `${style}-preview.png`) });
        const panel = page.getByRole('region', { name: 'Exportar video', exact: true });
        const start = page.waitForResponse(response => response.url().endsWith(`/api/projects/${id}/renders`) && response.request().method() === 'POST');
        await panel.getByRole('button', { name: 'Exportar MP4', exact: true }).click();
        assert.equal((await start).status(), 202);
        await panel.getByText('Exportación completada', { exact: true }).waitFor({ timeout: 180_000 });
        const output = await realpath(await panel.locator('.export-path').innerText());
        assert.equal(dirname(output), join(root, '.renders', id));
        const event = page.waitForEvent('download');
        await panel.getByRole('button', { name: 'Descargar', exact: true }).click();
        const download = await event; assert.equal(await download.failure(), null);
        const downloaded = (await download.path())!;
        assert.deepEqual(await readFile(downloaded), await readFile(output));
        const metadata = JSON.parse((await exec(remotion, ['ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', downloaded])).stdout);
        const video = metadata.streams.find((stream: any) => stream.codec_type === 'video');
        const audio = metadata.streams.find((stream: any) => stream.codec_type === 'audio');
        assert.equal(video.codec_name, 'h264'); assert.equal(video.width, 1080); assert.equal(video.height, 1920);
        assert.equal(video.avg_frame_rate, '30/1'); assert.equal(Number(video.nb_frames), 39);
        assert.ok(Math.abs(Number(metadata.format.duration) - 1.3) <= 1 / 30); assert.equal(audio.codec_name, 'aac');
        const wav = (await exec(remotion, ['ffmpeg', '-v', 'error', '-i', downloaded, '-vn', '-ac', '1', '-ar', '16000', '-codec:a', 'pcm_s16le', '-f', 'wav', 'pipe:1'], { encoding: 'buffer', maxBuffer: 1024 * 1024 })).stdout;
        let offset = 12;
        while (wav.toString('ascii', offset, offset + 4) !== 'data') { assert.ok(offset + 8 < wav.length); const size = wav.readUInt32LE(offset + 4); offset += 8 + size + size % 2; }
        const pcm = wav.subarray(offset + 8);
        let squares = 0; for (let sample = 3200; sample < 6400; sample++) squares += pcm.readInt16LE(sample * 2) ** 2;
        assert.ok(Math.sqrt(squares / 3200) > 2000, 'downloaded AAC contains audible signal');
        const frame = join(fake.root, 'frame.png');
        await exec(remotion, ['ffmpeg', '-y', '-v', 'error', '-ss', '0.6', '-i', downloaded, '-frames:v', '1', frame]);
        const png = (await readFile(frame)).toString('base64');
        const { yellow, light } = await page.evaluate(async data => {
          const image = new Image(); image.src = `data:image/png;base64,${data}`; await image.decode();
          const canvas = document.createElement('canvas'); canvas.width = 108; canvas.height = 192;
          const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0, 108, 192);
          const pixels = context.getImageData(0, 0, 108, 192).data;
          let yellow = 0; let light = 0;
          for (let i = 0; i < pixels.length; i += 4) { if (pixels[i]! > 180 && pixels[i + 1]! > 120 && pixels[i + 2]! < 100) yellow++; if (pixels[i]! > 200 && pixels[i + 1]! > 200 && pixels[i + 2]! > 200) light++; }
          return { yellow, light };
        }, png);
        assert.ok(yellow > 200 && light > 10, `decoded frame contains visible shape and text: ${yellow}, ${light}`);
        if (process.env.FULL_WORKFLOW_SCREENSHOT_DIR) {
          await copyFile(downloaded, join(process.env.FULL_WORKFLOW_SCREENSHOT_DIR, `${style}.mp4`));
          await exec(remotion, ['ffmpeg', '-y', '-v', 'error', '-ss', '0.6', '-i', downloaded, '-frames:v', '1', join(process.env.FULL_WORKFLOW_SCREENSHOT_DIR, `${style}-frame.png`)]);
        }
        assert.deepEqual(await readFile(input), savedBytes);
        await page.getByRole('button', { name: 'Proyectos', exact: true }).click();
        await page.getByRole('button', { name: 'Abrir', exact: true }).click();
        assert.equal(await page.getByRole('radio', { name: new RegExp(label) }).isChecked(), true);
        await voice.getByText(/1\..*lista/).waitFor();
        await preview.locator('svg g[fill="#FFCC00"] rect').waitFor();
        assert.deepEqual(await readFile(input), savedBytes);
        await page.getByRole('button', { name: 'Copia portable', exact: true }).click();
        await page.getByText(/Copia portable creada/).waitFor();
        const copiedId = (await readdir(root)).find(name => !name.startsWith('.') && name !== id);
        assert.ok(copiedId);
        const copied = JSON.parse(await readFile(join(root, copiedId, 'project.json'), 'utf8'));
        assert.equal(copied.schemaVersion, saved.schemaVersion); assert.equal(copied.styleId, style);
        assert.deepEqual(copied.scenes[0].visual, saved.scenes[0].visual);
        assert.deepEqual(copied.scenes[0].audio, saved.scenes[0].audio);
        assert.deepEqual(await readFile(input), savedBytes);
        assert.deepEqual(consoleErrors, []); assert.deepEqual(resourceErrors, []);
      }, 'chromium', { env: { PATH: fake.root, FAKE_CODEX_MODE: 'fixture', FAKE_CODEX_FIXTURE: fixture, FAKE_CODEX_RECORD: fake.env.FAKE_CODEX_RECORD } });
    } finally { await fake.cleanup(); }
  });
}
