import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from 'playwright-core';
import { fixtureJson, fixtureText } from '../helpers/fixtures.ts';
import { withStudio } from '../helpers/studio-browser.ts';
import { validateProject } from '../../src/shared/schema/validate.ts';
import type { KitScene } from '../../src/shared/kit/types.ts';

async function snapshot(page: Page) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Descargar copia JSON', exact: true }).click();
  const download = await pending;
  assert.equal(await download.failure(), null);
  const value = JSON.parse(await readFile((await download.path())!, 'utf8'));
  delete value.updatedAt;
  return value;
}

test('scene palette, camera and labels update actual unsaved preview and persist only the selected scene; keyboard/mobile', async t => {
  await withStudio(t, async ({ page, root, consoleErrors, resourceErrors }) => {
    page.setDefaultTimeout(15000);
    await page.setViewportSize({ width: 1280, height: 1000 });
    const source = validateProject(fixtureJson('storyboard'));
    assert.ok(source.ok);
    const kit: KitScene = JSON.parse(await readFile('docs/plan/examples/kit/sal-del-mar.json', 'utf8'));
    source.project.scenes[0]!.visual = kit;
    await page.getByLabel('JSON externo').setInputFiles({ name: 'project.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(source.project)) });
    await page.locator('.scene-card').first().waitFor();
    const path = join(root, source.project.projectId, 'project.json');
    const originalBytes = await readFile(path);
    const before = await snapshot(page);
    const card = page.locator('.scene-card').first();
    const settings = card.locator('.scene-adjustments');
    const toggle = settings.getByRole('button', { name: 'Ajustes de escena', exact: true });
    await toggle.focus();
    await page.keyboard.press('Enter');
    assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
    await page.keyboard.press('Tab');
    assert.equal(await settings.getByLabel('Color de fondo', { exact: true }).evaluate(el => el === document.activeElement), true);
    const preview = page.getByRole('region', { name: 'Vista previa del borrador' });
    await preview.locator('canvas').waitFor();
    await preview.scrollIntoViewIfNeeded();
    await page.waitForTimeout(800);
    const initialImage = await preview.screenshot();
    await settings.getByLabel('Color de fondo', { exact: true }).fill('rojo');
    await settings.getByRole('alert').waitFor();
    assert.equal(await settings.getByLabel('Color de fondo', { exact: true }).inputValue(), 'rojo');
    assert.deepEqual(await snapshot(page), before, 'invalid color preserves entire draft');
    for (const [label, value] of [['Color de fondo', '#112233'], ['Cielo superior', '#FF4477'], ['Cielo inferior', '#FFCC88'], ['Color del terreno', '#7A3355'], ['Color del agua', '#22DD99']]) {
      await settings.getByLabel(label!, { exact: true }).fill(value!);
    }
    assert.equal(await settings.getByRole('alert').count(), 0);
    await preview.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    const coloredImage = await preview.screenshot();
    assert.notDeepEqual(coloredImage, initialImage, 'real rendered palette changes before saving');
    const colored = await snapshot(page);
    assert.equal(colored.scenes[0].visual.palette.background, '#112233');
    assert.equal(colored.scenes[0].visual.sky.top, '#FF4477');
    assert.equal(colored.scenes[0].visual.environment.terrain.color, '#7A3355');
    assert.equal(colored.scenes[0].visual.environment.water.color, '#22DD99');
    await settings.getByLabel('Movimiento de cámara', { exact: true }).selectOption('follow');
    await settings.getByRole('button', { name: 'Aplicar cámara', exact: true }).click();
    await settings.getByRole('alert').waitFor();
    assert.deepEqual(await snapshot(page), colored, 'follow without object cannot modify draft');
    await settings.getByLabel('Objeto de cámara', { exact: true }).selectOption('river-rock');
    await settings.getByRole('button', { name: 'Aplicar cámara', exact: true }).click();
    const followed = await snapshot(page);
    assert.equal(followed.scenes[0].visual.camera.move, 'follow');
    assert.equal(followed.scenes[0].visual.camera.targetObjectId, 'river-rock');
    assert.equal('target' in followed.scenes[0].visual.camera, false);
    // Return to the fixture's fixed target and stage a visible camera move.
    await settings.getByLabel('Objeto de cámara', { exact: true }).selectOption('');
    await settings.getByLabel('Movimiento de cámara', { exact: true }).selectOption('pan');
    await settings.getByLabel('Inicio de cámara X', { exact: true }).fill('9');
    await settings.getByLabel('Final de cámara X', { exact: true }).fill('7');
    await settings.getByRole('button', { name: 'Aplicar cámara', exact: true }).click();
    const moved = await snapshot(page);
    assert.equal(moved.scenes[0].visual.camera.move, 'pan');
    assert.deepEqual(moved.scenes[0].visual.camera.from, [9, 10, 21]);
    await preview.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    const cameraImage = await preview.screenshot();
    assert.notDeepEqual(cameraImage, coloredImage, 'real rendered camera changes before saving');
    await settings.getByLabel('Texto del rótulo 1', { exact: true }).fill('');
    await settings.getByRole('alert').waitFor();
    assert.deepEqual(await snapshot(page), moved, 'empty label cannot enter draft');
    await settings.getByLabel('Texto del rótulo 1', { exact: true }).fill('Minerales editados');
    await settings.getByLabel('Fondo del rótulo 1', { exact: true }).fill('#441133');
    await settings.getByLabel('Objeto del rótulo 2', { exact: true }).selectOption('bank-rock');
    await settings.getByRole('button', { name: 'Quitar rótulo 2', exact: true }).click();
    await settings.getByLabel('Objeto del nuevo rótulo', { exact: true }).selectOption('water-marker');
    await settings.getByLabel('Texto del nuevo rótulo', { exact: true }).fill('Agua renovada');
    await settings.getByRole('button', { name: 'Añadir rótulo', exact: true }).click();
    await preview.getByText('Minerales editados', { exact: true }).waitFor();
    await preview.getByText('Agua renovada', { exact: true }).waitFor();
    for (let index = 0; index < 4; index++) await settings.getByRole('button', { name: 'Añadir rótulo', exact: true }).click();
    assert.ok(await settings.getByRole('button', { name: 'Añadir rótulo', exact: true }).isDisabled());
    const adjusted = await snapshot(page);
    assert.equal(adjusted.scenes[0].visual.labels.length, 6);
    assert.equal(adjusted.scenes[0].visual.labels[1].color, '#172D45', 'new labels use a readable dark background with the renderer white text');
    assert.equal(adjusted.scenes[0].visual.labels[0].objectId, kit.labels[0]!.objectId);
    assert.deepEqual(adjusted.scenes[1], before.scenes[1], 'every other scene remains unchanged');
    assert.deepEqual(adjusted.scenes[0].visual.objects, before.scenes[0].visual.objects, 'no generated object identities');
    assert.deepEqual(await readFile(path), originalBytes, 'no implicit save');
    assert.ok(await page.getByRole('button', { name: 'Guarda antes de exportar', exact: true }).isDisabled());
    // Leave a useful, uncluttered final preview for desktop/mobile inspection.
    for (let index = 6; index > 2; index--) await settings.getByRole('button', { name: `Quitar rótulo ${index}`, exact: true }).click();
    const finalDraft = await snapshot(page);
    if (process.env.ADJUST_SCREENSHOT_DIR) {
      await mkdir(process.env.ADJUST_SCREENSHOT_DIR, { recursive: true });
      await preview.screenshot({ path: join(process.env.ADJUST_SCREENSHOT_DIR, 'adjust-preview-desktop.png') });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await settings.getByLabel('Color de fondo', { exact: true }).fill('#223344');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    if (process.env.ADJUST_SCREENSHOT_DIR) {
      await settings.screenshot({ path: join(process.env.ADJUST_SCREENSHOT_DIR, 'adjust-controls-mobile.png') });
      await preview.screenshot({ path: join(process.env.ADJUST_SCREENSHOT_DIR, 'adjust-preview-mobile.png') });
    }
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await page.getByText(/Guardado · rev\./).waitFor();
    const saved = JSON.parse(await readFile(path, 'utf8'));
    assert.deepEqual(saved.scenes[1], before.scenes[1]);
    assert.deepEqual(saved.scenes[0].visual, { ...finalDraft.scenes[0].visual, palette: { ...finalDraft.scenes[0].visual.palette, background: '#223344' } });
    await page.getByRole('button', { name: 'Proyectos', exact: true }).click();
    await page.getByRole('button', { name: 'Abrir', exact: true }).click();
    await card.getByRole('button', { name: 'Ajustes de escena', exact: true }).click();
    assert.equal(await settings.getByLabel('Color de fondo', { exact: true }).inputValue(), '#223344');
    assert.equal(await settings.getByLabel('Movimiento de cámara', { exact: true }).inputValue(), 'pan');
    assert.equal(await settings.getByLabel('Texto del rótulo 1', { exact: true }).inputValue(), 'Minerales editados');
    const reopened = await snapshot(page);
    assert.deepEqual(reopened.scenes, saved.scenes);
    assert.deepEqual(consoleErrors, []);
    assert.deepEqual(resourceErrors, []);
  }, 'chromium');
});

test('historical camera is locked until explicit conversion; read-only adjustments stay disabled', async t => {
  await withStudio(t, async ({ page, consoleErrors, resourceErrors }) => {
    page.setDefaultTimeout(15000);
    await page.getByLabel('JSON externo').setInputFiles({ name: 'project.json', mimeType: 'application/json', buffer: Buffer.from(fixtureText('storyboard')) });
    const before = await snapshot(page);
    const card = page.locator('.scene-card').first();
    await card.getByRole('button', { name: 'Ajustes de escena', exact: true }).click();
    const settings = card.locator('.scene-adjustments');
    assert.ok(await settings.getByLabel('Movimiento de cámara', { exact: true }).isDisabled());
    await settings.getByLabel('Cielo superior', { exact: true }).fill('#667788');
    const colored = await snapshot(page);
    assert.deepEqual(colored.scenes[0].visual.camera, before.scenes[0].visual.camera);
    await settings.getByLabel(/Sustituir pista histórica/).check();
    await settings.getByLabel('Movimiento de cámara', { exact: true }).selectOption('orbit');
    assert.deepEqual(await snapshot(page), colored, 'staging conversion does not erase historical keyframes');
    await settings.getByRole('button', { name: 'Aplicar cámara', exact: true }).click();
    const converted = await snapshot(page);
    assert.equal(converted.scenes[0].visual.camera.move, 'orbit');
    assert.equal('keyframes' in converted.scenes[0].visual.camera, false);
    assert.deepEqual(converted.scenes[1], before.scenes[1]);
    await page.getByRole('button', { name: 'Proyectos', exact: true }).click();
    await page.getByRole('button', { name: 'Descartar cambios y continuar', exact: true }).click();
    const unknown = fixtureJson('storyboard') as any;
    unknown.projectId = 'project_readonly'; unknown.styleId = 'unknown-style';
    await page.getByLabel('JSON externo').setInputFiles({ name: 'readonly.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(unknown)) });
    await page.getByText(/Solo lectura:/).waitFor();
    // Opaque unsupported-style visuals are not reinterpreted as editable kit data.
    assert.equal(await page.locator('.scene-adjustments input:enabled').count(), 0);
    assert.deepEqual(consoleErrors, []);
    assert.deepEqual(resourceErrors, []);
  }, 'chromium');
});
