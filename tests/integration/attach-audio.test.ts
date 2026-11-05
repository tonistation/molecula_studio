import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rmdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ProjectStore } from '../../src/companion/store/project-store.ts';
import { createNodeFsOps, type FsOps } from '../../src/companion/store/fs-ops.ts';
import { AssetRejectedError, ConflictError, InvalidArgumentError, InvalidProjectError, ReadOnlyProjectError, StoreCommitError, UnsafePathError } from '../../src/companion/store/errors.ts';
import { bindingDigests, sha256Hex } from '../../src/shared/digests.ts';
import { emptyProject, serializeProject, validateProject } from '../../src/shared/schema/index.ts';
import type { Project, Scene, Word } from '../../src/shared/schema/types.ts';
import type { KitScene } from '../../src/shared/kit/types.ts';
import { wavBytes, mp3Bytes, pngBytes } from '../helpers/media.ts';

const source = { origin: 'user', license: 'CC0', attribution: 'Local test' } as const;
const words: Word[] = [{ text: 'Agua', startMs: 0, endMs: 500, emphasis: true }];

function scene(sceneId: string, startMs = 0, durationMs = 4000): Scene {
  return { sceneId, revision: 2, title: 'Agua', text: 'Agua', visualIntent: 'Un río',
    startMs, durationMs, visual: null, audio: null, words: [], mediaBindings: { audio: null, words: null } };
}

async function setup(t: test.TestContext, options: { fsOps?: FsOps; project?: Project } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'molecula-attach-'));
  let store = new ProjectStore({ workspaceRoot: root, fsOps: options.fsOps });
  await store.init();
  t.after(async () => { await store.close(); await rm(root, { recursive: true, force: true }); });
  const project = options.project ?? {
    ...emptyProject({ projectId: 'audio-test', now: '2026-11-05T12:00:00.000Z' }),
    scenes: [scene('first'), scene('second', 4000)],
    sources: [{ title: 'Referencia', url: 'https://example.com' }], cover: { headline: 'Agua' }, postText: 'Compartir',
  };
  project.output.durationMs = project.scenes.reduce((total, item) => total + item.durationMs, 0);
  await store.importProject({ text: serializeProject(project) });
  const dir = join(root, project.projectId);
  const snapshot = async () => ({ json: await readFile(join(dir, 'project.json'), 'utf8'), files: await readdir(join(dir, 'assets')),
    entries: await readdir(dir) });
  const attach = async (overrides: Partial<Parameters<ProjectStore['attachSceneAudio']>[0]> = {}) => {
    const current = await store.readProject(project.projectId);
    return store.attachSceneAudio({ projectId: project.projectId, sceneId: 'first', bytes: wavBytes({ durationMs: 1701 }),
      mimeType: 'audio/wav', source, words, expectedRevision: current.revision, expectedDigest: current.digest, ...overrides });
  };
  return { root, dir, project, snapshot, attach, get store() { return store; }, async reopen() {
    await store.close(); store = new ProjectStore({ workspaceRoot: root }); await store.init();
    return store.readProject(project.projectId);
  } };
}

async function assertBound(project: Project, index: number) {
  const expected = (await bindingDigests(project)).scenes[index]!;
  const actual = project.scenes[index]!.mediaBindings;
  assert.deepEqual(actual.audio, { inputDigest: expected.audioInputDigest, outputDigest: expected.audioOutputDigest });
  assert.deepEqual(actual.words, { inputDigest: expected.wordsInputDigest, outputDigest: expected.wordsOutputDigest });
}

test('attach persists inspected bytes, metadata, contiguous timing and current bindings across reopen/save', async (t) => {
  const env = await setup(t);
  const result = await env.attach();
  assert.equal(result.revision, 1);
  assert.equal(result.receipt.sync, 'confirmed');
  const opened = await env.reopen();
  const project = opened.project;
  assert.equal(project.revision, 1);
  assert.equal(project.scenes[0]!.revision, 3);
  assert.equal(project.scenes[0]!.durationMs, 2100);
  assert.equal(project.scenes[1]!.startMs, 2100);
  assert.equal(project.output.durationMs, 6100);
  assert.equal(project.output.voiceMode, 'withVoice');
  assert.deepEqual(project.scenes[0]!.words, words);
  assert.deepEqual(project.scenes[0]!.audio, { assetId: result.assetId, offsetMs: 0, gainDb: 0 });
  assert.deepEqual(project.sources, env.project.sources);
  assert.deepEqual(project.cover, env.project.cover);
  assert.equal(project.postText, env.project.postText);
  const asset = project.assets[0]!;
  assert.deepEqual(asset.source, source);
  assert.equal(asset.durationMs, 1701);
  assert.equal(asset.sha256, await sha256Hex(wavBytes({ durationMs: 1701 })));
  assert.equal(asset.byteLength, wavBytes({ durationMs: 1701 }).byteLength);
  assert.deepEqual(await readFile(join(env.dir, asset.path)), Buffer.from(wavBytes({ durationMs: 1701 })));
  assert.equal(validateProject(project).ok, true);
  await assertBound(project, 0);
  await env.store.saveProject({ projectId: project.projectId, project: { ...project, revision: 2 },
    expectedRevision: 1, expectedDigest: opened.digest, operationId: 'save-audio' });
  await assertBound((await env.reopen()).project, 0);
});

