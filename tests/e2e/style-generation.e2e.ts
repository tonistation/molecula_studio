import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixtureText } from '../helpers/fixtures.ts';
import { withStudio } from '../helpers/studio-browser.ts';

for (const [label, style, kind] of [['2D vectorial', 'vector-2d', 'vector'], ['Motion', 'motion-graphics', 'motion']] as const) {
  test(`${label}: manual review, automatic drawing and sequential partial failure`, async t => {
    await withStudio(t, async ({ page, root }) => {
      page.setDefaultTimeout(10000);
      await page.route('**/api/capabilities', route => route.fulfill({ json: { codex: true, vibi: false, vibiVoiceConfigured: false, vibiAccentDirective: false } }));
      let requests = 0;
      let failAt = 0;
      const visual = (duration: number) => ({ kind, version: 1, background: '#FFFFFF', layers: [{ id: 'shape', type: 'rect', position: [540, 960], rotation: 0, scale: 1, opacity: 1, startMs: 0, endMs: duration, fill: '#123456', width: 100, height: 200, animations: [] }] });
      await page.route('**/api/drawing/generate', async route => {
        const { project, sceneId } = route.request().postDataJSON();
        assert.equal(project.schemaVersion, 3); assert.equal(project.styleId, style);
        requests++;
        if (requests > 2 && project.scenes[0].sceneId !== sceneId) assert.equal(project.scenes[0].visual.kind, kind);
        if (requests === failAt) return route.fulfill({ status: 500, json: { error: { message: 'Fallo simulado' } } });
        const scene = project.scenes.find((item: { sceneId: string }) => item.sceneId === sceneId);
        return route.fulfill({ json: visual(scene.durationMs) });
      });
      await page.reload();
      await page.getByLabel('JSON externo').setInputFiles({ name: 'project.json', mimeType: 'application/json', buffer: Buffer.from(fixtureText('storyboard')) });
      page.once('dialog', dialog => void dialog.accept());
      await page.getByRole('radio', { name: new RegExp(label) }).check();
      const first = page.locator('.scene-card').first();
      await first.locator('summary').click();
      await first.getByRole('button', { name: 'Copiar prompt de dibujo' }).click();
      await first.getByText(/Prompt copiado|No se pudo acceder al portapapeles/).waitFor();
      await first.getByLabel('Pegar escena').fill('{}');
      await first.getByRole('button', { name: 'Revisar', exact: true }).click();
      await first.getByRole('alert').waitFor();
      const raw = JSON.parse(fixtureText('storyboard'));
      await first.getByLabel('Pegar escena').fill(JSON.stringify(visual(raw.scenes[0].durationMs)));
      await first.getByRole('button', { name: 'Revisar', exact: true }).click();
      await first.getByRole('region', { name: 'Revisión del dibujo' }).waitFor();
      await first.getByRole('button', { name: 'Aplicar al borrador' }).click();
      await first.getByText(/Aplicado al borrador/).waitFor();
      await page.getByRole('region', { name: 'Vista previa del borrador' }).locator('svg g[fill="#123456"] rect').waitFor();
      await first.getByLabel('Modo de dibujo').selectOption('auto');
      await first.getByRole('button', { name: 'Generar con Codex' }).click();
      await first.getByRole('region', { name: 'Revisión del dibujo' }).waitFor();
      await page.getByLabel('Idea').fill('Cambio durante revisión');
      await first.getByRole('button', { name: 'Aplicar al borrador' }).click();
      await first.getByRole('alert').getByText(/borrador cambió desde la revisión/).waitFor();
      await first.getByRole('button', { name: 'Generar con Codex' }).click();
      await first.getByRole('region', { name: 'Revisión del dibujo' }).waitFor();
      await first.getByRole('button', { name: 'Aplicar al borrador' }).click();
      await first.getByText(/Aplicado al borrador/).waitFor();
      await page.getByLabel('Modo de guion').selectOption('auto');
      failAt = requests + 2;
      await page.getByRole('button', { name: 'Dibujar todas con Codex' }).click();
      await page.getByRole('alert').getByText(/Fallo simulado/).waitFor();
      assert.equal(requests, failAt);
      await page.getByRole('button', { name: 'Guardar', exact: true }).click();
      await page.getByText(/Guardado · rev\./).waitFor();
      const saved = JSON.parse(await readFile(join(root, raw.projectId, 'project.json'), 'utf8'));
      assert.equal(saved.styleId, style); assert.equal(saved.scenes[0].visual.kind, kind);
      assert.equal(saved.scenes[1].visual, null);
      failAt = 0;
      await page.getByRole('button', { name: 'Dibujar todas con Codex' }).click();
      await page.getByText('Dibujos aplicados al borrador. Los cambios no se han guardado.').waitFor();
      await page.getByRole('button', { name: 'Guardar', exact: true }).click();
      await page.getByText(/Guardado · rev\./).waitFor();
      const completed = JSON.parse(await readFile(join(root, raw.projectId, 'project.json'), 'utf8'));
      assert.ok(completed.scenes.every((scene: { visual: { kind: string } | null }) => scene.visual?.kind === kind));
      await page.getByRole('button', { name: 'Proyectos', exact: true }).click();
      await page.getByRole('button', { name: 'Abrir', exact: true }).click();
      assert.equal(await page.getByRole('radio', { name: new RegExp(label) }).isChecked(), true);
    }, 'chromium');
  });
}

test('cancelled flat generation never applies a late response', async t => {
  await withStudio(t, async ({ page, root }) => {
    await page.route('**/api/capabilities', route => route.fulfill({ json: { codex: true, vibi: false, vibiVoiceConfigured: false, vibiAccentDirective: false } }));
    let release!: () => void;
    let started!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const requested = new Promise<void>(resolve => { started = resolve; });
    await page.route('**/api/drawing/generate', async route => {
      started();
      await waiting;
      await route.fulfill({ json: { kind: 'vector', version: 1, background: '#FFFFFF', layers: [] } }).catch(() => undefined);
    });
    await page.reload();
    await page.getByLabel('JSON externo').setInputFiles({ name: 'project.json', mimeType: 'application/json', buffer: Buffer.from(fixtureText('storyboard')) });
    page.once('dialog', dialog => void dialog.accept());
    await page.getByRole('radio', { name: /2D vectorial/ }).check();
    const first = page.locator('.scene-card').first();
    await first.locator('summary').click();
    await first.getByLabel('Modo de dibujo').selectOption('auto');
    await first.getByRole('button', { name: 'Generar con Codex' }).click();
    await requested;
    await first.getByRole('button', { name: 'Cancelar generación' }).click();
    release();
    await first.getByText('Generación cancelada.').waitFor();
    assert.equal(await first.getByRole('region', { name: 'Revisión del dibujo' }).count(), 0);
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await page.getByText(/Guardado · rev\./).waitFor();
    const saved = JSON.parse(await readFile(join(root, JSON.parse(fixtureText('storyboard')).projectId, 'project.json'), 'utf8'));
    assert.equal(saved.scenes[0].visual, null);
  }, 'chromium');
});
