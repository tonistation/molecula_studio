import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Vector3 } from 'three';
import { withStudio } from '../helpers/studio-browser.ts';
import { fixtureJson } from '../helpers/fixtures.ts';
import { validateProject } from '../../src/shared/schema/validate.ts';
import { cameraAt, makeCamera } from '../../src/video/kit/camera.ts';
import { animateObject } from '../../src/video/kit/animate.ts';
import type { KitObject, KitScene } from '../../src/shared/kit/types.ts';

test('appear/disappear and legacy reveal fade real receiver shadows without a final pop, and seek deterministically', async t => {
  for (const mode of ['appear', 'disappear', 'reveal'] as const) {
    await withStudio(t, async ({ page, consoleErrors, resourceErrors }) => {
      page.setDefaultTimeout(15000);
      await page.setViewportSize({ width: 1280, height: 1400 });
      const parsed = validateProject(fixtureJson('storyboard'));
      assert.ok(parsed.ok);
      const project = parsed.project;
      const legacy = structuredClone((project.scenes[0]!.visual as KitScene).objects.find(o => o.type === 'rockLayers')!);
      assert.ok(legacy);
      const object: KitObject = mode === 'reveal' ? { ...legacy, position: [0, 1.3, 0], rotation: [0, 0, 0],
        animations: [], legacy: { ...legacy.legacy!, motion: 'reveal' } } : {
        id: 'fade-box', type: 'box', position: [0, 2, 0], rotation: [0, 0, 0], scale: 1, color: '#CC6644',
        params: { width: 1.4, height: 1.4, depth: 1.4 },
        animations: [{ type: mode, startMs: 0, endMs: 3300, easing: 'linear', params: {} }],
      };
      const kit: KitScene = JSON.parse(await readFile('docs/plan/examples/kit/sal-del-mar.json', 'utf8'));
      kit.environment = { seed: 1, terrain: { type: 'plain', size: 12, height: 0, color: '#C4B898' }, water: null };
      kit.sky.clouds = []; kit.sky.sun = null; kit.objects = [object]; kit.particles = []; kit.labels = []; kit.overlays = [];
      kit.camera = { move: 'static', from: [0, 8, 8], to: [0, 8, 8], target: [0, 0, 0], easing: 'linear' };
      project.projectId = `project_shadow_${mode}`; project.captionStyle.enabled = false;
      project.scenes = [{ ...project.scenes[0]!, startMs: 0, durationMs: 6000, visual: kit, words: [], audio: null,
        mediaBindings: { audio: null, words: null } }];
      project.output.durationMs = 6000;
      const checked = validateProject(project);
      assert.ok(checked.ok, JSON.stringify(checked));
      await page.getByLabel('JSON externo').setInputFiles({ name: `${mode}.json`, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
      const player = page.getByRole('region', { name: 'Vista previa del borrador' }).locator('.preview-transport');
      const canvas = player.locator('canvas'); await canvas.waitFor();
      await player.scrollIntoViewIfNeeded();
      await page.waitForFunction(() => (document.querySelector('.preview-transport canvas')?.getBoundingClientRect().height ?? 0) > 300);
      const bar = player.locator('div[style*="touch-action: none"]');
      const bounds = await bar.boundingBox(); assert.ok(bounds);
      const canvasBounds = await canvas.boundingBox(); assert.ok(canvasBounds);
      const seek = async (frame: number) => {
        await bar.click({ position: { x: bounds.width * frame / 179, y: bounds.height / 2 } });
        await page.waitForTimeout(350);
        // Exclude the overlapping Player controls/hover effects, not any scene geometry.
        return page.screenshot({ clip: { ...canvasBounds, height: canvasBounds.height - 80 } });
      };
      const frames = mode === 'appear' ? [99, 50, 1, 0] : mode === 'disappear' ? [0, 49, 98, 99] : [15, 5, 1, 0];
      const images: Buffer[] = [];
      for (const frame of frames) images.push(await seek(frame));
      const repeated = await seek(frames[1]!);
      if (process.env.PREVIEW_SCREENSHOT_DIR) {
        await writeFile(join(process.env.PREVIEW_SCREENSHOT_DIR, `fade-${mode}-half.png`), images[1]!);
        await writeFile(join(process.env.PREVIEW_SCREENSHOT_DIR, `fade-${mode}-repeat.png`), repeated);
      }
      assert.ok(repeated.equals(images[1]!), `${mode}: seek back restores exact shadow pixels`);
      assert.ok((await seek(frames[0]!)).equals(images[0]!), `${mode}: opaque shadow restored after depth material detaches`);
      const camera = makeCamera(cameraAt(kit.camera, 0, 6000, kit.objects), 1080, 1920);
      const center = new Vector3(1.2, 0, -1.2).project(camera);
      const means = await page.evaluate(async ({ pngs, x, y }) => {
        const result: number[] = [];
        for (const png of pngs) {
          const image = new Image(); image.src = `data:image/png;base64,${png}`; await image.decode();
          const scratch = document.createElement('canvas'); scratch.width = image.width; scratch.height = image.height;
          const ctx = scratch.getContext('2d')!; ctx.drawImage(image, 0, 0);
          const patch = ctx.getImageData(Math.round(x * image.width) - 5, Math.round(y * image.height) - 5, 10, 10).data;
          let sum = 0; for (let i = 0; i < patch.length; i += 4) sum += (patch[i]! + patch[i + 1]! + patch[i + 2]!) / 3;
          result.push(sum / 100);
        }
        return result;
      }, { pngs: images.map(image => image.toString('base64')), x: (center.x + 1) / 2,
        y: (1 - center.y) / 2 * canvasBounds.height / (canvasBounds.height - 80) });
      const opacities = frames.map(frame => animateObject(object, frame * 1000 / 30).opacity);
      t.diagnostic(`${mode}: opacity ${opacities.join(', ')}; receiver mean ${means.join(', ')}`);
      // Layered legacy meshes overlap: hashed coverage is monotone, not linear in group opacity.
      assert.ok(means[1]! > means[0]! + 2, `${mode}: half opacity must lighten the shadow`);
      assert.ok(means[2]! > means[1]! + 5, `${mode}: near-zero opacity must lighten it further`);
      const finalStepLimit = mode === 'reveal' ? (means[3]! - means[0]!) * 0.4 : 12;
      assert.ok(Math.abs(means[3]! - means[2]!) < finalStepLimit, `${mode}: hiding must not pop from an opaque shadow`);
      assert.ok(means[3]! > means[0]! + 35, `${mode}: actually samples a shadow receiver, not sky/object`);
      assert.deepEqual(consoleErrors, []); assert.deepEqual(resourceErrors, []);
    }, 'chromium');
  }
});
