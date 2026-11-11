import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { createRenderService } from '../../src/companion/render/render-service.ts';
import { ProjectStore } from '../../src/companion/store/project-store.ts';
import { parseProjectText, serializeProject } from '../../src/shared/schema/index.ts';
import { fixtureText } from '../helpers/fixtures.ts';
import { draftVideoProps } from '../../studio/src/preview-model.ts';
import { projectToVideoProps } from '../../src/shared/video-props.ts';
import { voicedFixture, assertRenderedAudio } from '../helpers/render-audio.ts';
import { sha256Hex } from '../../src/shared/digests.ts';
import { canonicalize } from '../../src/shared/canonical.ts';

const exec = promisify(execFile);

async function setup(t: test.TestContext) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'molecula-render-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const parsed = parseProjectText(fixtureText('storyboard'));
  assert.ok(parsed.ok);
  const project = parsed.project;
  const input = join(root, project.projectId, 'project.json');
  await mkdir(dirname(input));
  await writeFile(input, serializeProject(project));
  return { root, input, project };
}

function fakeRenderer() {
  let bundles = 0;
  const calls: Record<string, unknown>[] = [];
  const service = createRenderService({
    bundle: async () => { bundles++; return '/fake/bundle'; },
    selectComposition: async (options) => {
      calls.push(options);
      return { id: 'Vertical', ...options.inputProps, defaultProps: {}, props: options.inputProps } as never;
    },
    renderMedia: async (options) => {
      calls.push(options);
      assert.equal(await readFile(options.outputLocation!, 'utf8'), '');
      await writeFile(options.outputLocation!, 'complete mp4');
      return { buffer: null, slowestFrames: [], contentType: 'video/mp4' };
    },
  });
  return { service, calls, bundles: () => bundles };
}

test('saved edited narration uses the same derived captions in preview and both export paths', async t => {
  const { root, input, project } = await setup(t);
  let store = new ProjectStore({ workspaceRoot: root });
  t.after(() => store.close());
  await store.init();
  const opened = await store.readProject(project.projectId);
  const edited = structuredClone(opened.project);
  edited.revision++;
  edited.scenes[0]!.text = 'Texto nuevo que debe exportarse';
  await store.saveProject({ projectId: edited.projectId, project: edited, expectedRevision: opened.revision,
    expectedDigest: opened.digest, operationId: 'edit-caption' });
  await store.close();
  store = new ProjectStore({ workspaceRoot: root });
  await store.init();
  const saved = (await store.readProject(project.projectId)).project;
  const bytes = await readFile(input);
  const preview = draftVideoProps(saved, {});
  const shared = projectToVideoProps(saved, {});
  assert.equal(shared.scenes[0]!.words.map(word => word.text).join(' '), edited.scenes[0]!.text);
  assert.deepEqual(shared, preview);
  const fake = fakeRenderer();
  // CLI reads the file; UI passes the admitted saved revision to the same service.
  await fake.service({ projectFile: input, workspaceRoot: root, outputPath: join(root, 'cli.mp4') });
  await fake.service({ projectFile: input, workspaceRoot: root, savedProject: saved, outputPath: join(root, 'ui.mp4') });
  for (const call of fake.calls) assert.deepEqual(call.inputProps, preview);
  assert.deepEqual(saved.scenes[0]!.words, opened.project.scenes[0]!.words);
  assert.deepEqual(saved.scenes[0]!.mediaBindings, opened.project.scenes[0]!.mediaBindings);
  assert.deepEqual(saved.scenes[0]!.audio, opened.project.scenes[0]!.audio);
  assert.deepEqual(await readFile(input), bytes);
});

test('renders saved revision with cached bundle, matching props and atomic publication', async t => {
  const { root, input, project } = await setup(t);
  const before = await readFile(input);
  const fake = fakeRenderer();
  const output = await fake.service({ projectFile: input, workspaceRoot: root, now: new Date('2026-11-05T12:34:56Z') });
  assert.equal(output, join(root, '.renders', project.projectId, `${project.revision}-20261105-123456.mp4`));
  assert.equal(await readFile(output, 'utf8'), 'complete mp4');
  assert.deepEqual(await readFile(input), before);
  const [selection, render] = fake.calls;
  assert.deepEqual(selection!.inputProps, render!.inputProps);
  assert.deepEqual(render!.chromiumOptions, { gl: 'angle' });
  assert.equal(render!.codec, 'h264');
  assert.equal(render!.concurrency, 1);
  assert.notEqual(render!.outputLocation, output);
  await fake.service({ projectFile: input, workspaceRoot: root, outputPath: join(root, 'second.mp4') });
  assert.equal(fake.bundles(), 1);
  assert.deepEqual(await readdir(dirname(output)), [output.split('/').at(-1)]);
});

