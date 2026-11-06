import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile, copyFile, realpath, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { parseProjectText, serializeProject } from '../../src/shared/schema/index.ts';
import { fixtureText } from '../helpers/fixtures.ts';
import { withStudio } from '../helpers/studio-browser.ts';
import { voicedFixture, assertRenderedAudio } from '../helpers/render-audio.ts';

const exec = promisify(execFile);

test('export: real UI MP4 matches CLI, downloads and survives closing its Chromium tab', { timeout: 420_000 }, async t => {
  await withStudio(t, async ({ page, root, consoleErrors, resourceErrors }) => {
    root = await realpath(root);
    page.setDefaultTimeout(240_000);
    const parsed = parseProjectText(fixtureText('storyboard'));
    assert.ok(parsed.ok);
    const project = parsed.project;
    const kit = JSON.parse(await readFile('docs/plan/examples/kit/sal-del-mar.json', 'utf8'));
    for (const object of kit.objects) for (const animation of object.animations) animation.endMs = 1500;
    project.output.durationMs = 2000;
    project.output.voiceMode = 'silent';
    project.assets = [];
    const storedWords = project.scenes[0]!.words.map((word, index) => ({ ...word, startMs: index * 300, endMs: index * 300 + 250 }));
    project.scenes = [{ ...project.scenes[0]!, startMs: 0, durationMs: 2000,
      visual: kit, words: storedWords, audio: null, mediaBindings: { audio: null, words: null } }];
    await page.getByLabel('JSON externo').setInputFiles({ name: 'project.json', mimeType: 'application/json', buffer: Buffer.from(serializeProject(project)) });
    const panel = page.getByRole('region', { name: 'Exportar video', exact: true });
    await panel.getByRole('button', { name: 'Exportar MP4' }).waitFor();
    await page.getByLabel('Nombre del proyecto').fill('Exportación comprobada');
    await page.getByLabel('Texto').first().fill('Texto nuevo que debe exportarse');
    assert.equal(await panel.getByRole('button', { name: 'Guarda antes de exportar' }).isDisabled(), true);
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await page.getByRole('button', { name: 'Proyectos', exact: true }).click();
    await page.getByRole('button', { name: 'Abrir', exact: true }).click();
    const preview = page.getByRole('region', { name: 'Vista previa del borrador' });
    await preview.locator('[data-caption-word="Texto"]').waitFor();
    assert.equal(await preview.locator('[data-caption-word="Cada"]').count(), 0);
    const exportButton = panel.getByRole('button', { name: 'Exportar MP4', exact: true });
    await exportButton.waitFor();
    const input = join(root, project.projectId, 'project.json');
    const savedBytes = await readFile(input);
    const saved = JSON.parse(savedBytes.toString());
    assert.deepEqual(saved.scenes[0].words, storedWords, 'editing keeps persisted alignment');
    await exportButton.click();
    await panel.getByRole('progressbar').waitFor();
    await exportButton.click();
    await panel.getByText('Ya hay una exportación en curso', { exact: true }).waitFor();
    await panel.getByText('Exportación completada', { exact: true }).waitFor();
    const output = await panel.locator('.export-path').innerText();
    const downloadEvent = page.waitForEvent('download');
    await panel.getByRole('button', { name: 'Descargar', exact: true }).click();
    const download = await downloadEvent;
    assert.equal(await download.failure(), null);
    assert.deepEqual(await readFile((await download.path())!), await readFile(output));
    assert.deepEqual(await readFile(input), savedBytes, 'export never saves or changes approval');

    const cli = join(root, 'cli.mp4');
    await exec(process.execPath, ['scripts/render-project.ts', input, cli], { timeout: 220_000 });
    // An independent fresh-caption reference proves parity is not shared stale text.
    saved.scenes[0].words = [];
    const referenceInput = join(root, 'fresh-captions.json');
    const reference = join(root, 'fresh-captions.mp4');
    await writeFile(referenceInput, serializeProject(saved));
    await exec(process.execPath, ['scripts/render-project.ts', referenceInput, reference], { timeout: 220_000 });
    const metadata = async (path: string) => {
      const { stdout } = await exec(resolve('node_modules/.bin/remotion'), ['ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', path]);
      const data = JSON.parse(stdout);
      const stream = data.streams.find((entry: any) => entry.codec_type === 'video');
      return { codec: stream.codec_name, width: stream.width, height: stream.height,
        fps: stream.avg_frame_rate, frames: Number(stream.nb_frames), duration: Number(data.format.duration),
        audio: data.streams.some((entry: any) => entry.codec_type === 'audio') };
    };
    const actual = await metadata(output);
    assert.deepEqual(actual, await metadata(cli));
    assert.deepEqual(actual, { codec: 'h264', width: 1080, height: 1920, fps: '30/1', frames: 60, duration: 2, audio: false });
    // Same decoded frame, not only matching container metadata. No persisted golden.
    for (const [name, path] of [['ui', output], ['cli', cli], ['fresh', reference]]) {
      await exec(resolve('node_modules/.bin/remotion'), ['ffmpeg', '-ss', '1', '-i', path!, '-frames:v', '1', join(root, `${name}.png`)]);
    }
    assert.deepEqual(await readFile(join(root, 'ui.png')), await readFile(join(root, 'cli.png')));
    assert.deepEqual(await readFile(join(root, 'ui.png')), await readFile(join(root, 'fresh.png')));
    if (process.env.EXPORT_SCREENSHOT_DIR) {
      await panel.screenshot({ path: join(process.env.EXPORT_SCREENSHOT_DIR, 'export-completed.png') });
      await copyFile(join(root, 'ui.png'), join(process.env.EXPORT_SCREENSHOT_DIR, 'export-frame.png'));
    }

    const origin = new URL(page.url()).origin;
    const token = await page.locator('meta[name="companion-token"]').getAttribute('content');
    const responseEvent = page.waitForResponse(response => response.url().endsWith('/renders') && response.request().method() === 'POST');
    await exportButton.click();
    const started = await responseEvent;
    assert.equal(started.status(), 202);
    const { renderId } = await started.json();
    await page.close();
    let done: any;
    for (let attempt = 0; attempt < 240; attempt++) {
      const response = await fetch(`${origin}/api/projects/${project.projectId}/renders/${renderId}`, { headers: { authorization: `Bearer ${token}` } });
      done = await response.json();
      if (done.status !== 'rendering') break;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    assert.equal(done.status, 'completed', 'server completes after browser tab disconnect');
    assert.deepEqual(await metadata(done.outputPath), actual);
    assert.deepEqual(consoleErrors, []);
    assert.deepEqual(resourceErrors, []);
  }, 'chromium');
});

test('voiced UI export downloads synchronized AAC and matches the CLI decoded audio and frames', { timeout: 300_000 }, async t => {
  await withStudio(t, async ({ page, root, store, consoleErrors, resourceErrors }) => {
    root = await realpath(root);
    page.setDefaultTimeout(120_000);
    const parsed = parseProjectText(fixtureText('storyboard'));
    assert.ok(parsed.ok);
    const project = parsed.project;
    const audio = voicedFixture(project);
    const kit = JSON.parse(await readFile('docs/plan/examples/kit/sal-del-mar.json', 'utf8'));
    for (const object of kit.objects) for (const animation of object.animations) animation.endMs = 900;
    for (const scene of project.scenes) scene.visual = structuredClone(kit);
    const imported = await store.importProject({ text: serializeProject(project) });
    await store.relinkAsset({ projectId: imported.projectId, assetId: 'voice', bytes: audio, mimeType: 'audio/wav' });
    await page.reload();
    await page.getByRole('button', { name: 'Abrir', exact: true }).click();
    const preview = page.getByRole('region', { name: 'Vista previa del borrador' });
    await preview.locator('[data-caption-word="Primera"]').waitFor();
    const input = join(root, imported.projectId, 'project.json');
    const original = await readFile(input);
    const panel = page.getByRole('region', { name: 'Exportar video', exact: true });
    await panel.getByRole('button', { name: 'Exportar MP4', exact: true }).click();
    await panel.getByText('Exportación completada', { exact: true }).waitFor();
    const output = await panel.locator('.export-path').innerText();
    await assertRenderedAudio(output);
    const downloadEvent = page.waitForEvent('download');
    await panel.getByRole('button', { name: 'Descargar', exact: true }).click();
    const download = await downloadEvent;
    assert.equal(await download.failure(), null);
    assert.deepEqual(await readFile((await download.path())!), await readFile(output));
    const cli = join(root, 'voiced-cli.mp4');
    await exec(process.execPath, ['scripts/render-project.ts', input, cli], { timeout: 220_000 });
    await assertRenderedAudio(cli);
    for (const [name, path] of [['ui', output], ['cli', cli]]) {
      await exec(resolve('node_modules/.bin/remotion'), ['ffmpeg', '-ss', '0.3', '-i', path!, '-frames:v', '1', join(root, `voiced-${name}.png`)]);
      await exec(resolve('node_modules/.bin/remotion'), ['ffmpeg', '-i', path!, '-vn', '-codec:a', 'pcm_s16le', join(root, `voiced-${name}.wav`)]);
    }
    assert.deepEqual(await readFile(join(root, 'voiced-ui.png')), await readFile(join(root, 'voiced-cli.png')));
    assert.deepEqual(await readFile(join(root, 'voiced-ui.wav')), await readFile(join(root, 'voiced-cli.wav')));
    if (process.env.EXPORT_SCREENSHOT_DIR) {
      await panel.screenshot({ path: join(process.env.EXPORT_SCREENSHOT_DIR, 'voiced-export-completed.png') });
      await copyFile(join(root, 'voiced-ui.png'), join(process.env.EXPORT_SCREENSHOT_DIR, 'voiced-export-frame.png'));
    }
    assert.deepEqual(await readFile(input), original);
    assert.deepEqual(consoleErrors, []);
    assert.deepEqual(resourceErrors, []);
  }, 'chromium');
});
