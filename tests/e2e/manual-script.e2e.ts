import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from 'playwright-core';
import { fixtureText } from '../helpers/fixtures.ts';
import { withStudio } from '../helpers/studio-browser.ts';

// Local external-response fixture: no provider, login or claim of real ChatGPT use.
const proposal = {
  title: 'La sal del mar', sources: [{ title: 'Referencia de prueba', url: 'https://example.org/sal' }],
  cover: { headline: 'El viaje de la sal' }, postText: 'Comparte este viaje.',
  scenes: [
    { title: 'Río', narration: 'El agua lleva sal.', visualIntent: 'Una roca junto al río', seconds: 5 },
    { title: 'Mar', narration: 'La sal llega al mar.', visualIntent: 'La misma roca frente al mar', seconds: 5 },
  ],
};

async function snapshot(page: Page) {
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Descargar copia JSON', exact: true }).click();
  const download = await event;
  assert.equal(await download.failure(), null);
  const result = JSON.parse(await readFile((await download.path())!, 'utf8'));
  // Download snapshots intentionally receive a fresh timestamp, not a canonical save.
  delete result.updatedAt;
  return result;
}

test('manual script and drawings: review, confirmation, isolation, unsaved 3D/captions and mobile in Chromium', async t => {
  await withStudio(t, async ({ page, root, consoleErrors, resourceErrors }) => {
    page.setDefaultTimeout(15000);
    await page.setViewportSize({ width: 1280, height: 1400 });
    await page.getByLabel('JSON externo').setInputFiles({ name: 'project.json', mimeType: 'application/json', buffer: Buffer.from(fixtureText('storyboard')) });
    await page.getByRole('region', { name: 'Guion manual', exact: true }).waitFor();
    const id = JSON.parse(fixtureText('storyboard')).projectId;
    const path = join(root, id, 'project.json');
    const original = await readFile(path);
    await page.getByLabel('Idea').fill('¿De dónde sale la sal del mar?');
    const script = page.getByRole('region', { name: 'Guion manual', exact: true });
    assert.deepEqual(await script.getByLabel('Duración objetivo').locator('option').allTextContents(), ['15 s', '30 s', '45 s', '60 s']);
    await script.getByLabel('Duración objetivo').selectOption('15');
    // Deterministic clipboard boundary, retaining the real click/prompt-building path.
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
        writeText: async (text: string) => { Object.assign(globalThis, { copiedPrompt: text }); },
      } });
    });
    await script.getByRole('button', { name: 'Copiar prompt', exact: true }).click();
    await script.getByText(/Prompt copiado/).waitFor();
    const prompt = await page.evaluate(() => (globalThis as any).copiedPrompt as string);
    assert.match(prompt, /Duración objetivo: 15 s/);
    assert.match(prompt, /¿De dónde sale la sal del mar/);
    assert.match(prompt, /additionalProperties/);
    const before = await snapshot(page);
    await script.getByLabel('Pegar respuesta', { exact: true }).fill('{"title":"incompleto"}');
    await script.getByRole('button', { name: 'Revisar', exact: true }).click();
    await script.getByRole('alert').waitFor();
    assert.equal(await script.getByRole('button', { name: 'Aplicar al borrador', exact: true }).count(), 0);
    assert.deepEqual(await snapshot(page), before, 'invalid script leaves entire draft unchanged');
    await script.getByLabel('Pegar respuesta', { exact: true }).fill(`Respuesta:\n\`\`\`json\n${JSON.stringify(proposal)}\n\`\`\``);
    await script.getByRole('button', { name: 'Revisar', exact: true }).click();
    await script.getByRole('region', { name: 'Revisión del guion' }).waitFor();
    assert.deepEqual(await snapshot(page), before, 'review does not apply');
    const dismiss = page.waitForEvent('dialog').then(async dialog => {
      assert.match(dialog.message(), /^Reemplazar 2 escenas/); await dialog.dismiss();
    });
    await script.getByRole('button', { name: 'Aplicar al borrador', exact: true }).click();
    await dismiss;
    assert.deepEqual(await snapshot(page), before, 'replacement cancellation preserves draft');
    const accept = page.waitForEvent('dialog').then(dialog => dialog.accept());
    await script.getByRole('button', { name: 'Aplicar al borrador', exact: true }).click();
    await accept;
    await script.getByText(/Aplicado al borrador/).waitFor();
    const scripted = await snapshot(page);
    assert.equal(scripted.title, proposal.title);
    assert.equal(scripted.output.durationMs, 10000);
    assert.deepEqual(scripted.cover, proposal.cover);
    assert.ok(scripted.scenes.every((scene: any) => scene.visual === null && scene.audio === null && scene.words.length === 0));
    assert.ok(scripted.scenes.every((scene: any) => !before.scenes.some((old: any) => old.sceneId === scene.sceneId)));
    const preview = page.getByRole('region', { name: 'Vista previa del borrador' });
    await preview.locator('[data-caption-word="El"]').waitFor();
    const kit = JSON.parse(await readFile('docs/plan/examples/kit/sal-del-mar.json', 'utf8'));
    const cards = page.locator('.scene-card');
    for (const index of [0, 1]) {
      const card = cards.nth(index);
      await card.locator('summary').click();
      await card.getByRole('button', { name: 'Copiar prompt de dibujo', exact: true }).click();
      await card.getByText(/Prompt copiado/).waitFor();
      const drawingPrompt = await page.evaluate(() => (globalThis as any).copiedPrompt as string);
      assert.match(drawingPrompt, /Dibuja una sola escena KitScene/);
      if (index === 1) assert.ok(drawingPrompt.includes(JSON.stringify(kit.objects[0])), 'previous objects passed with full identity');
      await card.getByLabel('Pegar escena', { exact: true }).fill(JSON.stringify(kit));
      await card.getByRole('button', { name: 'Revisar', exact: true }).click();
      await card.getByRole('region', { name: 'Revisión del dibujo' }).waitFor();
      await card.getByRole('button', { name: 'Aplicar al borrador', exact: true }).click();
      await card.getByText(/Aplicado al borrador/).waitFor();
    }
    await preview.locator('canvas').waitFor();
    await page.getByRole('button', { name: 'Ver escena 1', exact: true }).click();
    await preview.locator('[data-caption-word="El"]').waitFor();
    const drawn = await snapshot(page);
    assert.deepEqual(drawn.scenes[0].visual, kit);
    assert.deepEqual(drawn.scenes[1].visual, kit);
    // Changing a reviewed response invalidates Apply, rather than applying stale JSON.
    const first = cards.first();
    await first.getByLabel('Pegar escena', { exact: true }).fill(JSON.stringify(kit));
    await first.getByRole('button', { name: 'Revisar', exact: true }).click();
    await first.getByLabel('Pegar escena', { exact: true }).fill('{"kind":"code"}');
    assert.equal(await first.getByRole('button', { name: 'Aplicar al borrador', exact: true }).count(), 0);
    await first.getByRole('button', { name: 'Revisar', exact: true }).click();
    await first.getByRole('alert').waitFor();
    assert.deepEqual(await snapshot(page), drawn, 'invalid drawing leaves full draft unchanged');
    const redrawn = structuredClone(kit);
    redrawn.palette.background = '#112233';
    await first.getByLabel('Pegar escena', { exact: true }).fill(JSON.stringify(redrawn));
    await first.getByRole('button', { name: 'Revisar', exact: true }).click();
    await first.getByRole('button', { name: 'Aplicar al borrador', exact: true }).click();
    const after = await snapshot(page);
    assert.deepEqual(after.scenes[1], drawn.scenes[1], 'redrawing preserves other scene byte-for-byte');
    assert.deepEqual(after.scenes[0], { ...drawn.scenes[0], revision: drawn.scenes[0].revision + 1, visual: redrawn });
    assert.deepEqual(await readFile(path), original, 'generation never saves');
    await page.getByText('Cambios sin guardar', { exact: true }).waitFor();
    assert.ok(await page.getByRole('button', { name: 'Guarda antes de exportar' }).isDisabled());
    await preview.scrollIntoViewIfNeeded();
    await page.waitForFunction(() => document.fonts.check('800 48px "Molecula Montserrat"'));
    await page.waitForTimeout(800);
    if (process.env.MANUAL_SCREENSHOT_DIR) await preview.screenshot({ path: join(process.env.MANUAL_SCREENSHOT_DIR, 'manual-preview-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await first.getByLabel('Pegar escena', { exact: true }).fill(JSON.stringify(kit));
    await first.getByRole('button', { name: 'Revisar', exact: true }).click();
    await first.getByRole('button', { name: 'Aplicar al borrador', exact: true }).click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    if (process.env.MANUAL_SCREENSHOT_DIR) {
      await first.screenshot({ path: join(process.env.MANUAL_SCREENSHOT_DIR, 'manual-drawing-mobile.png') });
      await preview.screenshot({ path: join(process.env.MANUAL_SCREENSHOT_DIR, 'manual-preview-mobile.png') });
    }
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await page.getByText(/Guardado · rev\./).waitFor();
    await page.getByRole('button', { name: 'Proyectos', exact: true }).click();
    await page.getByRole('button', { name: 'Abrir', exact: true }).click();
    const saved = JSON.parse(await readFile(path, 'utf8'));
    assert.deepEqual(saved.scenes.map((scene: any) => scene.visual), [kit, kit]);
    assert.deepEqual(consoleErrors, []);
    assert.deepEqual(resourceErrors, []);
  }, 'chromium');
});

