import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseProjectText } from '../../../src/shared/schema/parse.ts';
import { serializeProject } from '../../../src/shared/schema/serialize.ts';
import { emptyProject } from '../../../src/shared/schema/empty.ts';
import { LIMITS } from '../../../src/shared/schema/limits.ts';
import type { Project } from '../../../src/shared/schema/types.ts';
import { pngBytes, wavBytes } from '../../helpers/media.ts';
import { startCompanionServer, type CompanionServer } from '../../../src/companion/server/http.ts';

//#region helpers

const TOKEN = 'test-session-token';
const roots: string[] = [];

test('unknown project suffix never aliases a project read or write', async () => {
  await withServer(async ({ handle }) => {
    const created = await handle.store.createProject();
    for (const suffix of ['arbitrary', 'copy/extra', 'assets']) {
      const response = await request(handle, 'GET', `/api/projects/${created.projectId}/${suffix}`);
      assert.equal(response.status, 404, suffix);
    }
  });
});

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'molecula-server-'));
  roots.push(root);
  return root;
}

interface ServerFixture {
  handle: CompanionServer;
  workspace: string;
  studio: string;
}

async function withServer(run: (fixture: ServerFixture) => Promise<void>): Promise<void> {
  const workspace = await tempRoot();
  const studio = await tempRoot();
  await writeFile(join(studio, 'index.html'), '<!doctype html><html><head><title>Studio</title></head><body><div id="root"></div></body></html>');
  await writeFile(join(studio, 'app.js'), 'console.log("studio");');
  await writeFile(join(studio, 'data.txt'), 'not a served type');

  const handle = await startCompanionServer({ workspaceRoot: workspace, studioDir: studio, token: TOKEN });
  try {
    await run({ handle, workspace, studio });
  } finally {
    await handle.close();
  }
}

interface RequestOptions {
  token?: string | null;
  origin?: string | null;
  host?: string;
  body?: unknown;
  rawBody?: string;
  bodyBytes?: Uint8Array;
  contentType?: string;
  headers?: Record<string, string>;
}

interface RawResponse {
  status: number;
  headers: IncomingHttpHeaders;
  text: string;
  bytes: Buffer;
}

function request(
  handle: CompanionServer,
  method: string,
  path: string,
  options: RequestOptions = {},
): Promise<RawResponse> {
  const headers: Record<string, string> = {
    host: options.host ?? `127.0.0.1:${handle.port}`,
    ...options.headers,
  };
  const token = options.token === undefined ? TOKEN : options.token;
  if (token !== null) headers.authorization = `Bearer ${token}`;
  if (options.origin !== null) headers.origin = options.origin ?? handle.origin;

  let payload: string | Uint8Array | undefined;
  if (options.bodyBytes !== undefined) {
    payload = options.bodyBytes;
    headers['content-type'] = options.contentType ?? 'application/octet-stream';
  } else if (options.rawBody !== undefined) {
    payload = options.rawBody;
    headers['content-type'] = options.contentType ?? 'application/json';
  } else if (options.body !== undefined) {
    payload = JSON.stringify(options.body);
    headers['content-type'] = options.contentType ?? 'application/json';
  }
  if (payload !== undefined) {
    headers['content-length'] = String(typeof payload === 'string' ? Buffer.byteLength(payload) : payload.byteLength);
  }

  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: '127.0.0.1', port: handle.port, method, path, headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            text: Buffer.concat(chunks).toString('utf8'),
            bytes: Buffer.concat(chunks),
          });
        });
      },
    );
    req.on('error', reject);
    req.end(payload);
  });
}

function jsonOf<T>(response: RawResponse): T {
  return JSON.parse(response.text) as T;
}

function edited(base: Project, mutate: (p: Project) => void): Project {
  const cloned = structuredClone(base) as Project;
  mutate(cloned);
  cloned.updatedAt = new Date(new Date(base.createdAt).getTime() + 1000).toISOString();
  return cloned;
}

//#endregion helpers

