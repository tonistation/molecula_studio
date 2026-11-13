import test from 'node:test';
import assert from 'node:assert/strict';

import { cp, mkdtemp, readdir, readFile, rm, stat, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { emptyProject } from '../../../src/shared/schema/empty.ts';
import { serializeProject } from '../../../src/shared/schema/serialize.ts';
import { parseProjectText } from '../../../src/shared/schema/parse.ts';
import { sha256Hex } from '../../../src/shared/digests.ts';
import type { Asset, Project, Scene } from '../../../src/shared/schema/types.ts';
import {
  AssetNotFoundError,
  AssetRejectedError,
  ConflictError,
  InvalidProjectError,
  ProjectExistsError,
  ReadOnlyProjectError,
} from '../../../src/companion/store/errors.ts';
import { ProjectStore } from '../../../src/companion/store/project-store.ts';
import { createNodeFsOps } from '../../../src/companion/store/fs-ops.ts';
import { pngBytes, wavBytes } from '../../helpers/media.ts';

//#region helpers

const roots: string[] = [];

async function tempWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'molecula-import-'));
  roots.push(root);
  return root;
}

async function newStore(root: string): Promise<ProjectStore> {
  const store = new ProjectStore({ workspaceRoot: root });
  await store.init();
  return store;
}

