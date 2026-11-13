import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseProjectText } from '../../src/shared/schema/index.ts';
import { projectToVideoProps } from '../../src/shared/video-props.ts';
import { fixtureText } from '../helpers/fixtures.ts';
import { createServer, type Plugin } from 'vite';
import { chromium } from 'playwright-core';

test('Chromium renders counter boundary text while seeking', { timeout: 30_000 }, async () => {
  const plugin: Plugin = { name: 'counter-test', configureServer(server) {
    server.middlewares.use('/__counter_page', (_req, res) => {
      res.setHeader('Content-Type', 'text/html');
      res.end('<div id="root"></div><script type="module" src="/counter-test-entry.tsx"></script>');
    });
  }, resolveId(id) { return id === '/counter-test-entry.tsx' ? '\0counter-test-entry.tsx' : null; },
  load(id) { return id === '\0counter-test-entry.tsx' ? `
    import React, {createRef} from 'react';
    import {createRoot} from 'react-dom/client';
    import {Player} from '@remotion/player';
    import {VectorScene} from '/src/video/vector/VectorScene.tsx';
    const ref = createRef();
    window.seekCounter = frame => ref.current.seekTo(frame);
    const layer = {id:'counter', type:'counter', position:[540,650], rotation:0, scale:1, opacity:1,
      startMs:0, endMs:1000, fill:'#ffffff', animations:[], fontId:'builtin-sans-heavy-v1', fontSize:110, from:0, to:100};
    createRoot(document.getElementById('root')).render(React.createElement(Player, {ref, component:VectorScene,
      inputProps:{visual:{kind:'motion',version:1,background:'#123456',layers:[layer,
        {...layer,id:'decimal',from:-1.25,to:1.25},
        {...layer,id:'offset',startMs:10,endMs:101},
        {...layer,id:'single',startMs:1,endMs:34},
        {...layer,id:'tiny',from:0,to:1e-7},
        {...layer,id:'long',type:'text',text:'A'.repeat(63),position:[540,1200],
          animations:[{type:'move',startMs:0,endMs:1000,easing:'linear',from:[540,1200],to:[600,1200]}]},
        {...layer,id:'edge',type:'text',text:'Una frase larga cerca del borde del lienzo',position:[100,350]},
        {...layer,id:'unicode',type:'text',text:'မြန်မာ'.repeat(20),position:[900,1600]},
        {...layer,id:'multiline',type:'text',text:'A\\n'.repeat(60),fontSize:400,position:[540,960]},
        {...layer,id:'precise',type:'counter',from:0,to:0.12345678901234568,fontSize:400,position:[540,960]}]}},
      durationInFrames:31, compositionWidth:1080, compositionHeight:1920, fps:30}));
  ` : null; } };
  const server = await createServer({ configFile: false, envDir: false, plugins: [plugin], server: { host: '127.0.0.1', port: 0 } });
  await server.listen();
  const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  try {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const address = server.httpServer!.address();
    assert.ok(address && typeof address !== 'string');
    await page.goto(`http://127.0.0.1:${address.port}/__counter_page`);
    await page.waitForFunction(() => typeof (window as any).seekCounter === 'function' && document.querySelector('svg text'), null, { timeout: 5000 }).catch(error => { throw new Error(`${error.message}: ${errors.join('; ')}`); });
    for (const [frame, expected] of [[0, ['0', '-1.25', '0']], [1, ['3', '-1.16', '0', '100', '3.44828e-9']],
      [3, ['10', '-0.99', '100', '1.03448e-8']], [29, ['100', '1.25', '1e-7']], [1, ['3', '-1.16', '0', '100', '3.44828e-9']]] as const) {
      await page.evaluate(frame => (window as any).seekCounter(frame), frame);
      await page.waitForFunction(expected => JSON.stringify([...document.querySelectorAll('svg text')].slice(0, -1).map(node => node.textContent)) === JSON.stringify(expected), expected, { timeout: 4000 });
    }
    await page.evaluate(() => document.fonts.ready);
    const boxes = await page.locator('[data-vector-text]').evaluateAll(nodes => nodes.map(node => {
      const range = document.createRange(); range.selectNodeContents(node);
      const svg = node.closest('svg')!.getBoundingClientRect();
      const rects = [...range.getClientRects()].filter(rect => rect.width && rect.height);
      return { text: node.textContent, rects: rects.map(rect => ({ left: rect.left - svg.left, right: svg.right - rect.right,
        top: rect.top - svg.top, bottom: svg.bottom - rect.bottom })) };
    }));
    assert.deepEqual(boxes.map(box => box.text), ['A'.repeat(63), 'Una frase larga cerca del borde del lienzo', 'မြန်မာ'.repeat(20), 'A\n'.repeat(60)]);
    assert.ok(boxes[0]!.rects.length > 1, 'long text must wrap');
    for (const box of boxes) {
      assert.ok(box.rects.length > 0);
      for (const rect of box.rects) assert.ok(rect.left >= -1 && rect.right >= -1 && rect.top >= -1 && rect.bottom >= -1, JSON.stringify(rect));
    }
    assert.ok((await page.screenshot()).length > 1000);
    const beforeMove = await page.locator('[data-vector-text]').first().boundingBox();
    await page.evaluate(() => (window as any).seekCounter(29));
    await page.waitForFunction(() => document.querySelector('svg text')?.textContent === '100');
    const precise = await page.locator('svg text').last().evaluate(node => {
      const rect = node.getBoundingClientRect();
      const svg = node.closest('svg')!.getBoundingClientRect();
      return { text: node.textContent, left: rect.left - svg.left, right: svg.right - rect.right };
    });
    assert.equal(precise.text, '0.12345678901234568');
    assert.ok(precise.left >= -1 && precise.right >= -1, JSON.stringify(precise));
    const afterMove = await page.locator('[data-vector-text]').first().boundingBox();
    assert.ok(beforeMove && afterMove && afterMove.x > beforeMove.x + 40, 'wrapped text must follow its animation');
    await page.evaluate(() => (window as any).seekCounter(30));
    await page.waitForFunction(() => !document.querySelector('svg text'));
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await server.close(); }
});

