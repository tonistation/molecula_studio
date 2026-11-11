import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { withStudio } from '../helpers/studio-browser.ts';
import { measureAnchoredLabel } from '../../src/video/kit/overlays/measure-label.ts';
import { anchoredLabelLayout } from '../../src/video/kit/overlays/layout.ts';

test('zero-scale pulsing object labels disappear, release render handles and recover on seek', async t => {
  const project = JSON.parse(await readFile(new URL('../../docs/plan/examples/kit/sal-del-mar-storyboard.json', import.meta.url), 'utf8'));
  project.scenes = [project.scenes[0]]; project.scenes[0].durationMs = 4000; project.output.durationMs = 4000;
  const visual = project.scenes[0].visual;
  visual.camera = { move: 'static', from: [0, 0, 10], to: [0, 0, 10], target: [0, 0, 0], easing: 'linear' };
  visual.particles = []; visual.overlays = []; visual.labels = [];
  visual.objects = [{ id: 'pulse-label', type: 'label', params: { proportions: { width: 2, height: 0.5, depth: 0.1 }, text: 'Pulso', color: '#273E46' },
    position: [0, 0, 0], rotation: [0, 0, 0.4], scale: 1, color: '#273E46',
    animations: [{ type: 'pulse', startMs: 0, endMs: 4000, easing: 'linear', params: { amplitude: 1, cycles: 1 } }] }];
  await withStudio(t, async ({ page, consoleErrors, resourceErrors }) => {
    await page.getByLabel('JSON externo').setInputFiles({ name: 'project.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
    await page.waitForSelector('[data-object-label][data-label-fitted="true"]');
    const bar = page.locator('.preview-transport div[style*="touch-action: none"]');
    const box = await bar.boundingBox(); assert.ok(box);
    const seek = async (fraction: number) => { await bar.click({ position: { x: box.width * fraction, y: box.height / 2 } }); };
    await seek(90.5 / 119);
    await page.waitForFunction(() => document.querySelectorAll('[data-object-label]').length === 0 && (window as unknown as { remotion_delayRenderHandles: number[] }).remotion_delayRenderHandles.length === 0);
    await seek(91.5 / 119);
    await page.waitForSelector('[data-object-label][data-label-fitted="true"]');
    const after = await page.locator('[data-object-label]').evaluate(el => ({ width: parseFloat((el as HTMLElement).style.width), rotation: (el as HTMLElement).style.rotate, text: el.textContent }));
    const expectedWidth = 2 * 1920 / (2 * Math.tan(Math.PI / 8) * 10) * (1 + Math.sin(91 / 120 * Math.PI * 2));
    assert.ok(Math.abs(after.width - expectedWidth) < 0.02); assert.equal(after.rotation, '0.4rad'); assert.equal(after.text, 'Pulso');
    await seek(90.5 / 119);
    await page.waitForFunction(() => document.querySelectorAll('[data-object-label]').length === 0 && (window as unknown as { remotion_delayRenderHandles: number[] }).remotion_delayRenderHandles.length === 0);
    await page.getByRole('button', { name: 'Ver escena 1', exact: true }).click();
    await page.waitForSelector('[data-object-label][data-label-fitted="true"]');
    await page.evaluate(() => {
      const load = document.fonts.load.bind(document.fonts); const releases: (() => void)[] = [];
      Object.assign(window, { releasePulseFonts: () => releases.splice(0).forEach(release => release()) });
      document.fonts.load = (font, text) => font === '700 34px sans-serif'
        ? new Promise<FontFace[]>(resolve => releases.push(() => { void load(font, text).then(resolve); })) : load(font, text);
    });
    await seek(0.8);
    await page.waitForSelector('[data-object-label][data-label-fitted="false"]');
    await seek(90.5 / 119);
    await page.waitForFunction(() => document.querySelectorAll('[data-object-label]').length === 0 && (window as unknown as { remotion_delayRenderHandles: number[] }).remotion_delayRenderHandles.length === 0);
    await page.evaluate(() => (window as unknown as { releasePulseFonts(): void }).releasePulseFonts());
    assert.equal(await page.locator('[data-object-label]').count(), 0, 'late font completion does not revive a zero-scale label');
    await seek(0.8);
    await page.waitForSelector('[data-object-label][data-label-fitted="false"]');
    await page.evaluate(() => (window as unknown as { releasePulseFonts(): void }).releasePulseFonts());
    await page.waitForSelector('[data-object-label][data-label-fitted="true"]');
    await seek(0.7);
    await page.waitForSelector('[data-object-label][data-label-fitted="false"]');
    await page.getByRole('button', { name: 'Proyectos', exact: true }).click();
    assert.equal(await page.evaluate(() => (window as unknown as { remotion_delayRenderHandles: number[] }).remotion_delayRenderHandles.length), 0);
    await page.evaluate(() => (window as unknown as { releasePulseFonts(): void }).releasePulseFonts());
    assert.equal(await page.locator('[data-object-label]').count(), 0);
    assert.deepEqual(consoleErrors, []); assert.deepEqual(resourceErrors, []);
  }, 'chromium');
});

test('natural words wrap intact and projected object labels stay inside the viewport', async t => {
  const project = JSON.parse(await readFile(new URL('../../docs/plan/examples/kit/sal-del-mar-storyboard.json', import.meta.url), 'utf8'));
  project.scenes = [project.scenes[0]]; project.output.durationMs = project.scenes[0].durationMs;
  const visual = project.scenes[0].visual;
  visual.camera = { move: 'static', from: [0, 0, 10], to: [0, 0, 10], target: [0, 0, 0], easing: 'linear' };
  visual.particles = []; visual.overlays = [];
  const halfWidth = 10 * Math.tan(Math.PI / 8) * 9 / 16;
  visual.objects = [-0.99, 0.99, 2].map((x, i) => ({
    id: `object-label-${i}`, type: 'label', params: { proportions: { width: 2, height: 0.25, depth: 0.1 }, text: `Objeto ${i}`, color: '#273E46' },
    position: [x * halfWidth, 0, 0], rotation: [0, 0, 0], scale: 1, color: '#273E46', animations: [],
  }));
  visual.objects.push({ id: 'anchor', type: 'sphere', params: { radius: 0.1 }, position: [0, 0, 0], rotation: [0, 0, 0], scale: 1, color: '#FFFFFF', animations: [] });
  visual.labels = [{ objectId: 'anchor', text: 'salado '.repeat(12).trim(), color: '#172D45' },
    { objectId: 'anchor', text: 'W'.repeat(120), color: '#172D45' }];
  await withStudio(t, async ({ page, consoleErrors, resourceErrors }) => {
    await page.getByLabel('JSON externo').setInputFiles({ name: 'project.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
    await page.waitForFunction(() => document.querySelectorAll('[data-anchored-label]').length === 2 && document.querySelectorAll('[data-object-label]').length === 2 && Array.from(document.querySelectorAll('[data-label-fitted]')).every(el => (el as HTMLElement).dataset.labelFitted === 'true'));
    const result = await page.locator('[data-anchored-label]').evaluateAll(elements => elements.map(element => {
      const pill = element.firstElementChild as HTMLElement; const node = pill.firstChild!; const range = document.createRange();
      const lines: number[] = [];
      for (let i = 0; i < node.textContent!.length; i++) { range.setStart(node, i); range.setEnd(node, i + 1); lines.push(range.getBoundingClientRect().top); }
      const box = pill.getBoundingClientRect(); const parent = element.parentElement!.getBoundingClientRect();
      return { text: node.textContent!, lines, left: box.left - parent.left, right: box.right - parent.left, top: box.top - parent.top, bottom: box.bottom - parent.top, width: parent.width, height: parent.height };
    }));
    for (const word of result[0]!.text.matchAll(/salado/g)) assert.equal(new Set(result[0]!.lines.slice(word.index, word.index + 6)).size, 1);
    assert.ok(new Set(result[1]!.lines).size > 1, 'overlong word wraps');
    const objects = await page.locator('[data-object-label]').evaluateAll(elements => elements.map(element => {
      const r = element.getBoundingClientRect(); const p = element.parentElement!.getBoundingClientRect();
      return { left: r.left - p.left, top: r.top - p.top, right: r.right - p.left, bottom: r.bottom - p.top, width: p.width, height: p.height };
    }));
    for (const label of objects) assert.ok(label.left >= 0 && label.right <= label.width && label.top >= 0 && label.bottom <= label.height, JSON.stringify(label));
    assert.deepEqual(consoleErrors, []); assert.deepEqual(resourceErrors, []);
  }, 'chromium');
});

test('object labels retain projected dimensions and rotation while their rotated bounds clamp safely', async t => {
  const project = JSON.parse(await readFile(new URL('../../docs/plan/examples/kit/sal-del-mar-storyboard.json', import.meta.url), 'utf8'));
  project.scenes = [project.scenes[0]]; project.output.durationMs = project.scenes[0].durationMs;
  const visual = project.scenes[0].visual;
  visual.camera = { move: 'static', from: [0, 0, 10], to: [0, 0, 10], target: [0, 0, 0], easing: 'linear' };
  visual.particles = []; visual.overlays = []; visual.labels = [];
  const halfHeight = 10 * Math.tan(Math.PI / 8); const halfWidth = halfHeight * 9 / 16;
  const points = [[0, 0], [-0.99, 0.99], [0.99, 0.99], [-0.99, -0.99], [0.99, -0.99], [2, 0]];
  visual.objects = points.map(([x, y], i) => ({ id: `label-${i}`, type: 'label',
    params: { proportions: { width: 2, height: 0.5, depth: 0.1 }, text: i === 1 ? 'ဪ'.repeat(120) : 'Sal', color: '#273E46' },
    position: [x! * halfWidth, y! * halfHeight, 0], rotation: [0, 0, 0.4], scale: 1.5, color: '#273E46', animations: [] }));
  await withStudio(t, async ({ page }) => {
    await page.getByLabel('JSON externo').setInputFiles({ name: 'project.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
    await page.waitForFunction(() => document.querySelectorAll('[data-object-label]').length === 5 && Array.from(document.querySelectorAll('[data-object-label]')).every(el => (el as HTMLElement).dataset.labelFitted === 'true'));
    const result = await page.locator('[data-object-label]').evaluateAll(elements => elements.map(el => {
      const h = el as HTMLElement; const rect = h.getBoundingClientRect(); const parent = h.parentElement!.getBoundingClientRect(); const scale = parent.width / 1080;
      const range = document.createRange(); range.selectNodeContents(h.firstElementChild!); const textRect = range.getBoundingClientRect();
      return { width: parseFloat(h.style.width), height: parseFloat(h.style.height), rotation: h.style.rotate, fontSize: parseFloat(getComputedStyle(h.firstElementChild!).fontSize),
        left: (rect.left - parent.left) / scale, right: (rect.right - parent.left) / scale, top: (rect.top - parent.top) / scale, bottom: (rect.bottom - parent.top) / scale,
        rectWidth: rect.width / scale, rectHeight: rect.height / scale, text: h.textContent, textInside: textRect.left >= rect.left - 1 && textRect.right <= rect.right + 1 && textRect.top >= rect.top - 1 && textRect.bottom <= rect.bottom + 1 };
    }));
    for (const [i, r] of result.entries()) {
      const x = points[i]![0]! * halfWidth; const y = points[i]![1]! * halfHeight; const distance = Math.hypot(x, y, 10);
      const px = 1920 / (2 * Math.tan(Math.PI / 8) * distance);
      assert.ok(Math.abs(r.width - 3 * px) < 0.02 && Math.abs(r.height - 0.75 * px) < 0.02, JSON.stringify(r));
      assert.equal(r.rotation, '0.4rad');
      assert.ok(Math.abs(r.rectWidth - (r.width * Math.cos(0.4) + r.height * Math.sin(0.4))) < 0.2, JSON.stringify(r));
      assert.ok(Math.abs(r.rectHeight - (r.height * Math.cos(0.4) + r.width * Math.sin(0.4))) < 0.2, JSON.stringify(r));
      assert.ok(r.left >= 0 && r.right <= 1080 && r.top >= 0 && r.bottom <= 1920, JSON.stringify(r));
      assert.equal(r.text, i === 1 ? 'ဪ'.repeat(120) : 'Sal'); assert.equal(r.textInside, true);
    }
    const originalFontSize = Math.min(result[0]!.height * 0.6, result[0]!.width / (3 * 0.7 + 2));
    assert.ok(Math.abs(result[0]!.fontSize - originalFontSize) < 0.02, 'normal text retains its authored font size');
    assert.ok(Math.abs((result[0]!.left + result[0]!.right) / 2 - 540) < 0.2, 'unclamped anchor stays centered');
    assert.ok(Math.abs((result[0]!.top + result[0]!.bottom) / 2 - 960) < 0.2, 'unclamped anchor stays centered');
    const before = await page.locator('[data-object-label]').evaluateAll(elements => elements.map(el => `${el.getAttribute('style')}${el.firstElementChild!.getAttribute('style')}`));
    const bar = page.locator('.preview-transport div[style*="touch-action: none"]');
    const box = await bar.boundingBox(); assert.ok(box);
    await bar.click({ position: { x: box.width / 2, y: box.height / 2 } });
    await page.getByRole('button', { name: 'Ver escena 1', exact: true }).click();
    assert.deepEqual(await page.locator('[data-object-label]').evaluateAll(elements => elements.map(el => `${el.getAttribute('style')}${el.firstElementChild!.getAttribute('style')}`)), before);
  }, 'chromium');
});

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
