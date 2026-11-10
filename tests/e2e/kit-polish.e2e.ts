import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { withStudio } from '../helpers/studio-browser.ts';
import { fixtureJson } from '../helpers/fixtures.ts';
import { validateProject } from '../../src/shared/schema/validate.ts';
import type { KitScene } from '../../src/shared/kit/types.ts';

test('kit shadows, river banks and solid arrows remain identical after forward/backward seek in Chromium', async t => {
  await withStudio(t, async ({ page, consoleErrors, resourceErrors }) => {
    page.setDefaultTimeout(15000);
    await page.setViewportSize({ width: 1280, height: 1400 });
    const source = validateProject(fixtureJson('storyboard'));
    assert.ok(source.ok);
    const visual: KitScene = JSON.parse(await readFile('docs/plan/examples/kit/sal-del-mar.json', 'utf8'));
    visual.objects.push({ id: 'polish-arrow', type: 'arrow', color: '#FFCA3A', scale: 1,
      position: [0, 1, 2], rotation: [0, 0, 0], animations: [],
      params: { color: '#FFCA3A', direction: [1, 0, 0], proportions: { width: 0.3, height: 1.5, depth: 0.25 } } });
    source.project.scenes[0]!.visual = visual;
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
      return canvas.screenshot();
    };
    const first = await seek(0.12);
    const later = await seek(0.32);
    const repeated = await seek(0.12);
    assert.notDeepEqual(first, later, 'camera/river animation advances');
    assert.deepEqual(first, repeated, 'no accumulated simulation or shadow history');
    if (process.env.PREVIEW_SCREENSHOT_DIR) await preview.screenshot({ path: join(process.env.PREVIEW_SCREENSHOT_DIR, 'kit-polish-seek.png') });
    assert.deepEqual(consoleErrors, []);
    assert.deepEqual(resourceErrors, []);
  }, 'chromium');
});