test('manual script: clipboard fallback, apply validation failure, review invalidation and empty-scene application', async t => {
  await withStudio(t, async ({ page, consoleErrors, resourceErrors }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByLabel('Nombre', { exact: true }).fill('Manual');
    await page.getByRole('button', { name: 'Nuevo proyecto', exact: true }).click();
    const script = page.getByRole('region', { name: 'Guion manual', exact: true });
    await script.getByRole('button', { name: 'Copiar prompt', exact: true }).click();
    await script.getByRole('alert').waitFor();
    await page.getByLabel('Idea').fill('El viaje de la sal');
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async () => { throw new Error('denied'); },
    } }));
    await script.getByRole('button', { name: 'Copiar prompt', exact: true }).click();
    assert.match(await script.getByLabel('Prompt para copiar').inputValue(), /El viaje de la sal/);
    const before = await snapshot(page);
    const overflow = { ...proposal, scenes: [10.051, 10.051, 10.051, 10.051, 10.051, 9.745].map(seconds => ({ ...proposal.scenes[0], seconds })) };
    await script.getByLabel('Pegar respuesta', { exact: true }).fill(JSON.stringify(overflow));
    await script.getByRole('button', { name: 'Revisar', exact: true }).click();
    await script.getByRole('button', { name: 'Aplicar al borrador', exact: true }).click();
    await script.getByRole('alert').getByText(/duración redondeada supera/).waitFor();
    assert.deepEqual(await snapshot(page), before, 'apply failure preserves draft');
    await script.getByLabel('Pegar respuesta', { exact: true }).fill(JSON.stringify(proposal));
    assert.equal(await script.getByRole('button', { name: 'Aplicar al borrador', exact: true }).count(), 0);
    await script.getByRole('button', { name: 'Revisar', exact: true }).click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    if (process.env.MANUAL_SCREENSHOT_DIR) await script.screenshot({ path: join(process.env.MANUAL_SCREENSHOT_DIR, 'manual-script-mobile.png') });
    await script.getByRole('button', { name: 'Aplicar al borrador', exact: true }).click();
    await script.getByText(/Aplicado al borrador/).waitFor();
    assert.equal((await snapshot(page)).scenes.length, 2);
    assert.deepEqual(consoleErrors, []);
    assert.deepEqual(resourceErrors, []);
  }, 'chromium');
});