test('rejects invalid and unsupported projects before bundling or output', async t => {
  const { root, input, project } = await setup(t);
  const fake = fakeRenderer();
  await writeFile(input, '{"schemaVersion":2}');
  await assert.rejects(fake.service({ projectFile: input, workspaceRoot: root }), /proyecto/i);
  project.styleId = 'future-style';
  await writeFile(input, serializeProject(project));
  await assert.rejects(fake.service({ projectFile: input, workspaceRoot: root }), /style/i);
  assert.equal(fake.bundles(), 0);
  assert.deepEqual(await readdir(root), [project.projectId]);
});

test('CLI voiced render serves only verified manifest audio privately and revokes access after failure', async t => {
  const { root, input, project } = await setup(t);
  const { toneWav } = await import('../helpers/playable-audio.ts');
  const { createHash } = await import('node:crypto');
  const bytes = toneWav();
  await mkdir(join(dirname(input), 'assets'));
  const path = join(dirname(input), 'assets/voice.wav');
  await writeFile(path, bytes);
  project.assets = [{ assetId: 'voice', kind: 'audio', path: 'assets/voice.wav', mimeType: 'audio/wav',
    byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), durationMs: 2000,
    source: { origin: 'fixture', license: 'Synthetic test data', attribution: '' } }];
  project.output.voiceMode = 'withVoice';
  project.scenes[0]!.audio = { assetId: 'voice', offsetMs: 500, gainDb: -6 };
  await writeFile(input, serializeProject(project));
  const original = await readFile(input);
  let url = '';
  let checked = false;
  const service = createRenderService({
    bundle: async () => '/bundle',
    selectComposition: async options => {
      const props = options.inputProps as ReturnType<typeof projectToVideoProps>;
      url = props.scenes[0]!.audioUrl!;
      assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/render-assets\/[a-f0-9]{64}\/voice$/);
      assert.equal(props.scenes[0]!.gainDb, -6);
      assert.equal(props.scenes[0]!.audioOffsetMs, 500);
      assert.deepEqual(Buffer.from(await (await fetch(url)).arrayBuffer()), bytes);
      const token = new URL(url).pathname.split('/')[2]!;
      assert.equal((await fetch(url.replace(token, '0'.repeat(64)))).status, 404);
      assert.equal((await fetch(url.replace('/voice', '/undeclared'))).status, 404);
      assert.equal((await fetch(url, { method: 'POST' })).status, 405);
      const badHost = await new Promise<number>(resolve => {
        const request = httpRequest(url, { headers: { host: 'evil.test' } }, response => { response.resume(); resolve(response.statusCode!); });
        request.end();
      });
      assert.equal(badHost, 403);
      await writeFile(path, Buffer.alloc(bytes.length));
      assert.equal((await fetch(url)).status, 409);
      await rm(path);
      await symlink(join(root, 'outside.wav'), path);
      await writeFile(join(root, 'outside.wav'), bytes);
      assert.equal((await fetch(url)).status, 409);
      await rm(path);
      await writeFile(path, bytes);
      const { rename } = await import('node:fs/promises');
      await rename(join(dirname(input), 'assets'), join(dirname(input), 'original-assets'));
      await symlink(join(dirname(input), 'original-assets'), join(dirname(input), 'assets'));
      assert.equal((await fetch(url)).status, 409, 'a symlinked assets directory is never followed');
      await rm(join(dirname(input), 'assets'));
      await rename(join(dirname(input), 'original-assets'), join(dirname(input), 'assets'));
      checked = true;
      return {} as never;
    },
    renderMedia: async () => { throw new Error(`decoder failed ${url}`); },
  });
  await assert.rejects(service({ projectFile: input, workspaceRoot: root }), error => {
    assert.match((error as Error).message, /No se pudo exportar/);
    assert.equal((error as Error).message.includes(url), false);
    return true;
  });
  assert.equal(checked, true, 'all capability assertions ran before decoder failure');
  await assert.rejects(fetch(url));
  assert.deepEqual(await readFile(input), original);
  assert.deepEqual(await readdir(join(root, '.renders', project.projectId)), []);
  const retry = fakeRenderer();
  await retry.service({ projectFile: input, workspaceRoot: root });
  const nextUrl = (retry.calls[0]!.inputProps as ReturnType<typeof projectToVideoProps>).scenes[0]!.audioUrl!;
  assert.notEqual(new URL(nextUrl).pathname, new URL(url).pathname, 'retry uses a fresh capability');
  await assert.rejects(fetch(nextUrl), 'success closes the private server too');
});

