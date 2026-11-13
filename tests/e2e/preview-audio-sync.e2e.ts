import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { createServer, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fixtureText } from '../helpers/fixtures.ts';
import { toneWav } from '../helpers/playable-audio.ts';

test('3D preview corrects a 220 ms audio lead and keeps direct scrubbing synchronized', async () => {
  // Test-only access to the actual Player frame; production markup is unchanged.
  const instrument: Plugin = { name: 'preview-player-probe', enforce: 'pre', transform(code, id) {
    if (id.endsWith('/studio/src/components/PreviewPlayer.tsx')) {
      return code.replace('const player = useRef<PlayerRef>(null);',
        'const player = useRef<PlayerRef>(null); (window as any).__previewPlayer = player;');
    }
  } };
  const server = await createServer({ configFile: false, plugins: [instrument, react()], server: { host: '127.0.0.1', port: 0 } });
  await server.listen();
  const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  try {
    for (const rate of [1, 6]) {
      const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      const address = server.httpServer!.address();
      assert.ok(address && typeof address !== 'string');
      await page.goto(`http://127.0.0.1:${address.port}/tests/e2e/preview-harness.html`);
      await page.waitForFunction(() => typeof (window as any).showPreview === 'function');
      const draft = JSON.parse(fixtureText('storyboard'));
      const wave = [...toneWav(12000)];
      draft.output.voiceMode = 'withVoice';
      draft.scenes = draft.scenes.slice(0, 1);
      draft.scenes[0].durationMs = 12000;
      draft.scenes[0].visual = {
        kind: 'kit', kitVersion: 1, palette: { background: '#DDEEF5' },
        sky: { top: '#DDEEF5', bottom: '#FFFFFF', sun: null, clouds: [] },
        environment: { seed: 1, terrain: null, water: null }, particles: [], labels: [], overlays: [],
        objects: Array.from({ length: 20 }, (_, i) => ({ id: `ball${i}`, type: 'sphere', params: { radius: 1 },
          position: [i % 5 - 2, Math.floor(i / 5) - 2, 0], rotation: [0, 0, 0], scale: 0.4, color: '#FFFFFF',
          animations: [{ type: 'pulse', startMs: 0, endMs: 12000, easing: 'linear', params: { amplitude: 0.15, cycles: 3 } }] })),
        camera: { move: 'static', from: [0, 0, 8], to: [0, 0, 8], target: [0, 0, 0], easing: 'linear' },
      };
      draft.scenes[0].audio = { assetId: 'a', offsetMs: 0, gainDb: 0 };
      draft.assets = [{ assetId: 'a', kind: 'audio', path: 'assets/a.wav', mimeType: 'audio/wav', byteLength: wave.length,
        sha256: null, durationMs: 12000, source: { origin: 'fixture', license: 'Synthetic', attribution: '' } }];
      await page.evaluate(({ draft, wave }) => {
        window.fetch = async () => new Response(new Uint8Array(wave), { headers: { 'Content-Type': 'audio/wav' } });
        (window as any).showPreview(draft);
      }, { draft, wave });
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate });
      await page.getByRole('button', { name: 'Play video', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('canvas') && [...document.querySelectorAll('audio')]
        .some(audio => audio.src.startsWith('blob:') && !audio.paused && audio.currentTime > 1));
      await page.evaluate(async () => {
        const audio = [...document.querySelectorAll('audio')].find(element => element.src.startsWith('blob:'))!;
        await new Promise<void>(resolve => {
          audio.addEventListener('seeked', () => resolve(), { once: true });
          audio.currentTime += 0.22;
        });
        (window as any).__correctiveSeeks = 0;
        audio.addEventListener('seeking', () => { (window as any).__correctiveSeeks++; });
      });
      await page.waitForTimeout(600);
      const drift = await page.evaluate(() => {
        const audio = [...document.querySelectorAll('audio')].find(element => element.src.startsWith('blob:'))!;
        return { paused: audio.paused, seeking: audio.seeking,
          seconds: audio.currentTime - (window as any).__previewPlayer.current.getCurrentFrame() / 30 };
      });
      assert.equal(drift.paused || drift.seeking, false);
      assert.ok(await page.evaluate(() => (window as any).__correctiveSeeks > 0), `rate ${rate}: audio lead was not corrected`);
      assert.ok(Math.abs(drift.seconds) < 0.18, `rate ${rate}: uncorrected audio drift ${drift.seconds}`);
      const bar = page.locator('.preview-transport div[style*="touch-action: none"]');
      const bounds = await bar.boundingBox();
      assert.ok(bounds);
      await bar.click({ position: { x: bounds.width * 0.6, y: bounds.height / 2 } });
      await page.waitForFunction(() => {
        const audio = [...document.querySelectorAll('audio')].find(element => element.src.startsWith('blob:'));
        const frame = (window as any).__previewPlayer.current.getCurrentFrame();
        return audio && !audio.paused && !audio.seeking && frame >= 210 && Math.abs(audio.currentTime - frame / 30) < 0.12;
      });
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally {
    await browser.close();
    await server.close();
  }
});
