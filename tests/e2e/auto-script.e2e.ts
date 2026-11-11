import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, copyFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { withStudio } from '../helpers/studio-browser.ts';
import { fakeCodex } from '../helpers/fake-codex.ts';

test('automatic script and sequential drawings via fake executable → real Chromium preview → saved silent MP4', { timeout: 240000 }, async t => {
  const fake = await fakeCodex();
  try {
    await withStudio(t, async ({ page, root, consoleErrors, resourceErrors }) => {
      page.setDefaultTimeout(20000);
      await page.getByLabel('Nombre', { exact: true }).fill('Auto');
      await page.getByRole('button', { name: 'Nuevo proyecto', exact: true }).click();
      await page.getByLabel('Idea', { exact: true }).fill('Una roca que viaja');
      await page.waitForFunction(() => !document.querySelector<HTMLOptionElement>('select option[value="auto"]')?.disabled);
      await page.getByLabel('Modo de guion', { exact: true }).selectOption('auto');
      const script = page.getByRole('region', { name: 'Guion automático' });
      await script.getByRole('button', { name: 'Generar con Codex', exact: true }).click();
      await script.getByRole('region', { name: 'Revisión del guion' }).waitFor();
      assert.equal(await page.locator('.scene-card').count(), 0, 'generation only reviews');
      await script.getByRole('button', { name: 'Aplicar al borrador', exact: true }).click();
      assert.equal(await page.locator('.scene-card').count(), 2);
      const projects = await page.evaluate(async () => {
        const token = document.querySelector<HTMLMetaElement>('meta[name="companion-token"]')!.content;
        return (await (await fetch('/api/projects', { headers: { authorization: `Bearer ${token}` } })).json()).projects;
      });
      const path = join(root, projects[0].projectId, 'project.json');
      const original = await readFile(path);
      await script.getByRole('button', { name: 'Dibujar todas con Codex', exact: true }).click();
      await script.getByText('Dibujos aplicados al borrador. Los cambios no se han guardado.', { exact: true }).waitFor();
      const preview = page.getByRole('region', { name: 'Vista previa del borrador' });
      await preview.locator('canvas').waitFor();
      await preview.locator('[data-caption-word="Una"]').waitFor();
      const records = (await readFile(fake.env.FAKE_CODEX_RECORD, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
      assert.equal(records.length, 3);
      assert.match(records[2].input, /Objetos usados anteriormente, con identidad completa: \[\{"id":"shared-rock"/);
      assert.deepEqual(await readFile(path), original, 'automatic stages never save');
      // Per-scene Auto uses the same adapter and review/apply, without redrawing others.
      const first = page.locator('.scene-card').first();
      await first.locator('summary').click();
      await first.getByLabel('Modo de dibujo').selectOption('auto');
      await first.getByRole('button', { name: 'Generar con Codex', exact: true }).click();
      await first.getByRole('region', { name: 'Revisión del dibujo' }).waitFor();
      await first.getByRole('button', { name: 'Aplicar al borrador', exact: true }).click();
      await first.getByText(/Aplicado al borrador/).waitFor();
      assert.ok(await page.getByRole('button', { name: 'Guarda antes de exportar' }).isDisabled());
      await page.getByRole('button', { name: 'Guardar', exact: true }).click();
      await page.getByText(/Guardado · rev\./).waitFor();
      const saved = JSON.parse(await readFile(path, 'utf8'));
      assert.equal(saved.scenes[0].revision, 2);
      assert.equal(saved.scenes[1].revision, 1);
      assert.deepEqual(saved.scenes[0].visual, saved.scenes[1].visual);
      const panel = page.getByRole('region', { name: 'Exportar video' });
      await panel.getByRole('button', { name: 'Exportar MP4', exact: true }).click();
      await panel.getByText('Exportación completada', { exact: true }).waitFor({ timeout: 180000 });
      const output = await panel.locator('.export-path').innerText();
      const { stdout } = await promisify(execFile)(resolve('node_modules/.bin/remotion'), ['ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', output]);
      const metadata = JSON.parse(stdout);
      const stream = metadata.streams.find((entry: any) => entry.codec_type === 'video');
      assert.deepEqual([stream.codec_name, stream.width, stream.height, stream.avg_frame_rate, Number(stream.nb_frames), Number(metadata.format.duration)], ['h264', 1080, 1920, '30/1', 60, 2]);
      assert.equal(metadata.streams.some((entry: any) => entry.codec_type === 'audio'), false);
      if (process.env.AUTO_SCREENSHOT_DIR) {
        await preview.screenshot({ path: join(process.env.AUTO_SCREENSHOT_DIR, 'auto-preview.png') });
        await panel.screenshot({ path: join(process.env.AUTO_SCREENSHOT_DIR, 'auto-export.png') });
        await copyFile(output, join(process.env.AUTO_SCREENSHOT_DIR, 'auto-offline.mp4'));
      }
      assert.deepEqual(consoleErrors, []);
      assert.deepEqual(resourceErrors, []);
    }, 'chromium', { env: fake.env });
  } finally { await fake.cleanup(); }
});

test('automatic mode is disabled with an actionable reason when CLI is missing; manual stays available', async t => {
  await withStudio(t, async ({ page }) => {
    await page.getByLabel('Nombre', { exact: true }).fill('Sin Codex');
    await page.getByRole('button', { name: 'Nuevo proyecto', exact: true }).click();
    await page.getByText(/Auto no disponible/).waitFor();
    assert.notEqual(await page.getByLabel('Modo de guion').locator('option[value="auto"]').getAttribute('disabled'), null);
    assert.equal(await page.getByLabel('Modo de guion').inputValue(), 'manual');
    assert.ok(await page.getByRole('button', { name: 'Copiar prompt', exact: true }).isEnabled());
  });
});

test('drawing displays elapsed time, prevents duplicate requests and cancels', { timeout: 45000 }, async t => {
  const fake = await fakeCodex();
  try {
    await withStudio(t, async ({ page }) => {
      await page.getByLabel('Nombre', { exact: true }).fill('Cancelación');
      await page.getByRole('button', { name: 'Nuevo proyecto', exact: true }).click();
      await page.getByLabel('Idea', { exact: true }).fill('Una roca');
      await page.waitForFunction(() => !document.querySelector<HTMLOptionElement>('select option[value="auto"]')?.disabled);
      await page.getByLabel('Modo de guion').selectOption('auto');
      const script = page.getByRole('region', { name: 'Guion automático' });
      await script.getByRole('button', { name: 'Generar con Codex', exact: true }).click();
      await script.getByRole('region', { name: 'Revisión del guion' }).waitFor();
      await script.getByRole('button', { name: 'Aplicar al borrador', exact: true }).click();
      const card = page.locator('.scene-card').first();
      await card.locator('summary').click();
      await card.getByLabel('Modo de dibujo').selectOption('auto');
      fake.env.FAKE_CODEX_MODE = 'hang';
      await card.getByRole('button', { name: 'Generar con Codex', exact: true }).click();
      await card.getByText(/Transcurrido: [1-9]\d* s; límite: 600 s/).waitFor();
      assert.ok(await card.getByRole('button', { name: 'Generando con Codex…' }).isDisabled());
      assert.equal((await readFile(fake.env.FAKE_CODEX_RECORD, 'utf8')).trim().split('\n').length, 2);
      await card.getByRole('button', { name: 'Cancelar generación' }).click();
      await card.getByText('Generación cancelada.').waitFor();
      assert.ok(await card.getByRole('button', { name: 'Generar con Codex', exact: true }).isEnabled());
      assert.equal(await card.getByRole('region', { name: 'Revisión del dibujo' }).count(), 0);
    }, 'chromium', { env: fake.env });
  } finally { await fake.cleanup(); }
});

test('auto errors expose safe invalid text/manual fallback and pending/stale drawings never overwrite edits', { timeout: 90000 }, async t => {
  const fake = await fakeCodex('success');
  try {
    await withStudio(t, async ({ page, root, store }) => {
      page.setDefaultTimeout(15000);
      await page.getByLabel('Nombre', { exact: true }).fill('Errores');
      await page.getByRole('button', { name: 'Nuevo proyecto', exact: true }).click();
      await page.getByLabel('Idea', { exact: true }).fill('Una roca');
      await page.waitForFunction(() => !document.querySelector<HTMLOptionElement>('select option[value="auto"]')?.disabled);
      await page.getByLabel('Modo de guion').selectOption('auto');
      const script = page.getByRole('region', { name: 'Guion automático' });
      for (const [mode, message] of [['fail', /codex login/], ['bad-json', /no es válida/], ['hang', /tiempo de espera/]] as const) {
        fake.env.FAKE_CODEX_MODE = mode;
        fake.env.VIBI_API_KEY = 'test-secret-never-return';
        await script.getByRole('button', { name: 'Generar con Codex', exact: true }).click();
        await script.getByRole('alert').filter({ hasText: message }).waitFor();
        if (mode === 'bad-json') {
          const text = await script.getByLabel('Pegar respuesta', { exact: true }).inputValue();
          assert.match(text, /invalid JSON/);
          assert.ok(!text.includes('test-secret-never-return') && !text.includes('f06-token'));
        }
        assert.equal(await page.locator('.scene-card').count(), 0);
      }
      fake.env.FAKE_CODEX_MODE = 'success';
      await script.getByRole('button', { name: 'Generar con Codex', exact: true }).click();
      await script.getByRole('region', { name: 'Revisión del guion' }).waitFor();
      await script.getByRole('button', { name: 'Aplicar al borrador', exact: true }).click();
      const card = page.locator('.scene-card').first();
      await card.locator('summary').click();
      await card.getByLabel('Modo de dibujo').selectOption('auto');
      fake.env.FAKE_CODEX_MODE = 'delayed';
      await card.getByRole('button', { name: 'Generar con Codex', exact: true }).click();
      assert.ok(await card.getByRole('button', { name: 'Generando con Codex…', exact: true }).isDisabled());
      await card.getByLabel('Texto').fill('Mi edición tiene prioridad.');
      await card.getByRole('region', { name: 'Revisión del dibujo' }).waitFor();
      await card.getByRole('button', { name: 'Aplicar al borrador', exact: true }).click();
      await card.getByRole('alert').filter({ hasText: /borrador cambió/ }).waitFor();
      assert.equal(await card.getByLabel('Texto').inputValue(), 'Mi edición tiene prioridad.');
      await card.getByLabel('Modo de dibujo').selectOption('manual');
      assert.ok(await card.getByRole('button', { name: 'Copiar prompt de dibujo', exact: true }).isEnabled());
      // A failure in scene two retains scene one's accepted drawing and the narration edit.
      fake.env.FAKE_CODEX_MODE = 'partial';
      // Previous per-scene generation is included in the fake record; start a fresh batch counter.
      const { writeFile } = await import('node:fs/promises');
      await writeFile(fake.env.FAKE_CODEX_RECORD, '');
      await script.getByRole('button', { name: 'Dibujar todas con Codex', exact: true }).click();
      await script.getByRole('alert').filter({ hasText: /Se conservan los dibujos ya aplicados/ }).waitFor();
      await page.getByRole('button', { name: 'Guardar', exact: true }).click();
      await page.getByText(/Guardado · rev\./).waitFor();
      const projects = await store.listProjects();
      const saved = JSON.parse(await readFile(join(root, projects[0]!.projectId, 'project.json'), 'utf8'));
      assert.equal(saved.scenes[0].text, 'Mi edición tiene prioridad.');
      assert.equal(saved.scenes[0].visual.kind, 'kit');
      assert.equal(saved.scenes[1].visual, null);
    }, 'chromium', { env: fake.env, timeoutMs: 1500 });
  } finally { await fake.cleanup(); }
});