test('independent services publish the same destination without replacing the winner', async t => {
  const { root, input } = await setup(t);
  const outputPath = join(root, 'shared.mp4');
  let arrivals = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const services = ['first complete mp4', 'second complete mp4'].map(contents => createRenderService({
    bundle: async () => '/bundle',
    selectComposition: async () => ({} as never),
    renderMedia: async options => {
      await writeFile(options.outputLocation!, contents);
      if (++arrivals === 2) release();
      await gate;
      return { buffer: null, slowestFrames: [], contentType: 'video/mp4' };
    },
  }));
  const results = await Promise.allSettled(services.map(service => service({
    projectFile: input, workspaceRoot: root, outputPath,
  })));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const loser = results.find(result => result.status === 'rejected');
  assert.ok(loser?.status === 'rejected');
  assert.match(loser.reason.message, /existe/i);
  const winner = results.findIndex(result => result.status === 'fulfilled');
  assert.equal(await readFile(outputPath, 'utf8'), ['first complete mp4', 'second complete mp4'][winner]);
  assert.deepEqual((await readdir(root)).sort(), [input.split('/').at(-2), 'shared.mp4'].sort());
  // A failed publication releases its service and removes only its private staging directory.
  await services[1 - winner]!({ projectFile: input, workspaceRoot: root, outputPath: join(root, 'retry.mp4') });
});

test('preserves existing output and refuses symlinked render directories', async t => {
  const { root, input } = await setup(t);
  const fake = fakeRenderer();
  await assert.rejects(fake.service({ projectFile: input, workspaceRoot: root, outputPath: join(root, 'bad.mov') }), /mp4/i);
  const outputPath = join(root, 'keep.mp4');
  await writeFile(outputPath, 'keep');
  await assert.rejects(fake.service({ projectFile: input, workspaceRoot: root, outputPath }), /existe/i);
  assert.equal(await readFile(outputPath, 'utf8'), 'keep');
  await symlink(root, join(root, '.renders'));
  await assert.rejects(fake.service({ projectFile: input, workspaceRoot: root }), /simbólico/i);
  assert.equal(fake.bundles(), 0);
});

test('CLI reports usage and invalid input with nonzero exit status', async t => {
  const { root, input } = await setup(t);
  await assert.rejects(exec(process.execPath, ['scripts/render-project.ts']), error => {
    assert.match((error as Error & { stderr: string }).stderr, /Uso: npm run render/);
    return true;
  });
  await writeFile(input, '{"schemaVersion":2}');
  await assert.rejects(exec(process.execPath, ['scripts/render-project.ts', input]), error => {
    assert.match((error as Error & { stderr: string }).stderr, /Proyecto inválido/);
    return true;
  });
  assert.equal((await readdir(root)).includes('.renders'), false);
});

test('rejects overlapping renders and cleans partial files after renderer failure', async t => {
  const { root, input } = await setup(t);
  let enter!: () => void;
  let release!: () => void;
  const entered = new Promise<void>(r => { enter = r; });
  const gate = new Promise<void>(r => { release = r; });
  const service = createRenderService({
    bundle: async () => '/bundle',
    selectComposition: async () => ({} as never),
    renderMedia: async options => {
      await writeFile(options.outputLocation!, 'partial');
      enter();
      await gate;
      throw new Error('encoder failed');
    },
  });
  const outputPath = join(root, 'failed.mp4');
  const pending = service({ projectFile: input, workspaceRoot: root, outputPath });
  await entered;
  await assert.rejects(service({ projectFile: input, workspaceRoot: root, outputPath }), /curso/i);
  release();
  await assert.rejects(pending, /No se pudo exportar/);
  assert.deepEqual((await readdir(root)).sort(), [input.split('/').at(-2)]);
});

