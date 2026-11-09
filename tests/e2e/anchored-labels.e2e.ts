import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { withStudio } from '../helpers/studio-browser.ts';

test('anchored labels keep complete Chromium pill/text bounds safe at all corners and hide off-frustum anchors', async t => {
  const project = JSON.parse(await readFile(new URL('../../docs/plan/examples/kit/sal-del-mar-storyboard.json', import.meta.url), 'utf8'));
  project.scenes = [project.scenes[0]];
  project.output.durationMs = project.scenes[0].durationMs;
  const visual = project.scenes[0].visual;
  visual.camera = { move: 'static', from: [0, 0, 10], to: [0, 0, 10], target: [0, 0, 0], easing: 'linear' };
  visual.particles = []; visual.overlays = [];
  const halfHeight = 10 * Math.tan(Math.PI / 8);
  visual.objects = ([[-0.99, 0.99], [0.99, 0.99], [-0.99, -0.99], [0.99, -0.99], [2, 0]] as const).map(([x, y], i) => ({
    id: `corner-${i}`, type: 'sphere', params: { radius: 0.1 }, position: [x * halfHeight * 9 / 16, y * halfHeight, 0],
    rotation: [0, 0, 0], scale: 1, color: '#FFFFFF', animations: [],
  }));
  visual.labels = visual.objects.map((object: { id: string }, i: number) => ({ objectId: object.id,
    text: i === 0 ? 'Minerales' : i === 1 ? 'W'.repeat(120) : i === 2 ? '礦🪨é'.repeat(40) : i === 3 ? 'Abajo' : 'Fuera', color: '#172D45' }));
  await withStudio(t, async ({ page, consoleErrors, resourceErrors }) => {
    page.setDefaultTimeout(15000);
    await page.getByLabel('JSON externo').setInputFiles({ name: 'project.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
    const labels = page.locator('[data-anchored-label]');
    await labels.first().waitFor();
    assert.equal(await labels.count(), 4);
    for (const viewport of [{ width: 1280, height: 1400 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      const result = await labels.evaluateAll(elements => elements.map(element => {
        const pill = element.firstElementChild as HTMLElement;
        const wrapper = element as HTMLElement;
        const rect = pill.getBoundingClientRect();
        const parent = element.parentElement!.getBoundingClientRect();
        const scale = parent.width / 1080;
        const range = document.createRange(); range.selectNodeContents(pill);
        return { left: (rect.left - parent.left) / scale, top: (rect.top - parent.top) / scale,
          right: (rect.right - parent.left) / scale, bottom: (rect.bottom - parent.top) / scale,
          overflow: pill.scrollHeight > wrapper.clientHeight || pill.scrollWidth > wrapper.clientWidth,
          textInside: Array.from(range.getClientRects()).every(r => r.left >= rect.left - 1 && r.right <= rect.right + 1 && r.top >= rect.top - 1 && r.bottom <= rect.bottom + 1),
          text: pill.textContent };
      }));
      for (const bounds of result) {
        assert.ok(bounds.left >= 31.9 && bounds.right <= 1048.1, JSON.stringify(bounds));
        assert.ok(bounds.top >= 31.9 && bounds.bottom <= 1888.1, JSON.stringify(bounds));
        assert.equal(bounds.overflow, false); assert.equal(bounds.textInside, true);
      }
      assert.equal(result[1]!.text, 'W'.repeat(120)); assert.equal(result[2]!.text, '礦🪨é'.repeat(40));
    }
    assert.deepEqual(consoleErrors, []); assert.deepEqual(resourceErrors, []);
  }, 'chromium');
});
