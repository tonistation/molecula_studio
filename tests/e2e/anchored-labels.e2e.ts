import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { withStudio } from '../helpers/studio-browser.ts';
import { measureAnchoredLabel } from '../../src/video/kit/overlays/measure-label.ts';
import { anchoredLabelLayout } from '../../src/video/kit/overlays/layout.ts';

test('anchored labels keep complete Chromium pill/text bounds safe at all corners and hide off-frustum anchors', async t => {
  const project = JSON.parse(await readFile(new URL('../../docs/plan/examples/kit/sal-del-mar-storyboard.json', import.meta.url), 'utf8'));
  project.scenes = [project.scenes[0]];
  project.output.durationMs = project.scenes[0].durationMs;
  const visual = project.scenes[0].visual;
  visual.camera = { move: 'static', from: [0, 0, 10], to: [0, 0, 10], target: [0, 0, 0], easing: 'linear' };
  visual.particles = []; visual.overlays = [];
  const halfHeight = 10 * Math.tan(Math.PI / 8);
  visual.objects = ([[-0.99, 0.99], [0.99, 0.99], [-0.99, -0.99], [0.99, -0.99], [0, -0.99], [2, 0]] as const).map(([x, y], i) => ({
    id: `corner-${i}`, type: 'sphere', params: { radius: 0.1 }, position: [x * halfHeight * 9 / 16, y * halfHeight, 0],
    rotation: [0, 0, 0], scale: 1, color: '#FFFFFF', animations: [],
  }));
  visual.labels = visual.objects.map((object: { id: string }, i: number) => ({ objectId: object.id,
    text: i === 0 ? 'Minerales' : i === 1 ? 'W'.repeat(120) : i === 2 ? '礦🪨é'.repeat(40) : i < 5 ? 'ဪ'.repeat(120) : 'Fuera', color: '#172D45' }));
  await withStudio(t, async ({ page, consoleErrors, resourceErrors }) => {
    page.setDefaultTimeout(15000);
    await page.evaluate(() => {
      const load = document.fonts.load.bind(document.fonts);
      Object.assign(window, { labelFontLoads: 0 });
      document.fonts.load = (font, text) => {
        if (font === '700 34px sans-serif') (window as unknown as { labelFontLoads: number }).labelFontLoads++;
        return load(font, text);
      };
    });
    await page.getByLabel('JSON externo').setInputFiles({ name: 'project.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
    const labels = page.locator('[data-anchored-label]');
    await labels.first().waitFor();
    await page.waitForFunction(() => Array.from(document.querySelectorAll('[data-anchored-label]')).every(el => (el as HTMLElement).dataset.labelFitted === 'true'));
    assert.equal(await labels.count(), 5);
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
          text: pill.textContent, fontSize: getComputedStyle(pill).fontSize,
          padding: getComputedStyle(pill).padding, fontWeight: getComputedStyle(pill).fontWeight };
      }));
      for (const bounds of result) {
        assert.ok(bounds.left >= 31.9 && bounds.right <= 1048.1, JSON.stringify(bounds));
        assert.ok(bounds.top >= 31.9 && bounds.bottom <= 1888.1, JSON.stringify(bounds));
        assert.equal(bounds.overflow, false); assert.equal(bounds.textInside, true);
      }
      assert.equal(result[1]!.text, 'W'.repeat(120)); assert.equal(result[2]!.text, '礦🪨é'.repeat(40));
      assert.equal(result[3]!.text, 'ဪ'.repeat(120)); assert.equal(result[4]!.text, 'ဪ'.repeat(120));
      assert.equal(result[0]!.fontSize, '34px', 'Latin labels retain their original font size');
      assert.equal(result[0]!.padding, '15px 28px'); assert.equal(result[0]!.fontWeight, '700');
      if (viewport.width === 1280) {
        const { left, right, top, bottom, fontSize } = result[4]!;
        t.diagnostic(`Myanmar bottom-center fitted bounds: ${JSON.stringify({ left, right, top, bottom, fontSize })}`);
      }
    }
    const before = await labels.evaluateAll(elements => elements.map(el => (el as HTMLElement).style.cssText + el.firstElementChild!.getAttribute('style')));
    const fontLoads = await page.evaluate(() => (window as unknown as { labelFontLoads: number }).labelFontLoads);
    const transport = page.locator('.preview-transport');
    const bar = transport.locator('div[style*="touch-action: none"]');
    const barBox = await bar.boundingBox(); assert.ok(barBox);
    await bar.click({ position: { x: barBox.width * 0.5, y: barBox.height / 2 } });
    await page.getByRole('button', { name: 'Ver escena 1', exact: true }).click();
    assert.deepEqual(await labels.evaluateAll(elements => elements.map(el => (el as HTMLElement).style.cssText + el.firstElementChild!.getAttribute('style'))), before);
    assert.equal(await page.evaluate(() => (window as unknown as { labelFontLoads: number }).labelFontLoads), fontLoads, 'frame changes do not remeasure fonts');

    // Exercise the production measurement function with actual CSS and fallback fonts at small composition sizes.
    const cssText = await labels.first().locator('> div').evaluate(el => (el as HTMLElement).style.cssText);
    const isolated = await page.context().newPage();
    try {
      await isolated.setContent('<body style="margin:0"></body>');
      for (const [width, height] of [[1080, 1920], [180, 240], [64, 48], [31.5, 27.25]] as const) {
        await isolated.setViewportSize({ width: Math.ceil(width), height: Math.ceil(height) });
        for (const text of ['Minerales', 'ဪ'.repeat(120), '礦🪨é'.repeat(40), 'W'.repeat(120)]) {
          await isolated.evaluate(async text => { await document.fonts.load('700 34px sans-serif', text); await document.fonts.ready; }, text);
          const envelope = anchoredLabelLayout(0, 0, width, height);
          const fittedCssText = await isolated.evaluate(({ cssText, envelope }) => {
            const element = document.createElement('div'); element.style.cssText = cssText;
            element.style.padding = `${envelope.paddingY}px ${envelope.paddingX}px`; return element.style.cssText;
          }, { cssText, envelope });
          const fit = await isolated.evaluate(measureAnchoredLabel, { text, cssText: fittedCssText, width: envelope.width, height: envelope.height });
          assert.deepEqual(await isolated.evaluate(measureAnchoredLabel, { text, cssText: fittedCssText, width: envelope.width, height: envelope.height }), fit);
          for (const [x, y] of [[0, 0], [width, 0], [0, height], [width, height], [width / 2, height * 0.995]]) {
            const layout = anchoredLabelLayout(x!, y!, width, height, fit.height);
            const bounds = await isolated.evaluate(({ cssText, text, fit, layout }) => {
              const pill = document.createElement('div'); pill.style.cssText = cssText; pill.textContent = text;
              Object.assign(pill.style, { maxWidth: `${layout.width}px`, fontSize: `${fit.fontSize}px`,
                padding: `${layout.paddingY}px ${layout.paddingX}px`,
                left: `${layout.left + (layout.width - fit.width) / 2 - fit.minX * fit.scale}px`, top: `${layout.top - fit.minY * fit.scale}px`, transform: `scale(${fit.scale})` });
              document.body.append(pill);
              const rect = pill.getBoundingClientRect();
              const range = document.createRange(); range.selectNodeContents(pill);
              const rects = [rect, ...range.getClientRects()];
              const result = { left: Math.min(...rects.map(r => r.left)), top: Math.min(...rects.map(r => r.top)),
                right: Math.max(...rects.map(r => r.right)), bottom: Math.max(...rects.map(r => r.bottom)), text: pill.textContent };
              pill.remove(); return result;
            }, { cssText, text, fit, layout });
            assert.ok(bounds.left >= layout.margin - 0.02 && bounds.top >= layout.margin - 0.02, JSON.stringify(bounds));
            assert.ok(bounds.right <= width - layout.margin + 0.02 && bounds.bottom <= height - layout.margin + 0.02, JSON.stringify(bounds));
            assert.equal(bounds.text, text);
          }
          assert.equal(await isolated.locator('[data-label-measure]').count(), 0, 'measurement nodes always removed');
        }
      }
    } finally { await isolated.close(); }
    assert.deepEqual(consoleErrors, []); assert.deepEqual(resourceErrors, []);
  }, 'chromium');
});