test('ProjectStore ignores .renders even with project.json inside', async t => {
  const { root, input, project } = await setup(t);
  await mkdir(join(root, '.renders'));
  await writeFile(join(root, '.renders', 'project.json'), await readFile(input));
  const store = new ProjectStore({ workspaceRoot: root });
  await store.init();
  t.after(() => store.close());
  assert.deepEqual((await store.listProjects()).map(p => p.projectId), [project.projectId]);
});

test('real CLI renders 2s fixture as H.264 1080x1920 at 30fps', { timeout: 240_000 }, async t => {
  const { root, input, project } = await setup(t);
  project.output.durationMs = 2000;
  const scene = project.scenes[0]!;
  project.scenes = [{ ...scene, startMs: 0, durationMs: 2000, visual: null, words: [], audio: null, mediaBindings: { audio: null, words: null } }];
  project.output.voiceMode = 'silent';
  await writeFile(input, serializeProject(project));
  const output = join(root, 'real.mp4');
  const { stdout } = await exec(process.execPath, ['scripts/render-project.ts', input, output], { timeout: 220_000 });
  assert.ok(stdout.includes(output));
  const probe = await exec(resolve('node_modules/.bin/remotion'), ['ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', output]);
  const metadata = JSON.parse(probe.stdout);
  const video = metadata.streams.find((stream: { codec_type: string }) => stream.codec_type === 'video');
  assert.equal(video.codec_name, 'h264');
  assert.equal(video.width, 1080);
  assert.equal(video.height, 1920);
  assert.equal(video.avg_frame_rate, '30/1');
  assert.ok(Math.abs(Number(metadata.format.duration) - 2) <= 1 / 30);
  assert.ok(Math.abs(Number(video.nb_frames) - 60) <= 1);
  assert.equal(metadata.streams.some((s: { codec_type: string }) => s.codec_type === 'audio'), false);
});

test('real CLI completes a label pulse through exact zero scale', { timeout: 240_000 }, async t => {
  const { root, input } = await setup(t);
  const parsed = parseProjectText(await readFile('docs/plan/examples/kit/sal-del-mar-storyboard.json'));
  assert.ok(parsed.ok);
  const project = parsed.project; const scene = project.scenes[0]!;
  assert.ok(scene.visual && 'kind' in scene.visual && scene.visual.kind === 'kit');
  project.output.durationMs = 2000; project.output.voiceMode = 'silent';
  project.scenes = [{ ...scene, startMs: 0, durationMs: 2000, words: [], audio: null, mediaBindings: { audio: null, words: null } }];
  const visual = project.scenes[0]!.visual!; assert.ok('kind' in visual && visual.kind === 'kit');
  visual.camera = { move: 'static', from: [0, 0, 10], to: [0, 0, 10], target: [0, 0, 0], easing: 'linear' };
  visual.particles = []; visual.overlays = []; visual.labels = [];
  visual.objects = [{ id: 'pulse-label', type: 'label', params: { proportions: { width: 2, height: 0.5, depth: 0.1 }, text: 'Pulso', color: '#273E46' },
    position: [0, 0, 0], rotation: [0, 0, 0.4], scale: 1, color: '#273E46',
    animations: [{ type: 'pulse', startMs: 0, endMs: 2000, easing: 'linear', params: { amplitude: 1, cycles: 1 } }] }];
  await writeFile(input, serializeProject(project));
  const output = join(root, 'pulse.mp4');
  await exec(process.execPath, ['scripts/render-project.ts', input, output], { timeout: 220_000 });
  assert.ok((await readFile(output)).length > 0);
});