test('CLI renders vector and kinetic motion frames and a two-second MP4', { timeout: 240_000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'molecula-vector-test-'));
  try {
    const parsed = parseProjectText(fixtureText('storyboard'));
    assert.ok(parsed.ok);
    const project = parsed.project;
    project.schemaVersion = 3;
    project.output.durationMs = 2000;
    project.captionStyle.enabled = false;
    project.scenes = project.scenes.slice(0, 1);
    const scene = project.scenes[0]!;
    scene.startMs = 0; scene.durationMs = 2000; scene.audio = null;
    const base = { id: 'title', position: [540, 650] as [number, number], rotation: 0, scale: 1, opacity: 1,
      startMs: 0, endMs: 2000, fill: '#ffffff', animations: [], fontId: 'builtin-sans-heavy-v1' as const, fontSize: 110 };
    const { fontId: _fontId, fontSize: _fontSize, ...shapeBase } = base;
    const render = (args: string[]) => {
      const result = spawnSync('node_modules/.bin/remotion', args, { encoding: 'utf8', timeout: 180_000 });
      assert.equal(result.status, 0, result.stderr || result.stdout);
    };
    const common = ['src/video/index.ts', 'Vertical'];
    project.styleId = 'vector-2d';
    scene.visual = { kind: 'vector', version: 1, background: '#123456', layers: [
      { ...shapeBase, id: 'rect', type: 'rect', position: [250, 1100], width: 200, height: 300 },
      { ...shapeBase, id: 'ellipse', type: 'ellipse', position: [540, 1100], width: 200, height: 300 },
      { ...shapeBase, id: 'polygon', type: 'polygon', position: [800, 1100], points: [[-100, 150], [0, -150], [100, 150]] },
      { ...base, type: 'text', text: 'VECTOR' },
    ] };
    const vectorProps = join(dir, 'vector.json');
    await writeFile(vectorProps, JSON.stringify(projectToVideoProps(project, {})));
    const vectorImage = join(dir, 'vector.png');
    render(['still', ...common, vectorImage, `--props=${vectorProps}`, '--frame=15', '--env-file=/dev/null']);
    project.styleId = 'motion-graphics';
    scene.visual = { kind: 'motion', version: 1, background: '#7b2442', layers: [
      { ...base, type: 'counter', from: 0, to: 100,
        animations: [{ type: 'scale', startMs: 0, endMs: 1000, easing: 'ease-out', from: 0.5, to: 1.5 }] },
    ] };
    const motionProps = join(dir, 'motion.json');
    await writeFile(motionProps, JSON.stringify(projectToVideoProps(project, {})));
    const motionImage = join(dir, 'motion.png');
    render(['still', ...common, motionImage, `--props=${motionProps}`, '--frame=30', '--env-file=/dev/null']);
    assert.notDeepEqual(await readFile(vectorImage), await readFile(motionImage));
    const video = join(dir, 'motion.mp4');
    render(['render', ...common, video, `--props=${motionProps}`, '--env-file=/dev/null', '--concurrency=1', '--scale=0.25']);
    const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', video], { encoding: 'utf8' });
    assert.equal(probe.status, 0, probe.stderr);
    assert.ok(Math.abs(Number(probe.stdout) - 2) < 0.05, probe.stdout);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
