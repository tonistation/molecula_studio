import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fakeCodex } from '../helpers/fake-codex.ts';
import { startCompanionServer } from '../../src/companion/server/http.ts';
import { emptyProject } from '../../src/shared/schema/empty.ts';
import { flatOutputSchema } from '../../src/shared/flat/output-schema.ts';
import { generateFlatDrawing, GenerationError, DRAWING_TIMEOUT_MS } from '../../src/companion/providers/codex-cli.ts';

const layer = { id: 'shape', type: 'rect', position: [2160, 1920], rotation: 0, scale: 1, opacity: 1, startMs: 0, endMs: 1000, fill: '#123456', width: 100, height: 200, animations: [] };

test('HTTP dispatches each 2D style to matching Codex schema without writing a project or models', async () => {
  const fake = await fakeCodex('fixture');
  const root = await mkdtemp(join(tmpdir(), 'molecula-flat-http-'));
  const fixture = join(fake.root, 'fixture.json'); fake.env.FAKE_CODEX_FIXTURE = fixture;
  const server = await startCompanionServer({ workspaceRoot: root, codexOptions: { env: fake.env, tempRoot: fake.root } });
  try {
    const initial = await readdir(root);
    const base = emptyProject({ projectId: 'test', now: '2026-01-01T00:00:00Z' });
    for (const [styleId, kind] of [['vector-2d', 'vector'], ['motion-graphics', 'motion']] as const) {
      const visual = { kind, version: 1, background: '#ffffff', layers: [layer] };
      await writeFile(fixture, JSON.stringify(visual));
      const project = { ...base, schemaVersion: 3, styleId, output: { ...base.output, durationMs: 1000 },
        scenes: [{ sceneId: 'scene', revision: 0, title: 'Sol', startMs: 0, durationMs: 1000, text: '', visualIntent: '', visual: null, audio: null, words: [], mediaBindings: { audio: null, words: null } }] };
      const body = JSON.stringify({ project, sceneId: 'scene', modelMode: true });
      const headers = { origin: server.origin, authorization: `Bearer ${server.token}`, 'content-type': 'application/json' };
      const unauthorized = await fetch(server.origin + '/api/drawing/generate', { method: 'POST', headers: { ...headers, authorization: 'Bearer wrong' }, body });
      assert.equal(unauthorized.status, 401);
      const response = await fetch(server.origin + '/api/drawing/generate', { method: 'POST', headers, body });
      assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
      assert.deepEqual(await response.json(), visual);
      const records = (await readFile(fake.env.FAKE_CODEX_RECORD, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
      const last = records.at(-1);
      assert.deepEqual(last.schema, flatOutputSchema(kind, 1000));
      assert.ok(last.input.endsWith(JSON.stringify(last.schema)));
      assert.equal(last.args[last.args.indexOf('--model') + 1], 'gpt-6.1-terra');
      assert.equal(records.length, kind === 'vector' ? 1 : 2);
    }
    assert.deepEqual(await readdir(root), initial);
  } finally { await server.close(); await rm(root, { recursive: true, force: true }); await fake.cleanup(); }
});

test('fake Codex enforces x bound and blank output is rejected without changing draft', async () => {
  const fake = await fakeCodex('fixture');
  const fixture = join(fake.root, 'fixture.json'); fake.env.FAKE_CODEX_FIXTURE = fixture;
  try {
    const base = emptyProject({ projectId: 'test', now: '2026-01-01T00:00:00Z' });
    const project = { ...base, schemaVersion: 3, styleId: 'vector-2d', output: { ...base.output, durationMs: 1000 }, scenes: [{ sceneId: 'scene', revision: 0, title: 'Sol', startMs: 0, durationMs: 1000, text: '', visualIntent: '', visual: null, audio: null, words: [], mediaBindings: { audio: null, words: null } }] };
    const before = structuredClone(project);
    await writeFile(fixture, JSON.stringify({ kind: 'vector', version: 1, background: '#ffffff', layers: [{ ...layer, position: [3000, 0] }] }));
    await assert.rejects(generateFlatDrawing({ project, sceneId: 'scene' }, { env: fake.env, tempRoot: fake.root }), (error: unknown) => error instanceof GenerationError && error.code === 'codex-failed');
    fake.env.FAKE_CODEX_MODE = 'fixture-invalid';
    await writeFile(fixture, JSON.stringify({ kind: 'vector', version: 1, background: '#ffffff', layers: [] }));
    await assert.rejects(generateFlatDrawing({ project, sceneId: 'scene' }, { env: fake.env, tempRoot: fake.root }), (error: unknown) => error instanceof GenerationError && error.code === 'invalid-generation' && /al menos una capa/.test(error.message));
    assert.deepEqual(project, before);
  } finally { await fake.cleanup(); }
});

test('flat generation uses drawing timeout and supports cancellation', async () => {
  const fake = await fakeCodex('hang');
  try {
    const base = emptyProject({ projectId: 'test', now: '2026-01-01T00:00:00Z' });
    const project = { ...base, schemaVersion: 3, styleId: 'motion-graphics', output: { ...base.output, durationMs: 1000 }, scenes: [{ sceneId: 'scene', revision: 0, title: 'Sol', startMs: 0, durationMs: 1000, text: '', visualIntent: '', visual: null, audio: null, words: [], mediaBindings: { audio: null, words: null } }] };
    assert.equal(DRAWING_TIMEOUT_MS, 600000);
    await assert.rejects(generateFlatDrawing({ project, sceneId: 'scene' }, { env: fake.env, tempRoot: fake.root, timeoutMs: 100 }), (error: unknown) => error instanceof GenerationError && error.code === 'generation-timeout');
    const controller = new AbortController(); controller.abort();
    await assert.rejects(generateFlatDrawing({ project, sceneId: 'scene' }, { env: fake.env, tempRoot: fake.root }, controller.signal), (error: unknown) => error instanceof GenerationError && error.code === 'generation-cancelled');
    assert.ok(!(await readdir(fake.root)).some(name => name.startsWith('molecula-codex-')));
  } finally { await fake.cleanup(); }
});

test('wrong-kind Codex response is rejected even if CLI exits successfully', async () => {
  const fake = await fakeCodex('fixture-invalid');
  const root = await mkdtemp(join(tmpdir(), 'molecula-flat-invalid-'));
  fake.env.FAKE_CODEX_FIXTURE = join(fake.root, 'fixture.json');
  await writeFile(fake.env.FAKE_CODEX_FIXTURE, JSON.stringify({ kind: 'motion', version: 1, background: '#ffffff', layers: [] }));
  const server = await startCompanionServer({ workspaceRoot: root, codexOptions: { env: fake.env, tempRoot: fake.root } });
  try {
    const base = emptyProject({ projectId: 'test', now: '2026-01-01T00:00:00Z' });
    const project = { ...base, schemaVersion: 3, styleId: 'vector-2d', output: { ...base.output, durationMs: 1000 }, scenes: [{ sceneId: 'scene', revision: 0, title: 'Sol', startMs: 0, durationMs: 1000, text: '', visualIntent: '', visual: null, audio: null, words: [], mediaBindings: { audio: null, words: null } }] };
    const response = await fetch(server.origin + '/api/drawing/generate', { method: 'POST', headers: { origin: server.origin, authorization: `Bearer ${server.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ project, sceneId: 'scene' }) });
    assert.equal(response.status, 502); assert.equal((await response.json()).error.code, 'invalid-generation');
    const recovery = await fetch(server.origin + '/api/drawing/generate', { method: 'POST', headers: { origin: server.origin, authorization: `Bearer ${server.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ project, sceneId: 'scene' }) });
    assert.match((await recovery.json()).error.responseText, /"kind":"motion"/);
  } finally { await server.close(); await rm(root, { recursive: true, force: true }); await fake.cleanup(); }
});

test('invalid output recovery redacts bearer and known environment secrets', async () => {
  const fake = await fakeCodex('fixture-invalid');
  const root = await mkdtemp(join(tmpdir(), 'molecula-flat-redact-'));
  fake.env.FAKE_CODEX_FIXTURE = join(fake.root, 'fixture.json');
  fake.env.VIBI_API_KEY = 'synthetic-vibi-credential-4783';
  const server = await startCompanionServer({ workspaceRoot: root, codexOptions: { env: fake.env, tempRoot: fake.root } });
  try {
    const base = emptyProject({ projectId: 'test', now: '2026-01-01T00:00:00Z' });
    const project = { ...base, schemaVersion: 3, styleId: 'vector-2d', output: { ...base.output, durationMs: 1000 }, scenes: [{ sceneId: 'scene', revision: 0, title: 'Sol', startMs: 0, durationMs: 1000, text: '', visualIntent: '', visual: null, audio: null, words: [], mediaBindings: { audio: null, words: null } }] };
    await writeFile(fake.env.FAKE_CODEX_FIXTURE, JSON.stringify({ kind: 'vector', version: 1, background: '#ffffff', layers: [], note: `${server.token} ${fake.env.VIBI_API_KEY} sk-synthetic-credential-4783` }));
    const response = await fetch(server.origin + '/api/drawing/generate', { method: 'POST', headers: { origin: server.origin, authorization: `Bearer ${server.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ project, sceneId: 'scene' }) });
    assert.equal(response.status, 502);
    const text = JSON.stringify(await response.json());
    assert.equal(text.includes(server.token), false);
    assert.equal(text.includes(fake.env.VIBI_API_KEY), false);
    assert.equal(text.includes('sk-synthetic-credential-4783'), false);
    assert.equal(text.includes('[oculto]'), true);
    const record = JSON.parse((await readFile(fake.env.FAKE_CODEX_RECORD, 'utf8')).trim());
    assert.equal(record.inheritedProviderSecret, false);
  } finally { await server.close(); await rm(root, { recursive: true, force: true }); await fake.cleanup(); }
});
