import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { withStudio } from '../helpers/studio-browser.ts';
import { fixtureText } from '../helpers/fixtures.ts';
import { toneWav } from '../helpers/playable-audio.ts';

test('workflow: empty project keeps pending steps accessible without requiring voice', async t => {
  await withStudio(t, async ({ page, consoleErrors, resourceErrors }) => {
    await page.getByLabel('Nombre', { exact: true }).fill('Flujo vacío');
    await page.getByRole('button', { name: 'Nuevo proyecto', exact: true }).click();
    const steps = page.getByRole('navigation', { name: 'Flujo de creación' }).getByRole('button');
    await steps.first().getByText('Pendiente', { exact: true }).waitFor();
    assert.match(await steps.nth(1).innerText(), /Pendiente/);
    assert.match(await steps.nth(2).innerText(), /Listo · Opcional en modo silencioso/);
    assert.match(await steps.nth(3).innerText(), /Pendiente/);
    for (let index = 0; index < 4; index++) {
      await steps.nth(index).click();
      assert.equal(await page.evaluate(() => document.activeElement?.id), `workflow-${['idea', 'script', 'voice', 'preview'][index]}`);
    }
    assert.equal(await page.getByLabel('Idea').count(), 1, 'section naming preserves the existing input label');
    await page.getByLabel('Idea').fill('Una idea para el video');
    await steps.first().getByText('Listo', { exact: true }).waitFor();
    assert.match(await steps.nth(1).innerText(), /Pendiente/);
    assert.deepEqual(consoleErrors, []);
    assert.deepEqual(resourceErrors, []);
  }, 'chromium');
});

test('workflow: keyboard navigation, silent readiness, desktop/mobile and saved stale voice in Chromium', async t => {
  await withStudio(t, async ({ page, root, consoleErrors, resourceErrors }) => {
    page.setDefaultTimeout(15000);
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.getByLabel('JSON externo').setInputFiles({ name: 'project.json', mimeType: 'application/json', buffer: Buffer.from(fixtureText('storyboard')) });
    const nav = page.getByRole('navigation', { name: 'Flujo de creación' });
    const steps = nav.getByRole('button');
    await steps.nth(3).getByText('Listo', { exact: true }).waitFor();
    assert.match(await steps.nth(2).innerText(), /Listo · Opcional en modo silencioso/);
    const before = await readFile(join(root, JSON.parse(fixtureText('storyboard')).projectId, 'project.json'));
    for (const [index, id] of ['idea', 'script', 'voice', 'preview'].entries()) {
      assert.ok(await steps.nth(index).isEnabled());
      await steps.nth(index).focus();
      await page.keyboard.press('Enter');
      assert.equal(await page.evaluate(() => document.activeElement?.id), `workflow-${id}`);
      assert.equal(await steps.nth(index).getAttribute('aria-current'), 'step');
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.activeElement?.tagName), ['TEXTAREA', 'SELECT', 'BUTTON', 'BUTTON'][index]);
    }
    // Sequential tab order in the top bar, not a tab widget hiding editor controls.
    await steps.first().focus();
    await page.keyboard.press('Tab');
    assert.equal(await steps.nth(1).evaluate(node => node === document.activeElement), true);
    await nav.scrollIntoViewIfNeeded();
    if (process.env.WORKFLOW_SCREENSHOT_DIR) await nav.screenshot({ path: join(process.env.WORKFLOW_SCREENSHOT_DIR, 'workflow-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    for (let index = 0; index < 4; index++) {
      await steps.nth(index).click();
      const target = page.locator(`#workflow-${['idea', 'script', 'voice', 'preview'][index]}`);
      assert.ok(await target.isVisible());
      assert.equal(await page.evaluate(() => document.activeElement?.id), await target.getAttribute('id'));
    }
    await nav.scrollIntoViewIfNeeded();
    if (process.env.WORKFLOW_SCREENSHOT_DIR) await nav.screenshot({ path: join(process.env.WORKFLOW_SCREENSHOT_DIR, 'workflow-mobile.png') });
    assert.deepEqual(await readFile(join(root, JSON.parse(fixtureText('storyboard')).projectId, 'project.json')), before, 'navigation does not save');
    const voice = page.getByRole('region', { name: 'Voz manual', exact: true });
    await voice.getByLabel('Licencia o permiso de uso del audio').fill('Señal propia para prueba');
    for (const index of [1, 2]) {
      await voice.getByLabel(`Subir audio · escena ${index}`).setInputFiles({ name: 'tone.wav', mimeType: 'audio/wav', buffer: toneWav() });
      await voice.getByText(new RegExp(`${index}\\..*lista`)).waitFor();
    }
    await steps.nth(2).getByText('Listo', { exact: true }).waitFor();
    await page.getByLabel('Texto').first().fill('Ahora esta escena tiene un texto diferente.');
    await steps.nth(2).getByText('Desactualizado', { exact: true }).waitFor();
    await steps.nth(3).getByText('Desactualizado', { exact: true }).waitFor();
    assert.match(await steps.nth(0).innerText(), /Listo/);
    assert.match(await steps.nth(1).innerText(), /Listo/);
    await nav.getByText('Estado del borrador sin guardar.', { exact: false }).waitFor();
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await page.getByText(/Guardado · rev\./).waitFor();
    await page.getByRole('button', { name: 'Proyectos', exact: true }).click();
    await page.getByRole('button', { name: 'Abrir', exact: true }).click();
    await steps.nth(2).getByText('Desactualizado', { exact: true }).waitFor();
    await steps.nth(3).getByText('Desactualizado', { exact: true }).waitFor();
    await voice.getByText(/1\..*desactualizada/).waitFor();
    await voice.getByText(/2\..*lista/).waitFor();
    await nav.getByText('Estado del proyecto guardado.', { exact: false }).waitFor();
    // No new gating or export confirmation from the future step 5.2.
    assert.ok(await page.getByRole('button', { name: 'Exportar MP4', exact: true }).isEnabled());
    assert.deepEqual(consoleErrors, []);
    assert.deepEqual(resourceErrors, []);
  }, 'chromium');
});
