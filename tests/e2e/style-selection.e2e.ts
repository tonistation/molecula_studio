import test from 'node:test';
import assert from 'node:assert/strict';
import { withStudio } from '../helpers/studio-browser.ts';
import { fixtureText } from '../helpers/fixtures.ts';

test('style selection confirms destructive changes, supports keyboard and survives save and reopen', async t => {
  await withStudio(t, async ({ page, consoleErrors, resourceErrors }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByLabel('JSON externo').setInputFiles({ name: 'project.json', mimeType: 'application/json', buffer: Buffer.from(fixtureText('storyboard')) });
    const three = page.getByRole('radio', { name: /3D estilizado/ });
    const vector = page.getByRole('radio', { name: /2D vectorial/ });
    const motion = page.getByRole('radio', { name: /Motion/ });
    await page.getByLabel('Idea').fill('Cambio sin guardar');
    page.once('dialog', async dialog => { assert.match(dialog.message(), /Cambiar de estilo eliminará los dibujos de \d+ escenas?/); await dialog.dismiss(); });
    await vector.click();
    assert.equal(await three.isChecked(), true);
    assert.equal(await page.getByLabel('Idea').inputValue(), 'Cambio sin guardar');
    page.once('dialog', async dialog => { await dialog.accept(); });
    await vector.check();
    assert.equal(await vector.isChecked(), true);
    await vector.focus();
    await page.keyboard.press('ArrowDown');
    assert.equal(await motion.isChecked(), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    if (process.env.STYLE_SCREENSHOT_DIR) await page.getByRole('group', { name: 'Estilo' }).screenshot({ path: `${process.env.STYLE_SCREENSHOT_DIR}/style-mobile.png` });
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await page.getByText(/Guardado · rev\./).waitFor();
    await page.getByRole('button', { name: 'Proyectos', exact: true }).click();
    await page.getByRole('button', { name: 'Abrir', exact: true }).click();
    assert.equal(await motion.isChecked(), true);
    assert.equal(await page.getByLabel('Idea').inputValue(), 'Cambio sin guardar');
    assert.deepEqual(consoleErrors, []);
    assert.deepEqual(resourceErrors, []);
  }, 'chromium');
});
