import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile, readdir, realpath, copyFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { promisify } from 'node:util';
import { withStudio } from '../helpers/studio-browser.ts';
import { toneWav } from '../helpers/playable-audio.ts';
import { bindingDigests } from '../../src/shared/digests.ts';

const exec = promisify(execFile);

test('full workflow: fresh project → manual script/drawings → uploaded audio → real downloadable MP4', { timeout: 240_000 }, async t => {
  await withStudio(t, async ({ page, root, consoleErrors, resourceErrors }) => {
    root = await realpath(root);
    page.setDefaultTimeout(15000);
    await page.setViewportSize({ width: 1280, height: 1000 });
    assert.deepEqual((await readdir(root)).filter(name => !name.startsWith('.')), [], 'fresh workspace has no projects');
    await page.getByLabel('Nombre', { exact: true }).fill('Camino feliz');
    await page.getByRole('button', { name: 'Nuevo proyecto', exact: true }).click();
    await page.getByLabel('Idea', { exact: true }).waitFor();
    const [projectId] = (await readdir(root)).filter(name => !name.startsWith('.'));
    assert.ok(projectId);
    const input = join(root, projectId, 'project.json');
    const created = await readFile(input);
    assert.equal(JSON.parse(created.toString()).scenes.length, 0);
    await page.getByLabel('Idea', { exact: true }).fill('El viaje del agua al mar');
    const proposal = {
      title: 'El viaje del agua', sources: [], cover: { headline: 'Del río al mar' }, postText: 'Sigue el agua.',
      scenes: [
        { title: 'Río', narration: 'Agua del río.', visualIntent: 'Una roca junto al río', seconds: 1 },
        { title: 'Mar', narration: 'Llega al mar.', visualIntent: 'La misma roca sigue el agua', seconds: 1 },
      ],
    };
    const script = page.getByRole('region', { name: 'Guion manual', exact: true });
    await script.getByLabel('Pegar respuesta', { exact: true }).fill(JSON.stringify(proposal));
    await script.getByRole('button', { name: 'Revisar', exact: true }).click();
    await script.getByRole('button', { name: 'Aplicar al borrador', exact: true }).click();
    await script.getByText(/Aplicado al borrador/).waitFor();
    const kit = JSON.parse(await readFile('docs/plan/examples/kit/sal-del-mar.json', 'utf8'));
    for (const object of kit.objects) for (const animation of object.animations) animation.endMs = 900;
    const cards = page.locator('.scene-card');
    assert.equal(await cards.count(), 2);
    for (const index of [0, 1]) {
      const card = cards.nth(index);
      await card.locator('summary').click();
      await card.getByLabel('Pegar escena', { exact: true }).fill(JSON.stringify(kit));
      await card.getByRole('button', { name: 'Revisar', exact: true }).click();
      await card.getByRole('button', { name: 'Aplicar al borrador', exact: true }).click();
      await card.getByText(/Aplicado al borrador/).waitFor();
    }
    const preview = page.getByRole('region', { name: 'Vista previa del borrador' });
    await preview.locator('canvas').waitFor();
    await preview.locator('[data-caption-word="Agua"]').waitFor();
    const voice = page.getByRole('region', { name: 'Voz manual', exact: true });
    await voice.getByLabel('Licencia o permiso de uso del audio').fill('Señales sintéticas propias de prueba');
    assert.ok(await voice.getByLabel('Subir audio · escena 1').isDisabled(), 'upload requires a saved draft');
    assert.ok(await page.getByRole('button', { name: 'Guarda antes de exportar' }).isDisabled());
    assert.deepEqual(await readFile(input), created, 'script and drawings do not save implicitly');
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await page.getByText(/Guardado · rev\./).waitFor();
    for (const index of [1, 2]) {
      await voice.getByLabel(`Subir audio · escena ${index}`).setInputFiles({
        name: `own-tone-${index}.wav`, mimeType: 'audio/wav', buffer: toneWav(1000, index * 440),
      });
      await voice.getByText(new RegExp(`${index}\\..*lista`)).waitFor();
    }
    await page.getByRole('button', { name: 'Proyectos', exact: true }).click();
    await page.getByRole('button', { name: 'Abrir', exact: true }).click();
    await voice.getByText(/2\..*lista/).waitFor();
    const savedBytes = await readFile(input);
    const saved = JSON.parse(savedBytes.toString());
    assert.equal(saved.title, proposal.title);
    assert.equal(saved.output.voiceMode, 'withVoice');
    assert.equal(saved.output.durationMs, 2600, 'two one-second uploads include the existing 300ms scene tails');
    const retimedKit = structuredClone(kit);
    for (const object of retimedKit.objects) for (const animation of object.animations) animation.endMs = 1170;
    assert.deepEqual(saved.scenes.map((scene: any) => scene.visual), [retimedKit, retimedKit], 'audio ingestion proportionally retimes the saved drawings');
    const bindings = await bindingDigests(saved);
    for (const [index, scene] of saved.scenes.entries()) {
      assert.equal(scene.text, proposal.scenes[index]!.narration);
      assert.ok(scene.words.length > 0);
      assert.equal(scene.mediaBindings.audio.inputDigest, bindings.scenes[index]!.audioInputDigest);
      assert.equal(scene.mediaBindings.words.inputDigest, bindings.scenes[index]!.wordsInputDigest);
    }
    const steps = page.getByRole('navigation', { name: 'Flujo de creación' }).getByRole('button');
    for (const index of [0, 1, 2, 3]) await steps.nth(index).getByText('Listo', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Ver escena 2', exact: true }).click();
    await preview.locator('[data-caption-word="Llega"]').waitFor();
    if (process.env.FULL_WORKFLOW_SCREENSHOT_DIR) {
      // Allow the asynchronous WebGL draw to settle before optional visual inspection.
      await page.waitForTimeout(800);
      await preview.screenshot({ path: join(process.env.FULL_WORKFLOW_SCREENSHOT_DIR, 'full-workflow-preview.png') });
    }

    const panel = page.getByRole('region', { name: 'Exportar video', exact: true });
    const responseEvent = page.waitForResponse(response => response.url().endsWith(`/api/projects/${projectId}/renders`) && response.request().method() === 'POST');
    await panel.getByRole('button', { name: 'Exportar MP4', exact: true }).click();
    const started = await responseEvent;
    assert.equal(started.status(), 202);
    const { renderId } = await started.json();
    await panel.getByText('Exportación completada', { exact: true }).waitFor({ timeout: 180_000 });
    const output = await realpath(await panel.locator('.export-path').innerText());
    assert.equal(dirname(output), join(root, '.renders', projectId), 'output stays scoped to this project/workspace');
    const downloadResponse = page.waitForResponse(response => new URL(response.url()).pathname === `/api/projects/${projectId}/renders/${renderId}/file`);
    const downloadEvent = page.waitForEvent('download');
    await panel.getByRole('button', { name: 'Descargar', exact: true }).click();
    assert.equal((await downloadResponse).status(), 200, 'download uses the project-scoped render endpoint');
    const download = await downloadEvent;
    assert.equal(await download.failure(), null);
    assert.match(download.suggestedFilename(), /\.mp4$/);
    const downloaded = (await download.path())!;
    assert.deepEqual(await readFile(downloaded), await readFile(output));
    const { stdout } = await exec(resolve('node_modules/.bin/remotion'), ['ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', downloaded]);
    const metadata = JSON.parse(stdout);
    const video = metadata.streams.find((stream: any) => stream.codec_type === 'video');
    const audio = metadata.streams.find((stream: any) => stream.codec_type === 'audio');
    assert.equal(video?.codec_name, 'h264');
    assert.equal(video.width, 1080); assert.equal(video.height, 1920);
    assert.equal(video.avg_frame_rate, '30/1');
    assert.ok(Math.abs(Number(video.nb_frames) - 78) <= 1);
    assert.ok(Math.abs(Number(metadata.format.duration) - 2.6) <= 1 / 30);
    assert.equal(audio?.codec_name, 'aac');
    assert.ok(Math.abs(Number(audio.duration) - 2.6) <= 1 / 30, 'AAC covers the complete timeline');
    // Decode the downloaded AAC, not only its metadata: both uploaded scenes must have signal.
    const decoded = await exec(resolve('node_modules/.bin/remotion'), ['ffmpeg', '-v', 'error', '-i', downloaded,
      '-vn', '-ac', '1', '-ar', '16000', '-codec:a', 'pcm_s16le', '-f', 'wav', 'pipe:1'], { encoding: 'buffer', maxBuffer: 1024 * 1024 });
    let position = 12;
    while (decoded.stdout.toString('ascii', position, position + 4) !== 'data') {
      assert.ok(position + 8 < decoded.stdout.length, 'decoded WAV has a data chunk');
      const size = decoded.stdout.readUInt32LE(position + 4);
      position += 8 + size + size % 2;
    }
    const pcm = decoded.stdout.subarray(position + 8);
    assert.ok(pcm.length / 32000 >= 2.6 - 1 / 30, 'decoded audio covers the timeline');
    for (const startSeconds of [0.2, 1.5]) {
      let squares = 0;
      const firstSample = Math.round(startSeconds * 16000);
      for (let sample = firstSample; sample < firstSample + 3200; sample++) squares += pcm.readInt16LE(sample * 2) ** 2;
      assert.ok(Math.sqrt(squares / 3200) > 2000, `audible PCM in scene at ${startSeconds}s`);
    }
    assert.deepEqual(await readFile(input), savedBytes, 'export and download never alter the saved project');
    if (process.env.FULL_WORKFLOW_SCREENSHOT_DIR) {
      await panel.screenshot({ path: join(process.env.FULL_WORKFLOW_SCREENSHOT_DIR, 'full-workflow-export.png') });
      await exec(resolve('node_modules/.bin/remotion'), ['ffmpeg', '-y', '-v', 'error', '-ss', '1.5', '-i', downloaded, '-frames:v', '1', join(process.env.FULL_WORKFLOW_SCREENSHOT_DIR, 'full-workflow-frame.png')]);
      await copyFile(downloaded, join(process.env.FULL_WORKFLOW_SCREENSHOT_DIR, 'full-workflow.mp4'));
    }
    assert.deepEqual(consoleErrors, []);
    assert.deepEqual(resourceErrors, []);
  }, 'chromium');
});