test('stale revision or disk digest rejects before any filesystem write', async (t) => {
  const fsOps = createNodeFsOps();
  const write = fsOps.writeFileExclusive;
  let writes = 0;
  fsOps.writeFileExclusive = async (...args) => { writes += 1; return write(...args); };
  const env = await setup(t, { fsOps });
  const current = await env.store.readProject(env.project.projectId);
  const before = await env.snapshot();
  writes = 0;
  await assert.rejects(env.attach({ expectedRevision: 99 }), (error: unknown) => error instanceof ConflictError && error.reason === 'revision');
  assert.equal(writes, 0);
  assert.deepEqual(await env.snapshot(), before);
  await writeFile(join(env.dir, 'project.json'), before.json + '\n');
  const external = await env.snapshot();
  await assert.rejects(env.attach({ expectedDigest: current.digest }), (error: unknown) => error instanceof ConflictError && error.reason === 'digest');
  assert.equal(writes, 0);
  assert.deepEqual(await env.snapshot(), external);
});

test('too-long padded audio and aggregate duration overflow leave disk unchanged', async (t) => {
  const fsOps = createNodeFsOps();
  const write = fsOps.writeFileExclusive;
  let writes = 0;
  fsOps.writeFileExclusive = async (...args) => { writes += 1; return write(...args); };
  const env = await setup(t, { fsOps });
  const before = await env.snapshot();
  writes = 0;
  await assert.rejects(env.attach({ bytes: wavBytes({ durationMs: 14701 }) }), AssetRejectedError);
  assert.equal(writes, 0);
  assert.deepEqual(await env.snapshot(), before);
  const current = (await env.store.readProject(env.project.projectId)).project;
  current.scenes = Array.from({ length: 5 }, (_, i) => scene(i === 0 ? 'first' : `s-${i}`, i * 12000, 12000));
  current.output.durationMs = 60000;
  current.revision += 1;
  await env.store.saveProject({ projectId: current.projectId, project: current, expectedRevision: 0, operationId: 'long-project' });
  const long = await env.snapshot();
  writes = 0;
  await assert.rejects(env.attach({ bytes: wavBytes({ durationMs: 13000 }) }), InvalidProjectError);
  assert.equal(writes, 0);
  assert.deepEqual(await env.snapshot(), long);
});

test('minimum duration is 1000ms and empty words have null binding', async (t) => {
  const env = await setup(t);
  await env.attach();
  await env.attach({ bytes: wavBytes({ durationMs: 1 }), words: [] });
  const { project } = await env.reopen();
  assert.equal(project.scenes[0]!.durationMs, 1000);
  assert.equal(project.scenes[0]!.mediaBindings.words, null);
  assert.equal(validateProject(project).ok, true);
});

test('MP3 is inspected and accepted at the exact padded 15-second boundary', async (t) => {
  const env = await setup(t);
  await env.attach({ bytes: wavBytes({ durationMs: 14700 }) });
  assert.equal((await env.reopen()).project.scenes[0]!.durationMs, 15000);
  const result = await env.attach({ mimeType: 'audio/mpeg', bytes: mp3Bytes(40) });
  const { project } = await env.reopen();
  assert.ok(project.assets[0]!.durationMs! > 1000);
  assert.equal(project.assets[0]!.path, `assets/${result.assetId}.mp3`);
  await assertBound(project, 0);
});