test.after(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

const NOW = '2026-11-03T10:00:00.000Z';

function sceneWithAudio(assetId: string): Scene {
  return {
    sceneId: 's-voz',
    revision: 1,
    title: 'Escena con voz',
    startMs: 0,
    durationMs: 4000,
    text: 'El agua se evapora.',
    visualIntent: 'Salinas',
    visual: null,
    audio: { assetId, offsetMs: 0, gainDb: 0 },
    words: [],
    mediaBindings: { audio: null, words: null },
  };
}

function audioAsset(assetId: string, overrides: Partial<Asset> = {}): Asset {
  return {
    assetId,
    kind: 'audio',
    path: `assets/${assetId}.wav`,
    mimeType: 'audio/wav',
    byteLength: 1,
    sha256: null,
    durationMs: 2000,
    source: { origin: 'user', license: 'CC0 1.0', attribution: '' },
    ...overrides,
  };
}

/** Document used as the "external file" in import tests. */
function importable(args: { projectId: string; approval?: Project['approval']; styleId?: string } ): Project {
  const base = emptyProject({ projectId: args.projectId, now: NOW, title: 'Importado' });
  return {
    ...base,
    revision: args.approval === undefined ? 2 : 3,
    updatedAt: NOW,
    idea: 'Una idea que llegó de otro workspace',
    styleId: args.styleId ?? base.styleId,
    output: { ...base.output, durationMs: 4000 },
    scenes: [sceneWithAudio('voz')],
    assets: [audioAsset('voz')],
    approval: args.approval ?? null,
  };
}

const APPROVAL = {
  contentDigest: 'a'.repeat(64),
  approvedRevision: 2,
  approvedAt: NOW,
};

/** Creates a local project that already declares an audio asset with no file. */
async function projectWithMissingAudio(store: ProjectStore): Promise<string> {
  const created = await store.createProject({ title: 'Con voz' });
  const current = await store.readProject(created.projectId);
  const project: Project = {
    ...current.project,
    revision: 1,
    updatedAt: new Date(Date.parse(current.project.createdAt) + 1000).toISOString(),
    output: { ...current.project.output, durationMs: 4000 },
    scenes: [sceneWithAudio('voz')],
    assets: [audioAsset('voz')],
  };
  await store.saveProject({
    projectId: created.projectId,
    project,
    expectedRevision: 0,
    operationId: 'op-seed',
  });
  return created.projectId;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

//#endregion helpers

//#region import

test('import publishes a validated document and reports missing assets', async () => {
  const root = await tempWorkspace();
  const store = await newStore(root);
  try {
    const text = serializeProject(importable({ projectId: 'p-imported' }));
    const result = await store.importProject({ text });

    assert.equal(result.projectId, 'p-imported');
    assert.equal(result.revision, 2);
    assert.equal(result.mode, 'editable');
    assert.deepEqual(result.missingAssets, ['voz']);
    assert.equal(result.approvalCleared, false);
    assert.equal(result.importedAsCopy, false);
    assert.equal(result.receipt.sync, 'confirmed');

    const onDisk = parseProjectText(await readFile(join(root, 'p-imported', 'project.json')));
    assert.ok(onDisk.ok);
    assert.equal(onDisk.project.idea, 'Una idea que llegó de otro workspace');
    assert.equal(onDisk.project.scenes[0]?.audio?.assetId, 'voz');
    assert.equal(onDisk.project.assets[0]?.sha256, null);

    // The imported document is listed like any other project.
    const list = await store.listProjects();
    assert.deepEqual(
      list.map((entry) => entry.projectId),
      ['p-imported'],
    );
    assert.deepEqual(list[0]?.missingAssets, ['voz']);
  } finally {
    await store.close();
  }
});

test('import clears a foreign approval as a recorded edit with a notice', async () => {
  const root = await tempWorkspace();
  const store = await newStore(root);
  try {
    const text = serializeProject(importable({ projectId: 'p-approved', approval: APPROVAL }));
    const result = await store.importProject({ text });

    assert.equal(result.approvalCleared, true);
    assert.equal(result.revision, 4);

    const read = await store.readProject('p-approved');
    assert.equal(read.project.approval, null);
    assert.equal(read.project.revision, 4);
    assert.notEqual(read.project.updatedAt, NOW);
    // Media and bindings survive the approval clearing.
    assert.equal(read.project.assets.length, 1);
    assert.equal(read.project.scenes[0]?.audio?.assetId, 'voz');
  } finally {
    await store.close();
  }
});

test('import rejects hostile or invalid JSON without creating a project', async () => {
  const root = await tempWorkspace();
  const store = await newStore(root);
  try {
    const valid = serializeProject(importable({ projectId: 'p-hostile' }));

    await assert.rejects(
      store.importProject({ text: valid.replace('"schemaVersion": 2', '"schemaVersion": 4') }),
      (error: unknown) => error instanceof InvalidProjectError && error.failure === 'unsupported-version',
    );
    await assert.rejects(
      store.importProject({ text: valid.replace('"idea":', '"__proto__": {"polluted": true}, "idea":') }),
      (error: unknown) => error instanceof InvalidProjectError && error.failure === 'dangerous-key',
    );
    await assert.rejects(
      store.importProject({ text: '{"schemaVersion":1,"schemaVersion":1}' }),
      (error: unknown) => error instanceof InvalidProjectError && error.failure === 'duplicate-key',
    );
    await assert.rejects(
      store.importProject({ text: valid.replace('"title": "Importado"', '"title": ""') }),
      (error: unknown) => error instanceof InvalidProjectError && error.failure === 'invalid-schema',
    );
    await assert.rejects(
      store.importProject({ text: '{not json' }),
      (error: unknown) => error instanceof InvalidProjectError && error.failure === 'invalid-json',
    );

    assert.deepEqual(await store.listProjects(), []);
    assert.deepEqual((await readdir(root)).sort(), ['.companion.lock']);
  } finally {
    await store.close();
  }
});

test('an existing projectId is never overwritten: reject or import as copy', async () => {
  const root = await tempWorkspace();
  const store = await newStore(root);
  try {
    const created = await store.createProject({ title: 'Original' });
    const before = await readFile(join(root, created.projectId, 'project.json'));

    await assert.rejects(
      store.importProject({ text: serializeProject(importable({ projectId: created.projectId })) }),
      (error: unknown) => error instanceof ProjectExistsError && error.projectId === created.projectId,
    );
    assert.deepEqual(await readFile(join(root, created.projectId, 'project.json')), before);

    const copied = await store.importProject({
      text: serializeProject(importable({ projectId: created.projectId, approval: APPROVAL })),
      collision: 'copy',
    });
    assert.equal(copied.importedAsCopy, true);
    assert.notEqual(copied.projectId, created.projectId);
    assert.equal(copied.revision, 0);
    assert.equal(copied.approvalCleared, true);

    const copyRead = await store.readProject(copied.projectId);
    assert.equal(copyRead.project.projectId, copied.projectId);
    assert.equal(copyRead.project.revision, 0);
    assert.equal(copyRead.project.approval, null);
    assert.equal(copyRead.project.scenes[0]?.sceneId, 's-voz');

    // The original stays byte-identical.
    assert.deepEqual(await readFile(join(root, created.projectId, 'project.json')), before);
  } finally {
    await store.close();
  }
});

test('an unknown style imports read-only and keeps its visual payload verbatim', async () => {
  const root = await tempWorkspace();
  const store = await newStore(root);
  try {
    const payload = { templateId: 'future-style', nested: { shapes: [1, 2, 3] } };
    const document = importable({ projectId: 'p-future', styleId: 'future-style' });
    const text = serializeProject({
      ...document,
      styleVersion: 9,
      scenes: [{ ...document.scenes[0]!, visual: { inert: payload } as never }],
    });

    const result = await store.importProject({ text });
    assert.equal(result.mode, 'read-only');

    const read = await store.readProject('p-future');
    assert.equal(read.mode, 'read-only');
    assert.deepEqual(read.project.scenes[0]?.visual, { inert: payload });
    assert.deepEqual(JSON.parse(read.raw).scenes[0].visual, payload);
    assert.match(read.raw, /"templateId": "future-style"/);
    assert.match(read.raw, /"shapes": \[/);
  } finally {
    await store.close();
  }
});

test('unknown-style import does not revalidate the internal inert wrapper as source JSON', async () => {
  const root = await tempWorkspace();
  const store = await newStore(root);
  try {
    let payload: unknown = null;
    for (let depth = 0; depth < 13; depth += 1) payload = { child: payload };
    const document = importable({ projectId: 'p-inert-depth', styleId: 'future-style' });
    const text = serializeProject({ ...document, scenes: [{ ...document.scenes[0]!, visual: { inert: payload } as never }] });
    assert.equal(parseProjectText(text).ok, true, 'external payload is within the declared depth limit');
    await store.importProject({ text });
    assert.deepEqual(JSON.parse(await readFile(join(root, 'p-inert-depth', 'project.json'), 'utf8')).scenes[0].visual, payload);
  } finally { await store.close(); }
});

test('a portable folder carries assets into another workspace; JSON alone reports them missing', async () => {
  const rootA = await tempWorkspace();
  const rootB = await tempWorkspace();
  const storeA = await newStore(rootA);
  const storeB = await newStore(rootB);
  try {
    const projectId = await projectWithMissingAudio(storeA);
    await storeA.relinkAsset({ projectId, assetId: 'voz', bytes: wavBytes({ durationMs: 1200 }), mimeType: 'audio/wav' });
    const copy = await storeA.saveCopy({ projectId });

    // Simulate the user moving the portable folder into workspace B.
    await cp(join(rootA, copy.projectId), join(rootB, copy.projectId), { recursive: true });
    const opened = await storeB.readProject(copy.projectId);
    assert.deepEqual(opened.missingAssets, []);
    assert.equal(opened.project.assets[0]?.sha256, await sha256Hex(wavBytes({ durationMs: 1200 })));

    // Importing only the JSON into B reports the asset as missing, keeps the manifest.
    const json = await readFile(join(rootA, copy.projectId, 'project.json'), 'utf8');
    const imported = await storeB.importProject({
      text: json.replaceAll(copy.projectId, 'p-json-only'),
    });
    assert.deepEqual(imported.missingAssets, ['voz']);
    const jsonOnly = await storeB.readProject('p-json-only');
    assert.equal(jsonOnly.project.assets.length, 1);
    assert.equal(jsonOnly.project.assets[0]?.sha256, await sha256Hex(wavBytes({ durationMs: 1200 })));
  } finally {
    await storeA.close();
    await storeB.close();
  }
});

//#endregion import

//#region relink

test('relink restores a missing asset and records metadata from the real bytes', async () => {
  const root = await tempWorkspace();
  const store = await newStore(root);
  try {
    const projectId = await projectWithMissingAudio(store);
    const bytes = wavBytes({ durationMs: 1200 });

    const result = await store.relinkAsset({ projectId, assetId: 'voz', bytes, mimeType: 'audio/wav' });
    assert.equal(result.replaced, false);
    assert.equal(result.assetId, 'voz');
    assert.equal(result.revision, 2);
    assert.equal(result.receipt?.sync, 'confirmed');
    assert.deepEqual(result.missingAssets, []);
    assert.equal(result.asset.byteLength, bytes.byteLength);
    assert.equal(result.asset.sha256, await sha256Hex(bytes));
    assert.equal(result.asset.durationMs, 1200);

    assert.deepEqual(await readFile(join(root, projectId, 'assets', 'voz.wav')), Buffer.from(bytes));
    const read = await store.readProject(projectId);
    assert.equal(read.project.assets[0]?.durationMs, 1200);
    assert.equal(read.project.revision, 2);
  } finally {
    await store.close();
  }
});

test('relinking identical content restores the file without editing the document', async () => {
  const root = await tempWorkspace();
  const store = await newStore(root);
  try {
    const projectId = await projectWithMissingAudio(store);
    const bytes = wavBytes({ durationMs: 800 });
    const first = await store.relinkAsset({ projectId, assetId: 'voz', bytes, mimeType: 'audio/wav' });
    assert.equal(first.revision, 2);

    await unlink(join(root, projectId, 'assets', 'voz.wav'));
    const second = await store.relinkAsset({ projectId, assetId: 'voz', bytes, mimeType: 'audio/wav' });

    assert.equal(second.receipt, null);
    assert.equal(second.revision, 2);
    assert.equal(second.replaced, false);
    assert.deepEqual(second.missingAssets, []);
    assert.deepEqual(await readFile(join(root, projectId, 'assets', 'voz.wav')), Buffer.from(bytes));
    assert.equal((await store.readProject(projectId)).project.revision, 2);
  } finally {
    await store.close();
  }
});

test('different content requires explicit confirmation and mints a new assetId', async () => {
  const root = await tempWorkspace();
  const store = await newStore(root);
  try {
    const projectId = await projectWithMissingAudio(store);
    const original = wavBytes({ durationMs: 1000 });
    await store.relinkAsset({ projectId, assetId: 'voz', bytes: original, mimeType: 'audio/wav' });
    const before = await readFile(join(root, projectId, 'project.json'));

    const replacement = wavBytes({ durationMs: 3000 });
    await assert.rejects(
      store.relinkAsset({ projectId, assetId: 'voz', bytes: replacement, mimeType: 'audio/wav' }),
      (error: unknown) => error instanceof ConflictError && error.reason === 'asset-content',
    );
    // Nothing moved: same document bytes and same asset file.
    assert.deepEqual(await readFile(join(root, projectId, 'project.json')), before);
    assert.deepEqual(await readFile(join(root, projectId, 'assets', 'voz.wav')), Buffer.from(original));

    const confirmed = await store.relinkAsset({
      projectId,
      assetId: 'voz',
      bytes: replacement,
      mimeType: 'audio/wav',
      confirmReplace: true,
    });
    assert.equal(confirmed.replaced, true);
    assert.notEqual(confirmed.assetId, 'voz');
    assert.equal(confirmed.revision, 3);
    assert.equal(confirmed.asset.durationMs, 3000);

    const read = await store.readProject(projectId);
    assert.equal(read.project.assets[0]?.assetId, confirmed.assetId);
    assert.equal(read.project.scenes[0]?.audio?.assetId, confirmed.assetId);
    assert.equal(read.project.scenes[0]?.revision, 2);
    // Historical bindings are evidence, not something relink rewrites.
    assert.deepEqual(read.project.scenes[0]?.mediaBindings, { audio: null, words: null });
    assert.equal(await exists(join(root, projectId, 'assets', 'voz.wav')), false);
    assert.deepEqual(
      await readFile(join(root, projectId, 'assets', `${confirmed.assetId}.wav`)),
      Buffer.from(replacement),
    );
  } finally {
    await store.close();
  }
});

test('relink rejects wrong containers, corrupt files and unknown assets', async () => {
  const root = await tempWorkspace();
  const store = await newStore(root);
  try {
    const projectId = await projectWithMissingAudio(store);

    await assert.rejects(
      store.relinkAsset({ projectId, assetId: 'voz', bytes: pngBytes(10, 10), mimeType: 'audio/wav' }),
      (error: unknown) => error instanceof AssetRejectedError && error.reason === 'mime-mismatch',
    );
    await assert.rejects(
      store.relinkAsset({
        projectId,
        assetId: 'voz',
        bytes: new TextEncoder().encode('definitely not audio'),
        mimeType: 'audio/wav',
      }),
      (error: unknown) => error instanceof AssetRejectedError && error.reason === 'mime-mismatch',
    );
    await assert.rejects(
      store.relinkAsset({ projectId, assetId: 'nope', bytes: wavBytes(), mimeType: 'audio/wav' }),
      (error: unknown) => error instanceof AssetNotFoundError,
    );
    // Nothing was written by any rejected attempt.
    assert.deepEqual(await readdir(join(root, projectId, 'assets')), []);
  } finally {
    await store.close();
  }
});

test('relink refuses a read-only project and keeps the document untouched', async () => {
  const root = await tempWorkspace();
  const store = await newStore(root);
  try {
    const document = importable({ projectId: 'p-future', styleId: 'future-style' });
    await store.importProject({
      text: serializeProject({
        ...document,
        styleVersion: 9,
        scenes: [{ ...document.scenes[0]!, visual: { inert: { templateId: 'future' } } as never }],
      }),
    });
    const before = await readFile(join(root, 'p-future', 'project.json'));

    await assert.rejects(
      store.relinkAsset({ projectId: 'p-future', assetId: 'voz', bytes: wavBytes(), mimeType: 'audio/wav' }),
      (error: unknown) => error instanceof ReadOnlyProjectError,
    );
    assert.deepEqual(await readFile(join(root, 'p-future', 'project.json')), before);
  } finally {
    await store.close();
  }
});

//#endregion relink

test('identical restoration flushes the recreated assets entry in the project parent, including retries', async () => {
  const root = await tempWorkspace();
  const fsOps = createNodeFsOps();
  const calls: string[] = [];
  let failParent = false;
  let projectDir = '';
  const store = new ProjectStore({ workspaceRoot: root, fsOps: { ...fsOps,
    async syncDir(path) {
      calls.push(path);
      if (failParent && path === projectDir) throw new Error('parent sync failed');
      await fsOps.syncDir(path);
    },
  } });
  await store.init();
  try {
    const projectId = await projectWithMissingAudio(store);
    projectDir = await fsOps.realpath(join(root, projectId));
    await store.relinkAsset({ projectId, assetId: 'voz', bytes: wavBytes(), mimeType: 'audio/wav' });
    const before = await readFile(join(projectDir, 'project.json'));
    await rm(join(projectDir, 'assets'), { recursive: true });
    calls.length = 0;
    failParent = true;
    await assert.rejects(store.relinkAsset({ projectId, assetId: 'voz', bytes: wavBytes(), mimeType: 'audio/wav' }), /parent sync failed/);
    assert.ok(calls.indexOf(join(projectDir, 'assets')) < calls.indexOf(projectDir));
    assert.deepEqual(await readFile(join(projectDir, 'project.json')), before);
    // The bytes can already be visible after a failed sync; never claim rollback.
    assert.deepEqual(await readFile(join(projectDir, 'assets', 'voz.wav')), Buffer.from(wavBytes()));
    failParent = false;
    calls.length = 0;
    const result = await store.relinkAsset({ projectId, assetId: 'voz', bytes: wavBytes(), mimeType: 'audio/wav' });
    assert.equal(result.receipt, null);
    assert.ok(calls.includes(projectDir), 'retry also flushes a possibly unconfirmed directory entry');
  } finally { await store.close(); }
});

test('same-revision external JSON mutation conflicts on explicit relink digest before asset writes', async () => {
  const root = await tempWorkspace();
  const store = await newStore(root);
  try {
    const projectId = await projectWithMissingAudio(store);
    const snapshot = await store.readProject(projectId);
    const external = serializeProject({ ...snapshot.project, idea: 'Edited outside the companion' });
    await writeFile(join(root, projectId, 'project.json'), external);
    await assert.rejects(store.relinkAsset({ projectId, assetId: 'voz', bytes: wavBytes(), mimeType: 'audio/wav',
      expectedRevision: snapshot.revision, expectedDigest: snapshot.digest }),
      (error: unknown) => error instanceof ConflictError && error.reason === 'digest');
    assert.equal(await readFile(join(root, projectId, 'project.json'), 'utf8'), external);
    assert.deepEqual(await readdir(join(root, projectId, 'assets')), []);
  } finally { await store.close(); }
});

test('relink rechecks the snapshot after asynchronous inspection before writing any asset bytes', async () => {
  const root = await tempWorkspace();
  const fsOps = createNodeFsOps();
  let mutate: (() => Promise<void>) | undefined;
  const store = new ProjectStore({ workspaceRoot: root, fsOps: { ...fsOps,
    async lstat(path) {
      if (path.endsWith('/assets') && mutate !== undefined) {
        const apply = mutate;
        mutate = undefined;
        await apply();
      }
      return fsOps.lstat(path);
    },
  } });
  await store.init();
  try {
    const projectId = await projectWithMissingAudio(store);
    const snapshot = await store.readProject(projectId);
    const external = serializeProject({ ...snapshot.project, idea: 'Concurrent edit during inspection' });
    mutate = () => writeFile(join(root, projectId, 'project.json'), external);
    await assert.rejects(store.relinkAsset({ projectId, assetId: 'voz', bytes: wavBytes(), mimeType: 'audio/wav',
      expectedRevision: snapshot.revision, expectedDigest: snapshot.digest }),
      (error: unknown) => error instanceof ConflictError && error.reason === 'digest');
    assert.equal(await readFile(join(root, projectId, 'project.json'), 'utf8'), external);
    assert.deepEqual(await readdir(join(root, projectId, 'assets')), []);
  } finally { await store.close(); }
});

test('stale relink revision cannot change document or asset bytes', async () => {
  const root = await tempWorkspace();
  const store = await newStore(root);
  try {
    const projectId = await projectWithMissingAudio(store);
    const before = await readFile(join(root, projectId, 'project.json'));
    await assert.rejects(store.relinkAsset({ projectId, assetId: 'voz', bytes: wavBytes(), mimeType: 'audio/wav', expectedRevision: 0 }), { code: 'conflict' });
    assert.deepEqual(await readFile(join(root, projectId, 'project.json')), before);
    assert.deepEqual(await readdir(join(root, projectId, 'assets')), []);
  } finally { await store.close(); }
});

test('invalid relink metadata is rejected before touching existing bytes', async () => {
  const root = await tempWorkspace();
  const store = await newStore(root);
  try {
    const projectId = await projectWithMissingAudio(store);
    await store.relinkAsset({ projectId, assetId: 'voz', bytes: wavBytes(), mimeType: 'audio/wav' });
    const current = await store.readProject(projectId);
    const project = { ...current.project, revision: current.revision + 1,
      scenes: current.project.scenes.map((scene) => ({ ...scene, audio: { ...scene.audio!, offsetMs: 900 } })) };
    await store.saveProject({ projectId, project, expectedRevision: current.revision, operationId: 'op-offset' });
    const before = await readFile(join(root, projectId, 'project.json'));
    await assert.rejects(store.relinkAsset({ projectId, assetId: 'voz', bytes: wavBytes({ durationMs: 500 }), mimeType: 'audio/wav', confirmReplace: true }), InvalidProjectError);
    assert.deepEqual(await readFile(join(root, projectId, 'project.json')), before);
    assert.deepEqual(await readFile(join(root, projectId, 'assets', 'voz.wav')), Buffer.from(wavBytes()));
    assert.deepEqual(await readdir(join(root, projectId, 'assets')), ['voz.wav']);
  } finally { await store.close(); }
});

test('an unhashed existing file still requires confirmation before different bytes replace it', async () => {
  const root = await tempWorkspace();
  const store = await newStore(root);
  try {
    const projectId = await projectWithMissingAudio(store);
    await writeFile(join(root, projectId, 'assets', 'voz.wav'), wavBytes());
    await assert.rejects(store.relinkAsset({ projectId, assetId: 'voz', bytes: wavBytes({ durationMs: 800 }), mimeType: 'audio/wav' }), { code: 'conflict' });
    assert.deepEqual(await readFile(join(root, projectId, 'assets', 'voz.wav')), Buffer.from(wavBytes()));
  } finally { await store.close(); }
});

test('uncertain relink keeps the historical asset file for recovery', async () => {
  const root = await tempWorkspace();
  const fsOps = createNodeFsOps();
  let failSync = false;
  let documentPublished = false;
  const store = new ProjectStore({ workspaceRoot: root, fsOps: { ...fsOps,
    async rename(from, to) {
      await fsOps.rename(from, to);
      if (failSync && to.endsWith('/project.json')) documentPublished = true;
    },
    async syncDir(path) {
      if (failSync && documentPublished && !path.endsWith('/assets')) throw new Error('directory sync failed');
      await fsOps.syncDir(path);
    },
  } });
  await store.init();
  try {
    const projectId = await projectWithMissingAudio(store);
    await store.relinkAsset({ projectId, assetId: 'voz', bytes: wavBytes(), mimeType: 'audio/wav' });
    failSync = true;
    const result = await store.relinkAsset({ projectId, assetId: 'voz', bytes: wavBytes({ durationMs: 800 }), mimeType: 'audio/wav', confirmReplace: true });
    assert.equal(result.receipt?.sync, 'uncertain');
    assert.deepEqual(await readFile(join(root, projectId, 'assets', 'voz.wav')), Buffer.from(wavBytes()));
    assert.deepEqual(await readFile(join(root, projectId, result.asset.path)), Buffer.from(wavBytes({ durationMs: 800 })));
  } finally { await store.close(); }
});

test('failed document commit cleans only the newly staged replacement and preserves historical bindings', async () => {
  const root = await tempWorkspace();
  const fsOps = createNodeFsOps();
  let failCommit = false;
  const store = new ProjectStore({ workspaceRoot: root, fsOps: { ...fsOps,
    async rename(from, to) { if (failCommit && to.endsWith('/project.json')) throw new Error('rename failed'); await fsOps.rename(from, to); },
  } });
  await store.init();
  try {
    const projectId = await projectWithMissingAudio(store);
    await store.relinkAsset({ projectId, assetId: 'voz', bytes: wavBytes(), mimeType: 'audio/wav' });
    const current = await store.readProject(projectId);
    const historical = { inputDigest: 'a'.repeat(64), outputDigest: 'b'.repeat(64) };
    await store.saveProject({ projectId, project: { ...current.project, revision: current.revision + 1,
      scenes: current.project.scenes.map((scene) => ({ ...scene, mediaBindings: { audio: historical, words: null } })) },
      expectedRevision: current.revision, operationId: 'op-historical' });
    const before = await readFile(join(root, projectId, 'project.json'));
    failCommit = true;
    await assert.rejects(store.relinkAsset({ projectId, assetId: 'voz', bytes: wavBytes({ durationMs: 800 }), mimeType: 'audio/wav', confirmReplace: true }), /rename failed/);
    assert.deepEqual(await readFile(join(root, projectId, 'project.json')), before);
    assert.deepEqual(await readdir(join(root, projectId, 'assets')), ['voz.wav']);
    failCommit = false;
    await store.relinkAsset({ projectId, assetId: 'voz', bytes: wavBytes({ durationMs: 800 }), mimeType: 'audio/wav', confirmReplace: true });
    assert.deepEqual((await store.readProject(projectId)).project.scenes[0]?.mediaBindings.audio, historical);
  } finally { await store.close(); }
});

test('asset parent symlinks cannot leak files into copies or receive relink writes', async () => {
  const root = await tempWorkspace();
  const outside = await tempWorkspace();
  const store = await newStore(root);
  try {
    const projectId = await projectWithMissingAudio(store);
    await rm(join(root, projectId, 'assets'), { recursive: true });
    await writeFile(join(outside, 'voz.wav'), 'private canary');
    await symlink(outside, join(root, projectId, 'assets'));
    await assert.rejects(store.saveCopy({ projectId }), { code: 'unsafe-path' });
    await assert.rejects(store.relinkAsset({ projectId, assetId: 'voz', bytes: wavBytes(), mimeType: 'audio/wav' }), { code: 'unsafe-path' });
    assert.equal(await readFile(join(outside, 'voz.wav'), 'utf8'), 'private canary');
    assert.deepEqual(await readdir(outside), ['voz.wav']);
  } finally { await store.close(); }
});

test('import file fsync failure publishes nothing; post-publication sync is uncertain', async () => {
  const root = await tempWorkspace();
  const fsOps = createNodeFsOps();
  let failFile = true;
  const store = new ProjectStore({ workspaceRoot: root, fsOps: {
    ...fsOps,
    async syncFile(path) { if (failFile) throw new Error('disk sync failed'); await fsOps.syncFile(path); },
    async syncDir(path) { if (path === await fsOps.realpath(root)) throw new Error('directory sync failed'); await fsOps.syncDir(path); },
  } });
  await store.init();
  try {
    const text = serializeProject(importable({ projectId: 'p-sync' }));
    await assert.rejects(store.importProject({ text }), /disk sync failed/);
    assert.deepEqual(await store.listProjects(), []);
    failFile = false;
    const result = await store.importProject({ text });
    assert.equal(result.receipt.sync, 'uncertain');
    assert.equal((await store.verifyReceipt({ projectId: result.projectId, receipt: result.receipt })).confirmed, true);
  } finally { await store.close(); }
});
