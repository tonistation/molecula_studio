import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { withStudio } from '../helpers/studio-browser.ts';
import { fixtureJson } from '../helpers/fixtures.ts';
import { fakeCodex } from '../helpers/fake-codex.ts';
import { validateProject } from '../../src/shared/schema/validate.ts';
import type { KitScene } from '../../src/shared/kit/types.ts';
import { createHash } from 'node:crypto';
import { canonicalize } from '../../src/shared/canonical.ts';

test('automatic novel model survives cross-project reuse, catalog removal and real export', { timeout: 420_000 }, async t => {
  const fake = await fakeCodex('model-orchid');
  const exec = promisify(execFile);
  try {
    await withStudio(t, async ({ page, root, store }) => {
      root = await realpath(root);
      page.setDefaultTimeout(20000);
      await page.addInitScript(() => {
        const original = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, options?: any): any {
          return original.call(this, type as '2d', type === 'webgl2' || type === 'webgl' ? { ...options, preserveDrawingBuffer: true } : options);
        } as typeof HTMLCanvasElement.prototype.getContext;
      });
      await page.reload();
      const paths: string[] = [];
      for (const name of ['Orquídea A', 'Orquídea B']) {
        const before = new Set((await store.listProjects()).map(p => p.projectId));
        await page.getByLabel('Nombre', { exact: true }).fill(name);
        await page.getByRole('button', { name: 'Nuevo proyecto', exact: true }).click();
        await page.getByLabel('Idea', { exact: true }).fill('Una orquídea rosa');
        await page.waitForFunction(() => !document.querySelector<HTMLOptionElement>('select option[value="auto"]')?.disabled);
        await page.getByLabel('Modo de guion').selectOption('auto');
        const script = page.getByRole('region', { name: 'Guion automático' });
        await script.getByRole('button', { name: 'Generar con Codex' }).click();
        await script.getByRole('region', { name: 'Revisión del guion' }).waitFor();
        await script.getByRole('button', { name: 'Aplicar al borrador' }).click();
        const card = page.locator('.scene-card').first();
        await card.locator('summary').click();
        await card.getByLabel('Modo de dibujo').selectOption('auto');
        await card.getByRole('button', { name: 'Generar con Codex' }).click();
        await card.getByRole('region', { name: 'Revisión del dibujo' }).getByText('Orquídea · orquidea').waitFor();
        await card.getByRole('button', { name: 'Aplicar al borrador' }).click();
        await card.getByText(/Aplicado al borrador/).waitFor();
        await page.getByRole('button', { name: 'Guardar', exact: true }).click();
        await page.getByText(/Guardado · rev\./).waitFor();
        const project = (await store.listProjects()).find(p => !before.has(p.projectId));
        assert.ok(project);
        paths.push(join(root, project.projectId, 'project.json'));
        await page.getByRole('button', { name: 'Proyectos', exact: true }).click();
        if (paths.length === 1) {
          await page.getByRole('button', { name: 'Abrir', exact: true }).click();
          await page.getByRole('region', { name: 'Vista previa del borrador' }).locator('canvas').waitFor();
          await page.getByRole('button', { name: 'Proyectos', exact: true }).click();
        }
      }
      const projects = await Promise.all(paths.map(async path => JSON.parse(await readFile(path, 'utf8'))));
      for (const project of projects) assert.ok(validateProject(project).ok);
      const id = projects[0].models[0].id;
      assert.equal(id, createHash('sha256').update(canonicalize(projects[0].models[0].model)).digest('hex'));
      assert.deepEqual(projects[0].models, projects[1].models);
      for (const project of projects) assert.equal(project.scenes[0].visual.objects[0].params.modelId, id);
      assert.equal(JSON.parse(await readFile(join(root, '.models'), 'utf8')).length, 1);
      const records = (await readFile(fake.env.FAKE_CODEX_RECORD, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
      assert.equal(records.length, 4);
      const drawings = records.filter(record => record.schema.properties.models);
      assert.equal(drawings.length, 2);
      assert.doesNotMatch(drawings[0].input, new RegExp(id));
      assert.match(drawings[1].input, new RegExp(id));
      const outputs = (await readFile(`${fake.env.FAKE_CODEX_RECORD}.outputs`, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
      const bundles = outputs.filter(output => output.scene);
      assert.equal(bundles[0].models.length, 1);
      assert.deepEqual(bundles[1].models, []);
      assert.equal(bundles[1].scene.objects[0].params.modelId, id);
      // The fake validates each emitted response against the exact schema passed by the companion.
      await writeFile(join(root, '.models'), '[]');
      await page.getByRole('button', { name: 'Abrir', exact: true }).first().click();
      const canvas = page.getByRole('region', { name: 'Vista previa del borrador' }).locator('canvas');
      await canvas.waitFor();
      await page.waitForTimeout(1000);
      const pink = await canvas.evaluate((element: HTMLCanvasElement) => {
        const copy = document.createElement('canvas'); copy.width = element.width; copy.height = element.height;
        const ctx = copy.getContext('2d')!; ctx.drawImage(element, 0, 0);
        const data = ctx.getImageData(0, 0, copy.width, copy.height).data;
        let count = 0; for (let i = 0; i < data.length; i += 4) if (data[i]! > 100 && data[i]! > data[i + 1]! * 1.5 && data[i + 2]! > data[i + 1]! * 1.3) count++;
        return count;
      });
      assert.ok(pink > 50, `expected visible orchid pixels, got ${pink}`);
      for (const [index, path] of paths.entries()) {
        const output = join(root, `orchid-${index}.mp4`);
        await exec(process.execPath, ['scripts/render-project.ts', path, output], { timeout: 180_000 });
        const { stdout } = await exec(resolve('node_modules/.bin/remotion'), ['ffprobe', '-v', 'error', '-show_streams', '-of', 'json', output]);
        const video = JSON.parse(stdout).streams.find((stream: any) => stream.codec_type === 'video');
        assert.equal(video.codec_name, 'h264'); assert.equal(video.width, 1080); assert.equal(video.height, 1920); assert.equal(video.avg_frame_rate, '30/1');
        assert.equal(Number(video.nb_frames), 60);
      }
      const reference = structuredClone(projects[0]);
      reference.scenes[0].visual.objects = [];
      const referencePath = join(root, 'without-model.json');
      await writeFile(referencePath, JSON.stringify(reference));
      await exec(process.execPath, ['scripts/render-project.ts', referencePath, join(root, 'without-model.mp4')], { timeout: 180_000 });
      const frame = async (video: string, file: string) => {
        await exec(resolve('node_modules/.bin/remotion'), ['ffmpeg', '-v', 'error', '-ss', '0.5', '-i', join(root, video),
          '-frames:v', '1', '-vf', 'scale=270:480', join(root, file)]);
        return (await readFile(join(root, file))).toString('base64');
      };
      const a = await frame('orchid-0.mp4', 'a.png');
      const repeated = await frame('orchid-0.mp4', 'repeat.png');
      const b = await frame('orchid-1.mp4', 'b.png');
      const absent = await frame('without-model.mp4', 'absent.png');
      const { different, pinkPixels, repeatDiff, projectDiff, backgroundColors } = await page.evaluate(async sources => {
        const pixels = await Promise.all(sources.map(source => new Promise<Uint8ClampedArray>((resolve, reject) => {
          const image = new Image(); image.onerror = reject; image.onload = () => {
            const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
            const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0); resolve(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
          }; image.src = `data:image/png;base64,${source}`;
        })));
        let different = 0, pinkPixels = 0, repeatDiff = 0, projectDiff = 0;
        const colors = new Set<string>();
        for (let i = 0; i < pixels[0]!.length; i += 4) {
          const [a, repeat, b, absent] = pixels.map(p => p.subarray(i, i + 3));
          const delta = (left: Uint8ClampedArray, right: Uint8ClampedArray) => Math.abs(left[0]! - right[0]!) + Math.abs(left[1]! - right[1]!) + Math.abs(left[2]! - right[2]!);
          if (delta(a!, absent!) > 40) different++;
          if (delta(a!, repeat!) > 0) repeatDiff++;
          if (delta(a!, b!) > 0) projectDiff++;
          if (i % 400 === 0) colors.add(`${absent![0]},${absent![1]},${absent![2]}`);
          if (a![0]! > 100 && a![0]! > a![1]! * 1.5 && a![2]! > a![1]! * 1.3) pinkPixels++;
        }
        return { different, pinkPixels, repeatDiff, projectDiff, backgroundColors: colors.size };
      }, [a, repeated, b, absent]);
      assert.equal(repeatDiff, 0, 'same decoded frame is deterministic');
      assert.equal(projectDiff, 0, 'independent saved snapshots render the same frame');
      assert.ok(different > 100, `model must change the frame: ${different} pixels`);
      assert.ok(pinkPixels > 20, `render must contain orchid-colored pixels: ${pinkPixels}`);
      assert.ok(backgroundColors > 10, `background should not be uniform: ${backgroundColors} colors`);
    }, 'chromium', { env: fake.env });
  } finally { await fake.cleanup(); }
});

test('project model renders as a composite and survives deterministic seeks in Chromium', async t => {
  await withStudio(t, async ({ page, consoleErrors, resourceErrors }) => {
    page.setDefaultTimeout(15000);
    await page.setViewportSize({ width: 1280, height: 1400 });
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, options?: any): any {
        return original.call(this, type as '2d', type === 'webgl2' || type === 'webgl'
          ? { ...options, preserveDrawingBuffer: true } : options);
      } as typeof HTMLCanvasElement.prototype.getContext;
    });
    await page.reload();
    const source = validateProject(fixtureJson('storyboard'));
    assert.ok(source.ok);
    const part = (shape: 'sphere' | 'cylinder', position: [number, number, number], scale: [number, number, number], color: string) =>
      ({ shape, position, rotation: [0, 0, 0] as [number, number, number], scale, color });
    const model = { version: 1 as const, name: 'Plant', semanticId: 'plant', parts: [
      part('cylinder', [0, 0.6, 0], [0.25, 1.2, 0.25], '#3a7935'),
      part('sphere', [0, 1.7, 0], [2, 1.8, 2], '#38b733'),
      part('sphere', [-0.7, 1.4, 0], [1.2, 1.2, 1.2], '#2c8e29'),
    ] };
    const id = createHash('sha256').update(canonicalize(model)).digest('hex');
    source.project.models = [{ id, model }];
    const visual: KitScene = JSON.parse(await readFile('docs/plan/examples/kit/sal-del-mar.json', 'utf8'));
    visual.objects = [{ id: 'plant', type: 'model', params: { modelId: id }, position: [0, 1, 0], rotation: [0, 0, 0], scale: 2,
      color: '#ffffff', animations: [{ type: 'pulse', startMs: 0, endMs: 4000, easing: 'linear', params: { amplitude: 0.25, cycles: 1 } }] }];
    visual.labels = [];
    source.project.scenes[0]!.visual = visual;
    source.project.scenes[1]!.visual = structuredClone(visual);
    assert.ok(validateProject(source.project).ok);
    await page.getByLabel('JSON externo').setInputFiles({ name: 'project.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(source.project)) });
    const preview = page.getByRole('region', { name: 'Vista previa del borrador' });
    const player = preview.locator('.preview-transport');
    const canvas = player.locator('canvas');
    await canvas.waitFor();
    await preview.scrollIntoViewIfNeeded();
    const bar = player.locator('div[style*="touch-action: none"]');
    const bounds = await bar.boundingBox();
    assert.ok(bounds);
    const seek = async (fraction: number) => {
      await bar.click({ position: { x: bounds.width * fraction, y: bounds.height / 2 } });
      await page.waitForTimeout(400);
      return canvas.evaluate((element: HTMLCanvasElement) => {
        const copy = document.createElement('canvas');
        copy.width = element.width; copy.height = element.height;
        const context = copy.getContext('2d')!;
        context.drawImage(element, 0, 0);
        const data = context.getImageData(0, 0, copy.width, copy.height).data;
        let green = 0;
        for (let i = 0; i < data.length; i += 4) if (data[i + 1]! > data[i]! * 1.3 && data[i + 1]! > data[i + 2]! * 1.3 && data[i + 3]! > 0) green++;
        return { pixels: copy.toDataURL(), green };
      });
    };
    const first = await seek(0.12);
    const later = await seek(0.32);
    const repeated = await seek(0.12);
    const nextScene = await seek(0.62);
    assert.ok(first.green > 100, `expected green model pixels, got ${first.green}`);
    assert.notEqual(first.pixels, later.pixels);
    assert.equal(first.pixels, repeated.pixels);
    assert.equal(first.pixels, nextScene.pixels, 'same snapshot and local frame render identically across scenes');
    if (process.env.MODEL_INSPECTION_PATH) await canvas.screenshot({ path: process.env.MODEL_INSPECTION_PATH });
    assert.deepEqual(consoleErrors, []);
    assert.deepEqual(resourceErrors, []);
  }, 'chromium');
});

test('browser preview refuses a forged snapshot even if the project response is tampered', async t => {
  await withStudio(t, async ({ page }) => {
    await page.route('**/api/projects/*', async route => {
      if (route.request().method() !== 'GET') return route.continue();
      const response = await route.fetch();
      const body = await response.json();
      if (body.project) body.project.models = [{ id: 'a'.repeat(64), model: {
        version: 1, name: 'Plant', semanticId: 'plant', parts: [
          { shape: 'sphere', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], color: '#00ff00' },
        ],
      } }];
      await route.fulfill({ response, json: body });
    });
    await page.getByLabel('JSON externo').setInputFiles({ name: 'project.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixtureJson('storyboard'))) });
    const preview = page.getByRole('region', { name: 'Vista previa del borrador' });
    await preview.getByRole('status').getByText('No se puede mostrar este borrador.', { exact: false }).waitFor();
    assert.equal(await preview.locator('canvas').count(), 0);
  }, 'chromium');
});