test('real CLI renders a verified procedural model and refuses tampering', { timeout: 240_000 }, async t => {
  const { root, input } = await setup(t);
  const parsed = parseProjectText(await readFile('docs/plan/examples/kit/sal-del-mar-storyboard.json'));
  assert.ok(parsed.ok);
  const project = parsed.project;
  const scene = project.scenes[0]!;
  project.output.durationMs = 2000; project.output.voiceMode = 'silent';
  project.scenes = [{ ...scene, startMs: 0, durationMs: 2000, words: [], audio: null, mediaBindings: { audio: null, words: null } }];
  const visual = project.scenes[0]!.visual!; assert.ok('kind' in visual && visual.kind === 'kit');
  const model = { version: 1 as const, name: 'Plant', semanticId: 'plant', parts: [{ shape: 'sphere' as const,
    position: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number],
    scale: [1, 1, 1] as [number, number, number], color: '#00ff00' }] };
  const id = await sha256Hex(canonicalize(model));
  project.models = [{ id, model }];
  visual.objects = [{ id: 'plant', type: 'model', params: { modelId: id }, position: [0, 0, 0], rotation: [0, 0, 0], scale: 1, color: '#ffffff', animations: [] }];
  visual.labels = []; visual.particles = []; visual.overlays = [];
  await writeFile(input, serializeProject(project));
  const output = join(root, 'model.mp4');
  await exec(process.execPath, ['scripts/render-project.ts', input, output], { timeout: 220_000 });
  assert.ok((await readFile(output)).length > 0);
  project.models[0]!.model.name = 'Forged';
  await writeFile(input, serializeProject(project));
  await assert.rejects(exec(process.execPath, ['scripts/render-project.ts', input, join(root, 'forged.mp4')], { timeout: 60000 }), /integridad de los modelos/);
});

test('real CLI includes audio with scene sync, source offsets and gain; silent mode excludes attached audio', { timeout: 300_000 }, async t => {
  const { root, input, project } = await setup(t);
  const audio = voicedFixture(project);
  await mkdir(join(dirname(input), 'assets'));
  await writeFile(join(dirname(input), 'assets/voice.wav'), audio);
  await writeFile(input, serializeProject(project));
  const original = await readFile(input);
  const output = join(root, 'voiced.mp4');
  const result = await exec(process.execPath, ['scripts/render-project.ts', input, output], { timeout: 220_000 });
  assert.equal(result.stdout.includes('/render-assets/'), false);
  assert.equal(result.stderr.includes('/render-assets/'), false);
  await assertRenderedAudio(output);
  assert.deepEqual(await readFile(input), original);
  project.output.voiceMode = 'silent';
  await writeFile(input, serializeProject(project));
  const silent = join(root, 'muted.mp4');
  await exec(process.execPath, ['scripts/render-project.ts', input, silent], { timeout: 220_000 });
  const probe = await exec(resolve('node_modules/.bin/remotion'), ['ffprobe', '-v', 'error', '-show_streams', '-of', 'json', silent]);
  assert.equal(JSON.parse(probe.stdout).streams.some((stream: { codec_type: string }) => stream.codec_type === 'audio'), false);
  // Schema-valid manifest does not promise decodability: fail closed, no partial publication or URL diagnostics.
  const { createHash } = await import('node:crypto');
  const broken = Buffer.from('not a decodable audio file');
  project.output.voiceMode = 'withVoice';
  project.assets[0]!.byteLength = broken.length;
  project.assets[0]!.sha256 = createHash('sha256').update(broken).digest('hex');
  await writeFile(join(dirname(input), 'assets/voice.wav'), broken);
  await writeFile(input, serializeProject(project));
  const failed = join(root, 'broken.mp4');
  await assert.rejects(exec(process.execPath, ['scripts/render-project.ts', input, failed], { timeout: 60000 }), error => {
    const result = error as Error & { stdout: string; stderr: string };
    assert.match(result.stderr, /No se pudo exportar/);
    assert.equal((result.stdout + result.stderr).includes('/render-assets/'), false);
    return true;
  });
  assert.equal((await readdir(root)).includes('broken.mp4'), false);
  assert.equal((await readdir(root)).some(name => name.startsWith('.render-')), false);
  await rm(join(dirname(input), 'assets/voice.wav'));
  await assert.rejects(exec(process.execPath, ['scripts/render-project.ts', input, failed], { timeout: 60000 }), error => {
    const result = error as Error & { stdout: string; stderr: string };
    assert.match(result.stderr, /No se pudo exportar/);
    assert.equal((result.stdout + result.stderr).includes('/render-assets/'), false, 'missing media diagnostics must not leak capabilities');
    return true;
  });
});