test('invalid media, source, words and scene ID do not publish files', async (t) => {
  const env = await setup(t);
  const before = await env.snapshot();
  for (const overrides of [
    { bytes: pngBytes(1, 1) }, { bytes: new Uint8Array() }, { mimeType: 'image/png' as 'audio/wav', bytes: pngBytes(1, 1) },
    { source: { ...source, license: '' } }, { words: [{ ...words[0]!, endMs: 2200 }] }, { sceneId: 'absent' },
  ]) {
    await assert.rejects(env.attach(overrides), (error: unknown) => error instanceof AssetRejectedError
      || error instanceof InvalidArgumentError || error instanceof InvalidProjectError);
    assert.deepEqual(await env.snapshot(), before);
  }
});

test('replacement deletes only unused old audio after commit and retains shared assets', async (t) => {
  const env = await setup(t);
  const first = await env.attach();
  const old = (await env.reopen()).project.assets[0]!;
  const second = await env.attach();
  assert.notEqual(first.assetId, second.assetId);
  assert.deepEqual((await env.snapshot()).files, [`${second.assetId}.wav`]);
  const current = await env.store.readProject(env.project.projectId);
  current.project.scenes[1]!.audio = { ...current.project.scenes[0]!.audio! };
  current.project.revision += 1;
  await env.store.saveProject({ projectId: current.project.projectId, project: current.project,
    expectedRevision: current.revision, expectedDigest: current.digest, operationId: 'share' });
  const third = await env.attach();
  assert.deepEqual((await env.snapshot()).files.sort(), [`${second.assetId}.wav`, `${third.assetId}.wav`].sort());
  assert.equal((await env.reopen()).project.assets.length, 2);
  await assert.rejects(readFile(join(env.dir, old.path)), { code: 'ENOENT' });
});

test('pre-commit failure cleans new bytes and preserves old audio/document', async (t) => {
  const fsOps = createNodeFsOps();
  const rename = fsOps.rename;
  let fail = false;
  fsOps.rename = async (from, to) => { if (fail && to.endsWith('/project.json')) throw new Error('Injected commit failure'); return rename(from, to); };
  const env = await setup(t, { fsOps });
  await env.attach();
  const before = await env.snapshot();
  fail = true;
  await assert.rejects(env.attach(), StoreCommitError);
  assert.deepEqual(await env.snapshot(), before);
  const asset = (await env.store.readProject(env.project.projectId)).project.assets[0]!;
  assert.deepEqual(await readFile(join(env.dir, asset.path)), Buffer.from(wavBytes({ durationMs: 1701 })));
});

test('asset publication sync failure cleans newly published asset without touching project', async (t) => {
  const fsOps = createNodeFsOps();
  const sync = fsOps.syncDir;
  let fail = false;
  fsOps.syncDir = async (path) => { if (fail && path.endsWith('/assets')) throw new Error('Injected sync failure'); return sync(path); };
  const env = await setup(t, { fsOps });
  const before = await env.snapshot();
  fail = true;
  await assert.rejects(env.attach(), StoreCommitError);
  assert.deepEqual(await env.snapshot(), before);
});

test('uncertain post-commit sync keeps both files and the published audio remains readable', async (t) => {
  const fsOps = createNodeFsOps();
  const sync = fsOps.syncDir;
  let calls = 0;
  let fail = false;
  fsOps.syncDir = async (path) => { if (fail && !path.endsWith('/assets') && ++calls === 2) throw new Error('Injected final sync failure'); return sync(path); };
  const env = await setup(t, { fsOps });
  await env.attach();
  fail = true;
  const result = await env.attach();
  assert.equal(result.receipt.sync, 'uncertain');
  assert.equal((await env.snapshot()).files.length, 2);
  const { project } = await env.reopen();
  assert.equal(project.assets.length, 1);
  await assertBound(project, 0);
  await env.store.readAsset(project.projectId, result.assetId);
});

test('external modification during asset write rejects and keeps external document and unrelated files', async (t) => {
  const fsOps = createNodeFsOps();
  const link = fsOps.link;
  let edit: (() => Promise<void>) | undefined;
  fsOps.link = async (from, to) => { await link(from, to); if (to.endsWith('.wav')) await edit?.(); };
  const env = await setup(t, { fsOps });
  const before = await env.snapshot();
  edit = async () => { await writeFile(join(env.dir, 'project.json'), before.json + '\n'); };
  await writeFile(join(env.dir, 'assets', 'user-owned.txt'), 'keep');
  await assert.rejects(env.attach(), ConflictError);
  assert.deepEqual((await env.snapshot()).files, ['user-owned.txt']);
  assert.equal((await env.snapshot()).json, before.json + '\n');
});

