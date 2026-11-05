import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { createRenderService } from '../../src/companion/render/render-service.ts';
import { ProjectStore } from '../../src/companion/store/project-store.ts';
import { parseProjectText, serializeProject } from '../../src/shared/schema/index.ts';
import { fixtureText } from '../helpers/fixtures.ts';

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

test('rejects invalid, unsupported and voiced projects before bundling or output', async t => {
  const { root, input, project } = await setup(t);
  const fake = fakeRenderer();
  await writeFile(input, '{"schemaVersion":2}');
  await assert.rejects(fake.service({ projectFile: input, workspaceRoot: root }), /proyecto/i);
  project.styleId = 'future-style';
  await writeFile(input, serializeProject(project));
  await assert.rejects(fake.service({ projectFile: input, workspaceRoot: root }), /style/i);
  project.styleId = 'stylized-3d';
  project.output.voiceMode = 'withVoice';
  await writeFile(input, serializeProject(project));
  await assert.rejects(fake.service({ projectFile: input, workspaceRoot: root }), /silencios/i);
  assert.equal(fake.bundles(), 0);
  assert.deepEqual(await readdir(root), [project.projectId]);
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
  await assert.rejects(pending, /encoder failed/);
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