test.after(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

test('every API request requires the ephemeral token', async () => {
  await withServer(async ({ handle }) => {
    const missing = await request(handle, 'GET', '/api/health', { token: null });
    assert.equal(missing.status, 401);
    assert.equal(jsonOf<{ error: { code: string } }>(missing).error.code, 'unauthorized');

    const wrong = await request(handle, 'GET', '/api/health', { token: 'wrong-token' });
    assert.equal(wrong.status, 401);

    const ok = await request(handle, 'GET', '/api/health');
    assert.equal(ok.status, 200);
    assert.equal(jsonOf<{ ok: boolean }>(ok).ok, true);
  });
});

test('foreign Origin and foreign Host are rejected (no DNS rebinding, no CSRF)', async () => {
  await withServer(async ({ handle }) => {
    const foreignOrigin = await request(handle, 'POST', '/api/projects', {
      origin: 'http://evil.example',
      body: {},
    });
    assert.equal(foreignOrigin.status, 403);
    assert.equal(jsonOf<{ error: { code: string } }>(foreignOrigin).error.code, 'origin-not-allowed');

    const noOrigin = await request(handle, 'POST', '/api/projects', { origin: null, body: {} });
    assert.equal(noOrigin.status, 403);
    assert.equal(jsonOf<{ error: { code: string } }>(noOrigin).error.code, 'origin-required');

    const foreignHost = await request(handle, 'GET', '/api/health', { host: 'evil.example' });
    assert.equal(foreignHost.status, 403);
    assert.equal(jsonOf<{ error: { code: string } }>(foreignHost).error.code, 'host-not-allowed');

    // GET with an allowed origin (same origin) still works.
    const sameOrigin = await request(handle, 'GET', '/api/projects');
    assert.equal(sameOrigin.status, 200);
  });
});

test('create, list, read and save roundtrip over loopback with real files', async () => {
  await withServer(async ({ handle, workspace }) => {
    const created = await request(handle, 'POST', '/api/projects', { body: { title: 'El viaje de la sal' } });
    assert.equal(created.status, 201);
    const createBody = jsonOf<{ projectId: string; revision: number; digest: string; project: Project }>(created);
    assert.equal(createBody.revision, 0);
    assert.ok(createBody.projectId.startsWith('p-'));

    const onDisk = await readFile(join(workspace, createBody.projectId, 'project.json'));
    const parsed = parseProjectText(onDisk);
    assert.ok(parsed.ok && parsed.project.title === 'El viaje de la sal');

    const list = await request(handle, 'GET', '/api/projects');
    const listBody = jsonOf<{ projects: Array<{ projectId: string; revision: number; mode: string }> }>(list);
    assert.equal(listBody.projects.length, 1);
    assert.equal(listBody.projects[0]?.projectId, createBody.projectId);
    assert.equal(listBody.projects[0]?.mode, 'editable');

    const read = await request(handle, 'GET', `/api/projects/${createBody.projectId}`);
    const readBody = jsonOf<{ project: Project; digest: string }>(read);
    assert.equal(readBody.digest, createBody.digest);

    const draft = edited(readBody.project, (p) => {
      p.revision = 1;
      p.idea = 'Explicar cómo llega la sal a nuestra mesa';
    });
    const saveBody = { project: draft, expectedRevision: 0, operationId: 'op-http-save' };
    const saved = await request(handle, 'PUT', `/api/projects/${createBody.projectId}`, { body: saveBody });
    assert.equal(saved.status, 200);
    const savedBody = jsonOf<{ revision: number; digest: string; receipt: { sync: string } }>(saved);
    assert.equal(savedBody.revision, 1);
    assert.equal(savedBody.receipt.sync, 'confirmed');

    const persisted = parseProjectText(await readFile(join(workspace, createBody.projectId, 'project.json')));
    assert.ok(persisted.ok && persisted.project.idea === 'Explicar cómo llega la sal a nuestra mesa');

    // Idempotent replay returns the identical receipt and digest.
    const replay = await request(handle, 'PUT', `/api/projects/${createBody.projectId}`, { body: saveBody });
    assert.equal(replay.status, 200);
    assert.equal(jsonOf<{ digest: string }>(replay).digest, savedBody.digest);

    // A stale writer conflicts instead of overwriting.
    const stale = await request(handle, 'PUT', `/api/projects/${createBody.projectId}`, {
      body: { project: edited(readBody.project, (p) => { p.revision = 1; }), expectedRevision: 0, operationId: 'op-stale' },
    });
    assert.equal(stale.status, 409);
    const conflict = jsonOf<{ error: { code: string; reason: string } }>(stale);
    assert.equal(conflict.error.code, 'conflict');
    assert.equal(conflict.error.reason, 'revision');
  });
});

test('copy endpoint publishes a portable project with a fresh identity', async () => {
  await withServer(async ({ handle, workspace }) => {
    const created = await request(handle, 'POST', '/api/projects', { body: { title: 'Copia' } });
    const sourceId = jsonOf<{ projectId: string }>(created).projectId;

    const copied = await request(handle, 'POST', `/api/projects/${sourceId}/copy`, { body: {} });
    assert.equal(copied.status, 201);
    const copyBody = jsonOf<{ projectId: string; revision: number; missingAssets: string[] }>(copied);
    assert.notEqual(copyBody.projectId, sourceId);
    assert.equal(copyBody.revision, 0);
    assert.deepEqual(copyBody.missingAssets, []);

    const copiedDoc = parseProjectText(await readFile(join(workspace, copyBody.projectId, 'project.json')));
    assert.ok(copiedDoc.ok && copiedDoc.project.projectId === copyBody.projectId);
  });
});

test('traversal-shaped handles never reach the filesystem', async () => {
  await withServer(async ({ handle }) => {
    const encoded = await request(handle, 'GET', '/api/projects/..%2f..%2fetc');
    assert.equal(encoded.status, 404);

    const upper = await request(handle, 'GET', '/api/projects/p-A-upper');
    assert.equal(upper.status, 404);

    const created = await request(handle, 'POST', '/api/projects', { body: {} });
    const projectId = jsonOf<{ projectId: string }>(created).projectId;
    const traversalOperation = await request(handle, 'PUT', `/api/projects/${projectId}`, {
      body: { project: {}, expectedRevision: 0, operationId: '../escape' },
    });
    assert.equal(traversalOperation.status, 400);
    assert.equal(jsonOf<{ error: { code: string } }>(traversalOperation).error.code, 'invalid-operation-id');
  });
});

test('request bodies are bounded and typed', async () => {
  await withServer(async ({ handle }) => {
    const wrongType = await request(handle, 'POST', '/api/projects', {
      rawBody: '{"title":"x"}',
      contentType: 'text/plain',
    });
    assert.equal(wrongType.status, 415);

    const broken = await request(handle, 'POST', '/api/projects', { rawBody: '{"title":' });
    assert.equal(broken.status, 400);
    assert.equal(jsonOf<{ error: { code: string } }>(broken).error.code, 'invalid-json');

    const huge = await request(handle, 'POST', '/api/projects', {
      rawBody: JSON.stringify({ title: 'x'.repeat(2 * 1024 * 1024 + 128 * 1024) }),
    });
    assert.equal(huge.status, 413);

    const notObject = await request(handle, 'POST', '/api/projects', { rawBody: '"just a string"' });
    assert.equal(notObject.status, 400);
  });
});

test('invalid schema payloads are reported without touching disk', async () => {
  await withServer(async ({ handle, workspace }) => {
    const created = await request(handle, 'POST', '/api/projects', { body: {} });
    const projectId = jsonOf<{ projectId: string }>(created).projectId;
    const before = await readFile(join(workspace, projectId, 'project.json'));

    const broken = await request(handle, 'PUT', `/api/projects/${projectId}`, {
      body: { project: { schemaVersion: 1, projectId }, expectedRevision: 0, operationId: 'op-broken' },
    });
    assert.equal(broken.status, 422);
    assert.equal(jsonOf<{ error: { code: string } }>(broken).error.code, 'invalid-project');

    assert.deepEqual(await readFile(join(workspace, projectId, 'project.json')), before);
  });
});

test('the studio build is served with CSP and an injected token; escapes are refused', async () => {
  await withServer(async ({ handle, studio }) => {
    const index = await request(handle, 'GET', '/');
    assert.equal(index.status, 200);
    assert.match(String(index.headers['content-security-policy'] ?? ''), /default-src 'self'/);
    assert.match(String(index.headers['content-security-policy']), /media-src 'self' blob:/);
    assert.match(String(index.headers['content-security-policy']), /script-src 'self';/);
    assert.doesNotMatch(String(index.headers['content-security-policy']), /unsafe-inline|unsafe-eval|https:|\*/);
    assert.match(index.text, new RegExp(`<meta name="companion-token" content="${TOKEN}">`));
    assert.equal(index.headers['access-control-allow-origin'], undefined);

    const head = await request(handle, 'HEAD', '/');
    assert.equal(head.status, 200);
    assert.equal(head.text, '');

    const script = await request(handle, 'GET', '/app.js');
    assert.equal(script.status, 200);
    assert.match(script.headers['content-type'] ?? '', /text\/javascript/);
    assert.equal(script.text, 'console.log("studio");');

    // Unknown extensions and traversal never serve arbitrary files.
    const unknown = await request(handle, 'GET', '/data.txt');
    assert.equal(unknown.status, 404);

    const outside = await tempRoot();
    await writeFile(join(outside, 'secret.js'), 'secret();');
    await symlink(join(outside, 'secret.js'), join(studio, 'link.js'));
    const viaSymlink = await request(handle, 'GET', '/link.js');
    assert.equal(viaSymlink.status, 404);

    const traversal = await request(handle, 'GET', '/%2e%2e/%2e%2e/etc/passwd');
    assert.equal(traversal.status, 404);

    const foreignOrigin = await request(handle, 'GET', '/', { origin: 'http://evil.example' });
    assert.equal(foreignOrigin.status, 403);
  });
});

test('unknown endpoints and methods are refused', async () => {
  await withServer(async ({ handle }) => {
    const unknown = await request(handle, 'GET', '/api/unknown');
    assert.equal(unknown.status, 404);

    const badMethod = await request(handle, 'DELETE', '/api/projects');
    assert.equal(badMethod.status, 405);
    assert.match(String(badMethod.headers.allow ?? ''), /GET/);
  });
});

//#region import and relink

/** Document with one audio asset declared but no file, used by relink tests. */
function importableText(projectId: string): string {
  const base = emptyProject({ projectId, now: '2026-11-03T10:00:00.000Z', title: 'Importado' });
  const project: Project = {
    ...base,
    revision: 1,
    updatedAt: '2026-11-03T10:00:01.000Z',
    idea: 'Llegó por HTTP',
    output: { ...base.output, durationMs: 4000 },
    scenes: [
      {
        sceneId: 's-voz',
        revision: 1,
        title: 'Escena',
        startMs: 0,
        durationMs: 4000,
        text: 'Texto',
        visualIntent: '',
        visual: null,
        audio: { assetId: 'voz', offsetMs: 0, gainDb: 0 },
        words: [],
        mediaBindings: { audio: null, words: null },
      },
    ],
    assets: [
      {
        assetId: 'voz',
        kind: 'audio',
        path: 'assets/voz.wav',
        mimeType: 'audio/wav',
        byteLength: 1,
        sha256: null,
        durationMs: 2000,
        source: { origin: 'user', license: 'CC0 1.0', attribution: '' },
      },
    ],
  };
  return serializeProject(project);
}

test('import endpoint validates, publishes and reports collisions without overwriting', async () => {
  await withServer(async ({ handle, workspace }) => {
    const text = importableText('p-http-import');
    const imported = await request(handle, 'POST', '/api/imports', { body: { text } });
    assert.equal(imported.status, 201);
    const importedBody = jsonOf<{
      projectId: string;
      revision: number;
      missingAssets: string[];
      approvalCleared: boolean;
      mode: string;
    }>(imported);
    assert.equal(importedBody.projectId, 'p-http-import');
    assert.equal(importedBody.revision, 1);
    assert.deepEqual(importedBody.missingAssets, ['voz']);
    assert.equal(importedBody.approvalCleared, false);
    assert.equal(importedBody.mode, 'editable');

    const onDisk = parseProjectText(await readFile(join(workspace, 'p-http-import', 'project.json')));
    assert.ok(onDisk.ok && onDisk.project.idea === 'Llegó por HTTP');

    // Same projectId: refused, existing bytes intact.
    const before = await readFile(join(workspace, 'p-http-import', 'project.json'));
    const collision = await request(handle, 'POST', '/api/imports', { body: { text } });
    assert.equal(collision.status, 409);
    const collisionBody = jsonOf<{ error: { code: string; projectId: string } }>(collision);
    assert.equal(collisionBody.error.code, 'project-exists');
    assert.equal(collisionBody.error.projectId, 'p-http-import');
    assert.deepEqual(await readFile(join(workspace, 'p-http-import', 'project.json')), before);

    // Explicit copy publishes a fresh identity.
    const copied = await request(handle, 'POST', '/api/imports', { body: { text, collision: 'copy' } });
    assert.equal(copied.status, 201);
    const copiedBody = jsonOf<{ projectId: string; importedAsCopy: boolean; revision: number }>(copied);
    assert.equal(copiedBody.importedAsCopy, true);
    assert.notEqual(copiedBody.projectId, 'p-http-import');
    assert.equal(copiedBody.revision, 0);

    // Invalid and hostile documents are refused with the parser failure.
    const unsupported = await request(handle, 'POST', '/api/imports', {
      body: { text: text.replace('"schemaVersion": 2', '"schemaVersion": 4') },
    });
    assert.equal(unsupported.status, 422);
    const unsupportedBody = jsonOf<{ error: { code: string; failure: string } }>(unsupported);
    assert.equal(unsupportedBody.error.code, 'invalid-project');
    assert.equal(unsupportedBody.error.failure, 'unsupported-version');

    const notString = await request(handle, 'POST', '/api/imports', { body: { text: 42 } });
    assert.equal(notString.status, 400);

    const missingOrigin = await request(handle, 'POST', '/api/imports', { origin: null, body: { text } });
    assert.equal(missingOrigin.status, 403);
  });
});

test('import JSON escaping overhead does not reduce the exact source byte limit', async () => {
  await withServer(async ({ handle }) => {
    const source = serializeProject(emptyProject({ projectId: 'p-limit', now: '2026-11-01T00:00:00.000Z' }));
    const text = source + '\n'.repeat(LIMITS.maxJsonBytes - Buffer.byteLength(source));
    assert.equal((await request(handle, 'POST', '/api/imports', { body: { text } })).status, 201);
    const oversized = await request(handle, 'POST', '/api/imports', { body: { text: text + '\n' } });
    assert.equal(oversized.status, 422);
    assert.equal(jsonOf<{ error: { failure: string } }>(oversized).error.failure, 'too-large');
  });
});

test('relink uploads raw asset bytes with inspection and explicit replacement', async () => {
  await withServer(async ({ handle, workspace }) => {
    const text = importableText('p-relink');
    assert.equal((await request(handle, 'POST', '/api/imports', { body: { text } })).status, 201);

    // Wrong content type for the asset route.
    const wrongType = await request(handle, 'PUT', '/api/projects/p-relink/assets/voz', {
      bodyBytes: wavBytes(),
      contentType: 'application/json',
    });
    assert.equal(wrongType.status, 415);

    // Content that does not match the declared container.
    const wrongContainer = await request(handle, 'PUT', '/api/projects/p-relink/assets/voz', {
      bodyBytes: pngBytes(10, 10),
      contentType: 'audio/wav',
    });
    assert.equal(wrongContainer.status, 415);
    const wrongContainerBody = jsonOf<{ error: { code: string; reason: string } }>(wrongContainer);
    assert.equal(wrongContainerBody.error.code, 'asset-rejected');
    assert.equal(wrongContainerBody.error.reason, 'mime-mismatch');

    // Real wav bytes: duration comes from headers, not from the manifest.
    const bytes = wavBytes({ durationMs: 1200 });
    const stale = await request(handle, 'PUT', '/api/projects/p-relink/assets/voz', {
      bodyBytes: bytes, contentType: 'audio/wav', headers: { 'x-expected-revision': '0' },
    });
    assert.equal(stale.status, 409);
    const relinked = await request(handle, 'PUT', '/api/projects/p-relink/assets/voz', {
      bodyBytes: bytes,
      contentType: 'audio/wav',
    });
    assert.equal(relinked.status, 200);
    const relinkedBody = jsonOf<{
      assetId: string;
      replaced: boolean;
      revision: number;
      missingAssets: string[];
      asset: { sha256: string; durationMs: number };
    }>(relinked);
    assert.equal(relinkedBody.assetId, 'voz');
    assert.equal(relinkedBody.replaced, false);
    assert.equal(relinkedBody.revision, 2);
    assert.deepEqual(relinkedBody.missingAssets, []);
    assert.equal(relinkedBody.asset.durationMs, 1200);
    assert.deepEqual(await readFile(join(workspace, 'p-relink', 'assets', 'voz.wav')), Buffer.from(bytes));

    // Different content needs an explicit confirmation header.
    const replacement = wavBytes({ durationMs: 3000 });
    const refused = await request(handle, 'PUT', '/api/projects/p-relink/assets/voz', {
      bodyBytes: replacement,
      contentType: 'audio/wav',
    });
    assert.equal(refused.status, 409);
    const refusedBody = jsonOf<{ error: { reason: string; assetId: string } }>(refused);
    assert.equal(refusedBody.error.reason, 'asset-content');
    assert.equal(refusedBody.error.assetId, 'voz');

    const confirmed = await request(handle, 'PUT', '/api/projects/p-relink/assets/voz', {
      bodyBytes: replacement,
      contentType: 'audio/wav',
      headers: { 'x-confirm-replace': '1' },
    });
    assert.equal(confirmed.status, 200);
    const confirmedBody = jsonOf<{ assetId: string; replaced: boolean; revision: number }>(confirmed);
    assert.equal(confirmedBody.replaced, true);
    assert.notEqual(confirmedBody.assetId, 'voz');
    assert.equal(confirmedBody.revision, 3);

    const read = await request(handle, 'GET', '/api/projects/p-relink');
    const readBody = jsonOf<{ project: Project }>(read);
    assert.equal(readBody.project.scenes[0]?.audio?.assetId, confirmedBody.assetId);
    assert.equal(readBody.project.assets[0]?.assetId, confirmedBody.assetId);

    const unknown = await request(handle, 'PUT', '/api/projects/p-relink/assets/nope', {
      bodyBytes: wavBytes(),
      contentType: 'audio/wav',
    });
    assert.equal(unknown.status, 404);
    assert.equal(jsonOf<{ error: { code: string } }>(unknown).error.code, 'asset-not-found');

    const noAssetId = await request(handle, 'PUT', '/api/projects/p-relink/assets', {
      bodyBytes: wavBytes(),
      contentType: 'audio/wav',
    });
    assert.equal(noAssetId.status, 404);
  });
});

test('relink digest guard rejects same-revision external edits over HTTP before writing assets', async () => {
  await withServer(async ({ handle, workspace }) => {
    await handle.store.importProject({ text: importableText('p-digest') });
    const snapshot = await handle.store.readProject('p-digest');
    const external = serializeProject({ ...snapshot.project, idea: 'External edit at the same revision' });
    await writeFile(join(workspace, 'p-digest', 'project.json'), external);
    const args = { bodyBytes: wavBytes(), contentType: 'audio/wav',
      headers: { 'x-expected-revision': String(snapshot.revision), 'x-expected-digest': snapshot.digest } };
    const conflict = await request(handle, 'PUT', '/api/projects/p-digest/assets/voz', args);
    assert.equal(conflict.status, 409);
    assert.equal(jsonOf<{ error: { reason: string } }>(conflict).error.reason, 'digest');
    assert.equal(await readFile(join(workspace, 'p-digest', 'project.json'), 'utf8'), external);
    const fresh = await handle.store.readProject('p-digest');
    assert.deepEqual(fresh.missingAssets, ['voz']);
    const invalid = await request(handle, 'PUT', '/api/projects/p-digest/assets/voz', {
      ...args, headers: { ...args.headers, 'x-expected-digest': 'invalid' },
    });
    assert.equal(invalid.status, 400);
    const accepted = await request(handle, 'PUT', '/api/projects/p-digest/assets/voz', {
      ...args, headers: { ...args.headers, 'x-expected-digest': fresh.digest },
    });
    assert.equal(accepted.status, 200);
  });
});

test('relink rejects an image whose decoded header bound exceeds 100 MiB without changing disk', async () => {
  await withServer(async ({ handle, workspace }) => {
    const project = emptyProject({ projectId: 'p-rgba16', now: '2026-11-01T00:00:00.000Z' });
    project.assets = [{ assetId: 'image', kind: 'image', mimeType: 'image/png', path: 'assets/image.png',
      byteLength: 1, sha256: null, durationMs: null, source: { origin: 'user', license: 'CC0', attribution: '' } }];
    await handle.store.importProject({ text: serializeProject(project) });
    const before = await readFile(join(workspace, project.projectId, 'project.json'));
    const png = pngBytes(4000, 4000);
    png[24] = 16;
    const response = await request(handle, 'PUT', '/api/projects/p-rgba16/assets/image', { bodyBytes: png, contentType: 'image/png' });
    assert.equal(response.status, 422);
    assert.equal(jsonOf<{ error: { reason: string } }>(response).error.reason, 'decoded-too-large');
    assert.deepEqual(await readFile(join(workspace, project.projectId, 'project.json')), before);
    assert.deepEqual((await handle.store.readProject(project.projectId)).missingAssets, ['image']);
  });
});

//#endregion import and relink

test('preview assets require authentication and serve only declared bytes matching the manifest', async () => {
  await withServer(async ({ handle, workspace }) => {
    const projectId = 'p-preview';
    await handle.store.importProject({ text: importableText(projectId) });
    const path = `/api/projects/${projectId}/assets/voz`;
    assert.equal((await request(handle, 'GET', path, { token: null })).status, 401);
    assert.equal((await request(handle, 'GET', path, { token: 'wrong' })).status, 401);
    assert.equal((await request(handle, 'GET', path, { origin: 'http://evil.example' })).status, 403);
    assert.equal((await request(handle, 'GET', path, { host: 'evil.example' })).status, 403);
    assert.equal((await request(handle, 'GET', path)).status, 404, 'declared file is missing');
    const bytes = wavBytes({ durationMs: 1200 });
    await handle.store.relinkAsset({ projectId, assetId: 'voz', bytes, mimeType: 'audio/wav' });
    const before = await readFile(join(workspace, projectId, 'project.json'));
    const response = await request(handle, 'GET', path, { origin: null });
    assert.equal(response.status, 200);
    assert.deepEqual(response.bytes, Buffer.from(bytes));
    const { project } = await handle.store.readProject(projectId);
    assert.equal(createHash('sha256').update(response.bytes).digest('hex'), project.assets[0]?.sha256);
    assert.equal(response.headers['content-type'], 'audio/wav');
    assert.equal(response.headers['content-length'], String(bytes.byteLength));
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
    assert.equal(response.headers['access-control-allow-origin'], undefined);
    await writeFile(join(workspace, projectId, 'assets', 'secret.wav'), bytes);
    assert.equal((await request(handle, 'GET', `/api/projects/${projectId}/assets/secret`)).status, 404);
    assert.equal((await request(handle, 'GET', '/api/projects/p-absent/assets/voz')).status, 404);
    for (const suffix of ['voz.wav', '..%2fproject.json', '%2e%2e%2fsecret', 'voz/extra']) {
      assert.equal((await request(handle, 'GET', `/api/projects/${projectId}/assets/${suffix}`)).status, 404);
    }
    const method = await request(handle, 'DELETE', path);
    assert.equal(method.status, 405);
    assert.equal(method.headers.allow, 'GET, PUT');
    assert.deepEqual(await readFile(join(workspace, projectId, 'project.json')), before);
    const changed = new Uint8Array(bytes);
    changed[changed.length - 1] = 255;
    await writeFile(join(workspace, projectId, 'assets', 'voz.wav'), changed);
    assert.equal((await request(handle, 'GET', path)).status, 409, 'changed bytes must not silently substitute the manifest');
    await writeFile(join(workspace, projectId, 'assets', 'voz.wav'), wavBytes({ durationMs: 900 }));
    assert.equal((await request(handle, 'GET', path)).status, 409, 'changed length is also rejected');
  });
});

test('preview rejects symlink files and directories without exposing paths or outside bytes', async () => {
  await withServer(async ({ handle, workspace }) => {
    const projectId = 'p-preview-links';
    await handle.store.importProject({ text: importableText(projectId) });
    const outside = await tempRoot();
    await writeFile(join(outside, 'voz.wav'), 'outside-secret');
    const assetDir = join(workspace, projectId, 'assets');
    await mkdir(assetDir, { recursive: true });
    await symlink(join(outside, 'voz.wav'), join(assetDir, 'voz.wav'));
    const path = `/api/projects/${projectId}/assets/voz`;
    const file = await request(handle, 'GET', path);
    assert.equal(file.status, 404);
    await rm(assetDir, { recursive: true });
    await symlink(outside, assetDir);
    const directory = await request(handle, 'GET', path);
    assert.equal(directory.status, 400);
    await symlink(outside, join(workspace, 'p-linked'));
    const project = await request(handle, 'GET', '/api/projects/p-linked/assets/voz');
    assert.equal(project.status, 400);
    for (const response of [file, directory, project]) {
      assert.ok(!response.text.includes(outside));
      assert.ok(!response.text.includes(workspace));
      assert.ok(!response.text.includes('outside-secret'));
    }
  });
});