test('read-only project and symlinked asset directory are rejected without external writes', async (t) => {
  const env = await setup(t);
  const before = await env.snapshot();
  const raw = JSON.parse(before.json);
  raw.styleId = 'future-style';
  await writeFile(join(env.dir, 'project.json'), JSON.stringify(raw));
  await assert.rejects(env.attach(), ReadOnlyProjectError);
  await writeFile(join(env.dir, 'project.json'), before.json);
  const outside = await mkdtemp(join(tmpdir(), 'molecula-outside-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await rmdir(join(env.dir, 'assets'));
  await symlink(outside, join(env.dir, 'assets'));
  await assert.rejects(env.attach(), UnsafePathError);
  assert.deepEqual(await readdir(outside), []);
});

test('concurrent requests using the same revision have one winner', async (t) => {
  const env = await setup(t);
  const current = await env.store.readProject(env.project.projectId);
  const results = await Promise.allSettled([env.attach({ expectedRevision: current.revision, expectedDigest: current.digest }),
    env.attach({ expectedRevision: current.revision, expectedDigest: current.digest })]);
  assert.equal(results.filter((item) => item.status === 'fulfilled').length, 1);
  const failed = results.find((item) => item.status === 'rejected');
  assert.ok(failed?.status === 'rejected' && failed.reason instanceof ConflictError);
  assert.equal((await env.snapshot()).files.length, 1);
});

test('visual timing rescales proportionally including ordered camera collisions and interval endpoints', async (t) => {
  const env = await setup(t);
  const current = await env.store.readProject(env.project.projectId);
  const kit = JSON.parse(await readFile('docs/plan/examples/kit/sal-del-mar.json', 'utf8')) as KitScene;
  kit.objects[0]!.animations = [{ type: 'appear', startMs: 3999, endMs: 4000, easing: 'linear', params: {} }];
  for (const object of kit.objects.slice(1)) object.animations = [];
  kit.overlays = [{ type: 'counter', from: 0, to: 10, startMs: 1000, endMs: 3000, color: '#ffffff' }];
  kit.camera.keyframes = [0, 1, 2, 2000, 3999, 4000].map((atMs) => ({ atMs, position: [0, 2, 10], target: [0, 0, 0], fovDeg: 45 }));
  current.project.scenes[0]!.visual = kit;
  current.project.revision += 1;
  await env.store.saveProject({ projectId: current.project.projectId, project: current.project,
    expectedRevision: 0, operationId: 'visual' });
  await env.attach({ bytes: wavBytes({ durationMs: 500 }) });
  const project = (await env.reopen()).project;
  const visual = project.scenes[0]!.visual as KitScene;
  assert.equal(project.scenes[0]!.durationMs, 1000);
  assert.deepEqual(visual.camera.keyframes!.map((item) => item.atMs), [0, 1, 2, 500, 999, 1000]);
  assert.deepEqual(visual.objects[0]!.animations[0], { ...kit.objects[0]!.animations[0], startMs: 999, endMs: 1000 });
  assert.deepEqual(visual.overlays[0], { ...kit.overlays[0], startMs: 250, endMs: 750 });
  assert.deepEqual(visual.particles, kit.particles);
  assert.deepEqual(visual.environment, kit.environment);
  assert.equal(validateProject(project).ok, true);
  assert.deepEqual(project.scenes[1]!.visual, current.project.scenes[1]!.visual);
  await env.attach();
  const expanded = (await env.reopen()).project.scenes[0]!.visual as KitScene;
  assert.deepEqual(expanded.camera.keyframes!.map((item) => item.atMs), [0, 2, 4, 1050, 2098, 2100]);
  assert.deepEqual(expanded.overlays[0], { ...kit.overlays[0], startMs: 525, endMs: 1575 });
});

test('switching voice mode preserves valid other-scene bindings but never recertifies stale bindings', async (t) => {
  const env = await setup(t);
  await env.attach({ sceneId: 'second' });
  const current = await env.store.readProject(env.project.projectId);
  current.project.output.voiceMode = 'silent';
  const digest = (await bindingDigests(current.project)).scenes[1]!;
  current.project.scenes[1]!.mediaBindings.words = { inputDigest: digest.wordsInputDigest!, outputDigest: digest.wordsOutputDigest! };
  current.project.revision += 1;
  await env.store.saveProject({ projectId: current.project.projectId, project: current.project,
    expectedRevision: current.revision, operationId: 'silent' });
  await env.attach();
  let project = (await env.reopen()).project;
  await assertBound(project, 1);
  project.output.voiceMode = 'silent';
  project.scenes[1]!.text = 'Texto cambiado';
  const historical = structuredClone(project.scenes[1]!.mediaBindings);
  const revision = project.revision;
  project = { ...project, revision: revision + 1 };
  await env.store.saveProject({ projectId: project.projectId, project, expectedRevision: revision, operationId: 'stale' });
  await env.attach();
  assert.deepEqual((await env.reopen()).project.scenes[1]!.mediaBindings, historical);
});

test('a competing file at the allocated asset path is never overwritten or cleaned up', async (t) => {
  const fsOps = createNodeFsOps();
  const link = fsOps.link;
  let competingPath = '';
  fsOps.link = async (from, to) => {
    if (to.endsWith('.wav')) { competingPath = to; await writeFile(to, 'user-owned'); }
    return link(from, to);
  };
  const env = await setup(t, { fsOps });
  const before = await env.snapshot();
  await assert.rejects(env.attach(), StoreCommitError);
  assert.equal(await readFile(competingPath, 'utf8'), 'user-owned');
  assert.equal((await env.snapshot()).json, before.json);
});

test('post-rename verification failure retains the audio used by the published document', async (t) => {
  const fsOps = createNodeFsOps();
  const read = fsOps.readFile;
  const rename = fsOps.rename;
  let fail = false;
  let renamed = false;
  fsOps.rename = async (from, to) => { await rename(from, to); if (fail && to.endsWith('/project.json')) renamed = true; };
  fsOps.readFile = async (path) => { if (renamed && path.endsWith('/project.json')) { renamed = false; throw new Error('Injected verification failure'); } return read(path); };
  const env = await setup(t, { fsOps });
  await env.attach();
  fail = true;
  await assert.rejects(env.attach(), StoreCommitError);
  assert.equal((await env.snapshot()).files.length, 2);
  const { project } = await env.reopen();
  assert.equal(project.revision, 2);
  await assertBound(project, 0);
  await env.store.readAsset(project.projectId, project.scenes[0]!.audio!.assetId);
});

test('caller mutation while queued cannot change accepted bytes, words or source', async (t) => {
  const env = await setup(t);
  const current = await env.store.readProject(env.project.projectId);
  const bytes = wavBytes({ durationMs: 1701 });
  const mutableWords = structuredClone(words);
  const mutableSource: Project['assets'][number]['source'] = { ...source };
  const pending = env.store.attachSceneAudio({ projectId: env.project.projectId, sceneId: 'first',
    bytes, mimeType: 'audio/wav', words: mutableWords, source: mutableSource,
    expectedRevision: current.revision, expectedDigest: current.digest });
  bytes.fill(0); mutableWords[0]!.text = 'Mutado'; mutableSource.license = 'Mutada';
  await pending;
  const { project } = await env.reopen();
  assert.equal(project.assets[0]!.sha256, await sha256Hex(wavBytes({ durationMs: 1701 })));
  assert.deepEqual(project.scenes[0]!.words, words);
  assert.deepEqual(project.assets[0]!.source, source);
});

test('old audio replaced externally during commit is not deleted as owned content', async (t) => {
  const fsOps = createNodeFsOps();
  const rename = fsOps.rename;
  let oldPath: string | undefined;
  fsOps.rename = async (from, to) => {
    await rename(from, to);
    if (oldPath !== undefined && to.endsWith('/project.json')) await writeFile(oldPath, 'user replacement');
  };
  const env = await setup(t, { fsOps });
  await env.attach();
  const old = (await env.store.readProject(env.project.projectId)).project.assets[0]!;
  oldPath = join(env.dir, old.path);
  await env.attach();
  assert.equal(await readFile(oldPath, 'utf8'), 'user replacement');
  assert.equal((await env.reopen()).project.assets.length, 1);
});

test('an existing competing temporary file is not removed when exclusive creation fails', async (t) => {
  const fsOps = createNodeFsOps();
  const write = fsOps.writeFileExclusive;
  let competingPath = '';
  fsOps.writeFileExclusive = async (path, bytes) => {
    if (path.includes('/assets/.tmp-')) { competingPath = path; await writeFile(path, 'user temporary'); }
    return write(path, bytes);
  };
  const env = await setup(t, { fsOps });
  const before = await env.snapshot();
  await assert.rejects(env.attach(), StoreCommitError);
  assert.equal(await readFile(competingPath, 'utf8'), 'user temporary');
  assert.equal((await env.snapshot()).json, before.json);
});
