import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from 'playwright-core';
import { fixtureText } from '../helpers/fixtures.ts';
import { withStudio } from '../helpers/studio-browser.ts';
import { ModelLibrary } from '../../src/companion/store/model-library.ts';
import { canonicalize } from '../../src/shared/canonical.ts';
import { sha256Sync } from '../../src/shared/models/sha256-sync.ts';

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

test('manual drawing finds a relevant model after the first catalog page', async t => {
  await withStudio(t, async ({ page, root }) => {
    page.setDefaultTimeout(15000);
    const part = { shape: 'sphere', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], color: '#ffffff' };
    const fillers = Array.from({ length: 64 }, (_, i) => ({ version: 1, name: `Other ${i}`, semanticId: `other-${i}`, parts: [part] }));
    const max = fillers.map(model => sha256Sync(canonicalize(model))).sort().at(-1)!;
    let target = { version: 1, name: 'Personaje 0', semanticId: 'personaje-0', parts: [part] };
    for (let i = 1; sha256Sync(canonicalize(target)) <= max; i++) target = { ...target, name: `Personaje ${i}`, semanticId: `personaje-${i}` };
    const library = new ModelLibrary(root);
    await library.putMany(fillers);
    const id = await library.put(target);
    await page.getByLabel('JSON externo').setInputFiles({ name: 'project.json', mimeType: 'application/json', buffer: Buffer.from(fixtureText('storyboard')) });
    const before = await snapshot(page);
    // Match against the current scene's words, not an arbitrary URL query.
    const matching = before.scenes[0].title + ' ' + before.scenes[0].text + ' ' + before.scenes[0].visualIntent;
    assert.match(matching.toLowerCase(), /personaje/);
    const card = page.locator('.scene-card').first();
    await card.locator('summary').click();
    const scene = structuredClone(before.scenes[0].visual);
    scene.objects.push({ id: 'reuse-model', type: 'model', params: { modelId: id }, position: [0, 0, 0], rotation: [0, 0, 0], scale: 1, color: '#ffffff', animations: [] });
    await card.getByLabel('Pegar escena').fill(JSON.stringify({ scene, models: [] }));
    await card.getByRole('button', { name: 'Revisar', exact: true }).click();
    await card.getByRole('region', { name: 'Revisión del dibujo' }).getByText(`${target.name} · ${target.semanticId}`).waitFor();
    await card.getByRole('button', { name: 'Aplicar al borrador', exact: true }).click();
    await card.getByText(/Aplicado al borrador/).waitFor();
    assert.equal((await snapshot(page)).models[0].id, id);
  }, 'chromium');
});

test('manual review uses the catalog advertised in the copied prompt', async t => {
  await withStudio(t, async ({ page, root }) => {
    page.setDefaultTimeout(15000);
    const part = { shape: 'sphere', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], color: '#ffffff' };
    const library = new ModelLibrary(root);
    const models = Array.from({ length: 64 }, (_, i) => ({ version: 1, name: `Other ${i}`, semanticId: `other-${i}`, parts: [part] }));
    await library.putMany(models);
    await page.getByLabel('JSON externo').setInputFiles({ name: 'project.json', mimeType: 'application/json', buffer: Buffer.from(fixtureText('storyboard')) });
    const before = await snapshot(page);
    const selected = (await library.list()).at(-1)!;
    const card = page.locator('.scene-card').first();
    await card.locator('summary').click();
    await card.getByRole('button', { name: 'Copiar prompt de dibujo' }).click();
    await card.getByText(/Prompt copiado|No se pudo acceder al portapapeles/).waitFor();
    await library.put({ version: 1, name: 'Personaje', semanticId: 'personaje', parts: [part] });
    const scene = structuredClone(before.scenes[0].visual);
    scene.objects.push({ id: 'reuse-model', type: 'model', params: { modelId: selected.id }, position: [0, 0, 0], rotation: [0, 0, 0], scale: 1, color: '#ffffff', animations: [] });
    await card.getByLabel('Pegar escena').fill(JSON.stringify({ scene, models: [] }));
    await card.getByRole('button', { name: 'Revisar', exact: true }).click();
    await card.getByRole('region', { name: 'Revisión del dibujo' }).getByText(`${selected.model.name} · ${selected.model.semanticId}`).waitFor();
    await card.getByRole('button', { name: 'Aplicar al borrador' }).click();
    await card.getByText(/Aplicado al borrador/).waitFor();
    assert.equal((await snapshot(page)).models[0].id, selected.id);
  }, 'chromium');
});