test('manual generation is disabled for read-only imported projects', async t => {
  await withStudio(t, async ({ page, root, consoleErrors, resourceErrors }) => {
    const source = JSON.parse(fixtureText('storyboard'));
    source.styleId = 'unknown-style';
    await page.getByLabel('JSON externo').setInputFiles({ name: 'project.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(source)) });
    await page.getByText(/Solo lectura:/).waitFor();
    const script = page.getByRole('region', { name: 'Guion manual', exact: true });
    assert.ok(await script.getByLabel('Duración objetivo').isDisabled());
    assert.ok(await script.getByLabel('Pegar respuesta', { exact: true }).isDisabled());
    assert.ok(await script.getByRole('button', { name: 'Copiar prompt', exact: true }).isDisabled());
    const card = page.locator('.scene-card').first();
    await card.locator('summary').click();
    assert.ok(await card.getByRole('button', { name: 'Copiar prompt de dibujo', exact: true }).isDisabled());
    assert.ok(await card.getByLabel('Pegar escena', { exact: true }).isDisabled());
    assert.equal(JSON.parse(await readFile(join(root, source.projectId, 'project.json'), 'utf8')).styleId, source.styleId);
    assert.deepEqual(consoleErrors, []);
    assert.deepEqual(resourceErrors, []);
  });
});