test('unmount while label fonts load releases render handles and ignores late completion', async t => {
  await withStudio(t, async ({ page, consoleErrors, resourceErrors }) => {
    await page.waitForFunction(() => (window as unknown as { remotion_delayRenderHandles: number[] }).remotion_delayRenderHandles.length === 0);
    await page.evaluate(() => {
      const load = document.fonts.load.bind(document.fonts);
      const releases: (() => void)[] = [];
      Object.assign(window, { releaseLabelFonts: () => releases.splice(0).forEach(resolve => resolve()) });
      document.fonts.load = (font, text) => font === '700 34px sans-serif'
        ? new Promise<FontFace[]>(resolve => releases.push(() => { void load(font, text).then(resolve); })) : load(font, text);
    });
    const project = await readFile(new URL('../../docs/plan/examples/kit/sal-del-mar-storyboard.json', import.meta.url));
    await page.getByLabel('JSON externo').setInputFiles({ name: 'project.json', mimeType: 'application/json', buffer: project });
    await page.locator('[data-label-fitted="false"]').first().waitFor();
    await page.waitForFunction(() => (window as unknown as { remotion_delayRenderHandles: number[] }).remotion_delayRenderHandles.length > 0);
    await page.getByRole('button', { name: 'Proyectos', exact: true }).click();
    assert.equal(await page.evaluate(() => (window as unknown as { remotion_delayRenderHandles: number[] }).remotion_delayRenderHandles.length), 0);
    await page.evaluate(async () => { (window as unknown as { releaseLabelFonts(): void }).releaseLabelFonts(); await document.fonts.ready; });
    assert.equal(await page.locator('[data-label-measure], [data-anchored-label]').count(), 0);
    assert.equal(await page.evaluate(() => (window as unknown as { remotion_delayRenderHandles: number[] }).remotion_delayRenderHandles.length), 0);
    assert.deepEqual(consoleErrors, []); assert.deepEqual(resourceErrors, []);
  }, 'chromium');
});