test('catalog changes retry once and repeated changes report an error', async t => {
  await withStudio(t, async ({ page, root }) => {
    page.setDefaultTimeout(15000);
    const part = { shape: 'sphere', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], color: '#ffffff' };
    const library = new ModelLibrary(root);
    const model = (i: number) => ({ version: 1, name: `Other ${i}`, semanticId: `other-${i}`, parts: [part] });
    await library.putMany(Array.from({ length: 64 }, (_, i) => model(i)));
    await library.put(model(64));
    await page.getByLabel('JSON externo').setInputFiles({ name: 'project.json', mimeType: 'application/json', buffer: Buffer.from(fixtureText('storyboard')) });
    const card = page.locator('.scene-card').first();
    await card.locator('summary').click();
    let insertions = 0;
    let limit = 1;
    await page.route('**/api/models?*', async route => {
      if (new URL(route.request().url()).searchParams.get('offset') === '64' && insertions < limit) await library.put(model(100 + insertions++));
      await route.continue();
    });
    await card.getByRole('button', { name: 'Copiar prompt de dibujo' }).click();
    await card.getByText(/Prompt copiado|No se pudo acceder al portapapeles/).waitFor();
    assert.equal(insertions, 1);
    limit = 3;
    await card.getByRole('button', { name: 'Copiar prompt de dibujo' }).click();
    await card.getByRole('alert').getByText(/cambió varias veces/).waitFor();
    assert.equal(insertions, 3);
  }, 'chromium');
});

test('manual copied catalog is invalid after a draft edit', async t => {
  await withStudio(t, async ({ page }) => {
    page.setDefaultTimeout(15000);
    await page.getByLabel('JSON externo').setInputFiles({ name: 'project.json', mimeType: 'application/json', buffer: Buffer.from(fixtureText('storyboard')) });
    const before = await snapshot(page);
    const card = page.locator('.scene-card').first();
    await card.locator('summary').click();
    await card.getByRole('button', { name: 'Copiar prompt de dibujo' }).click();
    await card.getByText(/Prompt copiado|No se pudo acceder al portapapeles/).waitFor();
    await page.getByLabel('Idea').fill('Cambio posterior');
    await card.getByLabel('Pegar escena').fill(JSON.stringify({ scene: before.scenes[0].visual, models: [] }));
    await card.getByRole('button', { name: 'Revisar', exact: true }).click();
    await card.getByRole('alert').getByText(/borrador cambió desde que copiaste el prompt/).waitFor();
    assert.equal(await card.getByRole('region', { name: 'Revisión del dibujo' }).count(), 0);
  }, 'chromium');
});

test('plain drawing response requires the copied prompt draft until a fresh copy', async t => {
  await withStudio(t, async ({ page }) => {
    page.setDefaultTimeout(15000);
    await page.getByLabel('JSON externo').setInputFiles({ name: 'project.json', mimeType: 'application/json', buffer: Buffer.from(fixtureText('storyboard')) });
    const before = await snapshot(page);
    const card = page.locator('.scene-card').first();
    await card.locator('summary').click();
    await card.getByRole('button', { name: 'Copiar prompt de dibujo' }).click();
    await card.getByText(/Prompt copiado|No se pudo acceder al portapapeles/).waitFor();
    await card.getByLabel('Intención visual').fill('Nueva intención visual');
    const edited = await snapshot(page);
    const scene = structuredClone(before.scenes[0].visual);
    for (const response of [scene, { scene, models: [] }]) {
      await card.getByLabel('Pegar escena').fill(JSON.stringify(response));
      await card.getByRole('button', { name: 'Revisar', exact: true }).click();
      await card.getByRole('alert').getByText(/borrador cambió desde que copiaste el prompt/).waitFor();
      assert.equal(await card.getByRole('region', { name: 'Revisión del dibujo' }).count(), 0);
      assert.deepEqual(await snapshot(page), edited);
    }
    await card.getByRole('button', { name: 'Copiar prompt de dibujo' }).click();
    await card.getByText(/Prompt copiado|No se pudo acceder al portapapeles/).waitFor();
    await card.getByLabel('Pegar escena').fill(JSON.stringify(scene));
    await card.getByRole('button', { name: 'Revisar', exact: true }).click();
    await card.getByRole('region', { name: 'Revisión del dibujo' }).waitFor();
    await card.getByRole('button', { name: 'Aplicar al borrador' }).click();
    await card.getByText(/Aplicado al borrador/).waitFor();
    assert.equal((await snapshot(page)).scenes[0].visualIntent, 'Nueva intención visual');
  }, 'chromium');
});

