import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { fixtureText } from '../helpers/fixtures.ts';
import { toneWav } from '../helpers/playable-audio.ts';

test('preview never reuses a revoked blob when asset identity changes A → B → A', async () => {
  const server = await createServer({ configFile: false, plugins: [react()], server: { host: '127.0.0.1', port: 0, strictPort: false } });
  await server.listen();
  const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  try {
    const page = await browser.newPage();
    const address = server.httpServer!.address();
    assert.ok(address && typeof address !== 'string');
    await page.goto(`http://127.0.0.1:${address.port}/tests/e2e/preview-harness.html`);
    await page.waitForFunction(() => typeof (window as any).showPreview === 'function');
    const source = JSON.parse(fixtureText('storyboard'));
    source.output.voiceMode = 'withVoice';
    source.scenes.forEach((scene: any) => { scene.visual = null; });
    source.assets = ['a', 'b'].map(assetId => ({ assetId, kind: 'audio', path: `assets/${assetId}.wav`,
      mimeType: 'audio/wav', byteLength: 32044, sha256: null, durationMs: 1000,
      source: { origin: 'fixture', license: 'Synthetic test data', attribution: '' } }));
    const wave = [...toneWav(1000)];
    await page.evaluate(({ draft, wave }) => {
      const state = { created: [] as string[], revoked: [] as string[], requests: [] as string[], aborted: [] as string[], releases: [] as (() => void)[] };
      Object.assign(window, { ownership: state, draft });
      const create = URL.createObjectURL.bind(URL); const revoke = URL.revokeObjectURL.bind(URL);
      URL.createObjectURL = blob => { const url = create(blob); state.created.push(url); return url; };
      URL.revokeObjectURL = url => { state.revoked.push(url); revoke(url); };
      window.fetch = async (input, init) => {
        const id = String(input).split('/').at(-1)!;
        state.requests.push(id);
        init?.signal?.addEventListener('abort', () => state.aborted.push(id));
        if (state.requests.length > 1) await new Promise<void>(resolve => state.releases.push(resolve));
        return new Response(new Uint8Array(wave), { status: 200, headers: { 'Content-Type': 'audio/wav' } });
      };
      (window as any).setAudio = (id: string) => {
        const copy = structuredClone((window as any).draft);
        copy.scenes[0].audio = { assetId: id, offsetMs: 0, gainDb: 0 };
        (window as any).showPreview(copy);
      };
      (window as any).setAudio('a');
    }, { draft: source, wave });
    await page.waitForFunction(() => (window as any).ownership.created.length === 1);
    await page.getByRole('button', { name: 'Play video', exact: true }).waitFor();
    await page.evaluate(() => (window as any).setAudio('b'));
    await page.waitForFunction(() => (window as any).ownership.requests.length === 2 && (window as any).ownership.revoked.length === 1);
    await page.evaluate(() => (window as any).setAudio('a'));
    await page.waitForFunction(() => (window as any).ownership.requests.length === 3);
    assert.equal(await page.getByRole('button', { name: 'Play video', exact: true }).count(), 0, 'revoked A is never remounted');
    await page.evaluate(() => (window as any).ownership.releases[1]());
    await page.waitForFunction(() => (window as any).ownership.created.length === 2);
    await page.getByRole('button', { name: 'Play video', exact: true }).click();
    await page.waitForFunction(() => [...document.querySelectorAll('audio')].some(audio =>
      audio.src === (window as any).ownership.created[1] && !audio.paused && audio.currentTime > 0.1));
    await page.evaluate(() => (window as any).ownership.releases[0]());
    await page.waitForTimeout(100);
    const state = await page.evaluate(() => (window as any).ownership);
    assert.equal(state.created.length, 2, 'aborted B cannot create a late blob');
    assert.notEqual(state.created[0], state.created[1]);
    assert.deepEqual(state.revoked, [state.created[0]]);
    await page.evaluate(() => (window as any).setAudio('b'));
    await page.waitForFunction(() => (window as any).ownership.requests.length === 4);
    await page.getByText('No se pudieron cargar recursos: b. Revise el manifest.').waitFor({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Play video', exact: true }).waitFor();
    const afterTimeout = await page.evaluate(() => (window as any).ownership);
    assert.equal(afterTimeout.aborted.filter((id: string) => id === 'b').length, 2);
  } finally {
    await browser.close();
    await server.close();
  }
});