test('manual model bundle review publishes only on apply and preserves the draft on publication failure', async t => {
  await withStudio(t, async ({ page, root }) => {
    page.setDefaultTimeout(15000);
    await page.getByLabel('JSON externo').setInputFiles({ name: 'project.json', mimeType: 'application/json', buffer: Buffer.from(fixtureText('storyboard')) });
    const before = await snapshot(page);
    const card = page.locator('.scene-card').first();
    await card.locator('summary').click();
    const scene = structuredClone(before.scenes[0].visual);
    scene.objects.push({ id: 'farol', type: 'model', params: { modelId: 'new-farol' }, position: [0, 0, 0], rotation: [0, 0, 0], scale: 1, color: '#ffffff', animations: [] });
    const model = { version: 1, name: 'Farol', semanticId: 'farol', parts: [{ shape: 'sphere', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], color: '#ffffff' }] };
    await card.getByLabel('Pegar escena').fill(`Respuesta:\n\`\`\`json\n${JSON.stringify({ scene, models: [{ alias: 'new-farol', model }] })}\n\`\`\``);
    await card.getByRole('button', { name: 'Revisar', exact: true }).click();
    await card.getByRole('region', { name: 'Revisión del dibujo' }).getByText('Farol · farol').waitFor();
    await assert.rejects(readFile(join(root, '.models')), { code: 'ENOENT' });
    assert.deepEqual(await snapshot(page), before);
    await page.route('**/api/models/resolve', route => route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"message":"Error de prueba"}}' }));
    await card.getByRole('button', { name: 'Aplicar al borrador', exact: true }).click();
    await card.getByRole('alert').waitFor();
    assert.deepEqual(await snapshot(page), before);
    await page.unroute('**/api/models/resolve');
    await card.getByRole('button', { name: 'Aplicar al borrador', exact: true }).click();
    await card.getByText(/Aplicado al borrador/).waitFor();
    const after = await snapshot(page);
    assert.equal(after.models[0].model.name, 'Farol');
    assert.equal(after.scenes[0].visual.objects.at(-1).params.modelId, after.models[0].id);
    assert.ok((await readFile(join(root, '.models'), 'utf8')).includes('farol'));
  }, 'chromium');
});

test('manual model publication never overwrites edits made while publishing', async t => {
  await withStudio(t, async ({ page }) => {
    page.setDefaultTimeout(15000);
    await page.getByLabel('JSON externo').setInputFiles({ name: 'project.json', mimeType: 'application/json', buffer: Buffer.from(fixtureText('storyboard')) });
    const before = await snapshot(page);
    const card = page.locator('.scene-card').first();
    await card.locator('summary').click();
    const scene = structuredClone(before.scenes[0].visual);
    scene.objects.push({ id: 'farol', type: 'model', params: { modelId: 'new-farol' }, position: [0, 0, 0], rotation: [0, 0, 0], scale: 1, color: '#ffffff', animations: [] });
    const model = { version: 1, name: 'Farol', semanticId: 'farol', parts: [{ shape: 'sphere', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], color: '#ffffff' }] };
    await card.getByLabel('Pegar escena').fill(JSON.stringify({ scene, models: [{ alias: 'new-farol', model }] }));
    await card.getByRole('button', { name: 'Revisar', exact: true }).click();
    await card.getByRole('region', { name: 'Revisión del dibujo' }).waitFor();
    let release!: () => void;
    let reached!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    const requested = new Promise<void>(resolve => { reached = resolve; });
    await page.route('**/api/models/resolve', async route => { reached(); await barrier; await route.continue(); });
    await card.getByRole('button', { name: 'Aplicar al borrador', exact: true }).click();
    await requested;
    await page.getByLabel('Idea').fill('Edición concurrente');
    release();
    await card.getByRole('alert').getByText(/El borrador cambió desde la revisión/).waitFor();
    const after = await snapshot(page);
    assert.equal(after.idea, 'Edición concurrente');
    assert.deepEqual(after.scenes, before.scenes);
    assert.equal(after.models, undefined);
  }, 'chromium');
});

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
    await first.getByRole('button', { name: 'Copiar prompt de dibujo', exact: true }).click();
    await first.getByText(/Prompt copiado/).waitFor();
    await first.getByLabel('Pegar escena', { exact: true }).fill(JSON.stringify(kit));
    await first.getByRole('button', { name: 'Revisar', exact: true }).click();
    await first.getByRole('region', { name: 'Revisión del dibujo' }).waitFor();
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
    await first.getByRole('button', { name: 'Copiar prompt de dibujo', exact: true }).click();
    await first.getByText(/Prompt copiado/).waitFor();
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
