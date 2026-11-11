import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, realpath, rm, writeFile, watch } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { fakeCodex } from '../helpers/fake-codex.ts';
import { generateScript, generateDrawing, GenerationError, runCodex, SCRIPT_TIMEOUT_MS, DRAWING_TIMEOUT_MS } from '../../src/companion/providers/codex-cli.ts';
import { capabilities } from '../../src/companion/providers/capabilities.ts';
import { startCompanionServer } from '../../src/companion/server/http.ts';
import { applyScriptProposal } from '../../src/shared/script/apply.ts';
import { applyKitScene } from '../../src/shared/kit/apply.ts';
import { COMPACT_KIT_SCENE_SCHEMA, KIT_SCENE_SCHEMA } from '../../src/shared/kit/output-schema.ts';
import { fixtureJson } from '../helpers/fixtures.ts';
import { validateProject } from '../../src/shared/schema/validate.ts';
import { SCRIPT_PROPOSAL_SCHEMA } from '../../src/shared/script/schema.ts';

const input = { idea: 'Una roca', styleId: 'stylized-3d', locale: 'es' as const, targetSeconds: 15 };

test('drawing admission remains exclusive through cancelled process cleanup', async () => {
  const fake = await fakeCodex('hang');
  const root = await mkdtemp(join(tmpdir(), 'molecula-drawing-lock-'));
  let release!: () => void;
  let reached!: () => void;
  let cleaned!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const cleanupStarted = new Promise<void>(resolve => { reached = resolve; });
  const cleanupDone = new Promise<void>(resolve => { cleaned = resolve; });
  let block = true;
  let firstDirectory = '';
  const server = await startCompanionServer({ workspaceRoot: root, codexOptions: { env: fake.env, tempRoot: fake.root,
    beforeCleanup: async directory => { if (block) { block = false; firstDirectory = directory; reached(); await barrier; } },
    afterCleanup: directory => { if (directory === firstDirectory) cleaned(); },
  } });
  try {
    const validated = validateProject(fixtureJson('storyboard'));
    assert.ok(validated.ok);
    const project = validated.project;
    const headers = { origin: server.origin, authorization: `Bearer ${server.token}`, 'content-type': 'application/json' };
    const drawing = (sceneId: string, signal?: AbortSignal) => fetch(server.origin + '/api/drawing/generate', {
      method: 'POST', headers, signal, body: JSON.stringify({ project, sceneId }) });
    const watcher = watch(fake.root, { signal: AbortSignal.timeout(5000) });
    const started = (async () => {
      try { for await (const event of watcher) { if (event.filename === 'child.pid') return; } }
      finally { await watcher.return?.(); }
      throw new Error('Fake Codex exited before creating child.pid');
    })();
    const abort = new AbortController();
    const first = drawing(project.scenes[1]!.sceneId, abort.signal);
    const firstResult = first.then(() => false, () => true);
    await started;
    const firstRecord = JSON.parse((await readFile(fake.env.FAKE_CODEX_RECORD, 'utf8')).trim());
    assert.ok(Number.isSafeInteger(firstRecord.pid) && firstRecord.pid > 0);
    assert.doesNotThrow(() => process.kill(firstRecord.pid, 0), 'original fake CLI is alive');
    fake.env.FAKE_CODEX_MODE = 'success';
    const concurrent = await drawing(project.scenes[0]!.sceneId);
    assert.equal(concurrent.status, 409);
    assert.equal((await concurrent.json()).error.code, 'drawing-in-progress');
    assert.doesNotThrow(() => process.kill(firstRecord.pid, 0), 'original fake CLI remains alive after rejection');
    abort.abort();
    assert.equal(await firstResult, true);
    await cleanupStarted;
    assert.throws(() => process.kill(firstRecord.pid, 0), { code: 'ESRCH' }, 'original fake CLI exited before releasing admission');
    const retry = await drawing(project.scenes[1]!.sceneId);
    assert.equal(retry.status, 409);
    assert.equal((await retry.json()).error.code, 'drawing-in-progress');
    assert.equal((await readFile(fake.env.FAKE_CODEX_RECORD, 'utf8')).trim().split('\n').length, 1);
    fake.env.FAKE_CODEX_MODE = 'success';
    const script = await fetch(server.origin + '/api/script/generate', { method: 'POST', headers, body: JSON.stringify(input) });
    assert.equal(script.status, 200);
    release();
    await cleanupDone;
    const next = await drawing(project.scenes[1]!.sceneId);
    assert.equal(next.status, 200);
    const records = (await readFile(fake.env.FAKE_CODEX_RECORD, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    assert.equal(records.filter(record => record.schema.properties.kind).length, 2);
  } finally { release(); await server.close(); await rm(root, { recursive: true, force: true }); await fake.cleanup(); }
});

test('drawing admission is released after validation, spawn, timeout, and success', async () => {
  const fake = await fakeCodex();
  const root = await mkdtemp(join(tmpdir(), 'molecula-drawing-release-'));
  const server = await startCompanionServer({ workspaceRoot: root, codexOptions: { env: fake.env, tempRoot: fake.root, timeoutMs: 400 } });
  try {
    const result = validateProject(fixtureJson('storyboard'));
    assert.ok(result.ok);
    const headers = { origin: server.origin, authorization: `Bearer ${server.token}`, 'content-type': 'application/json' };
    const send = (body: unknown) => fetch(server.origin + '/api/drawing/generate', { method: 'POST', headers, body: JSON.stringify(body) });
    const valid = { project: result.project, sceneId: result.project.scenes[0]!.sceneId };
    assert.equal((await send({})).status, 400);
    fake.env.PATH = '';
    assert.equal((await send(valid)).status, 503);
    fake.env.PATH = fake.root;
    fake.env.FAKE_CODEX_MODE = 'hang';
    assert.equal((await send(valid)).status, 504);
    fake.env.FAKE_CODEX_MODE = 'success';
    assert.equal((await send(valid)).status, 200);
    assert.equal((await send(valid)).status, 200);
  } finally { await server.close(); await rm(root, { recursive: true, force: true }); await fake.cleanup(); }
});

test('drawing has a bounded longer deadline without changing script deadline', () => {
  assert.equal(SCRIPT_TIMEOUT_MS, 180_000);
  assert.equal(DRAWING_TIMEOUT_MS, 600_000);
});

test('drawing timeout reports the injected limit and removes its temporary files', async () => {
  const fake = await fakeCodex('hang');
  try {
    const result = validateProject(fixtureJson('storyboard'));
    assert.ok(result.ok);
    await assert.rejects(generateDrawing({ project: result.project, sceneId: result.project.scenes[0]!.sceneId },
      { env: fake.env, tempRoot: fake.root, timeoutMs: 300 }), error => {
      assert.ok(error instanceof GenerationError);
      assert.equal(error.code, 'generation-timeout');
      assert.match(error.message, /0\.3 s/);
      assert.equal(error.diagnostics?.stage, 'timeout');
      return true;
    });
    assert.ok(!(await readdir(fake.root)).some(name => name.startsWith('molecula-codex-')));
  } finally { await fake.cleanup(); }
});

test('HTTP Codex failures expose only bounded process lifecycle diagnostics', async () => {
  const fake = await fakeCodex();
  const root = await mkdtemp(join(tmpdir(), 'molecula-diagnostics-'));
  try {
    for (const [mode, status, code, stage, started] of [
      ['missing', 503, 'codex-unavailable', 'spawn', false],
      ['fail', 502, 'codex-failed', 'exit', true],
      ['signal', 502, 'codex-failed', 'exit', true],
      ['hang', 504, 'generation-timeout', 'timeout', true],
    ] as const) {
      const server = await startCompanionServer({ workspaceRoot: root, codexOptions: {
        env: { ...fake.env, FAKE_CODEX_MODE: mode, ...(mode === 'missing' ? { PATH: '' } : {}) },
        timeoutMs: mode === 'hang' ? 400 : 5000,
      } });
      try {
        const response = await fetch(server.origin + '/api/script/generate', { method: 'POST',
          headers: { origin: server.origin, authorization: `Bearer ${server.token}`, 'content-type': 'application/json' },
          body: JSON.stringify(input) });
        const text = await response.text();
        assert.equal(response.status, status);
        assert.ok(!text.includes('private-stub-output-4815'));
        assert.ok(!text.includes(fake.root));
        const error = JSON.parse(text).error;
        assert.equal(error.code, code);
        assert.equal(error.diagnostics.stage, stage);
        assert.equal(error.diagnostics.processStarted, started);
        assert.ok(Number.isSafeInteger(error.diagnostics.elapsedMs) && error.diagnostics.elapsedMs >= 0);
        if (mode === 'fail') assert.equal(error.diagnostics.exitCode, 1);
        if (mode === 'signal') assert.equal(error.diagnostics.signal, 'SIGTERM');
        if (mode === 'hang') assert.match(error.message, /Codex no terminó en/);
        assert.ok(Object.keys(error.diagnostics).every(key => ['stage', 'processStarted', 'elapsedMs', 'exitCode', 'signal'].includes(key)));
      } finally { await server.close(); }
    }
  } finally { await rm(root, { recursive: true, force: true }); await fake.cleanup(); }
});

test('historical drawing context selects identical full schemas in prompt and CLI', async () => {
  const fake = await fakeCodex();
  try {
    const result = validateProject(fixtureJson('storyboard'));
    assert.ok(result.ok);
    const project = result.project;
    const before = structuredClone(project);
    for (const scene of project.scenes) {
      await generateDrawing({ project, sceneId: scene.sceneId }, { env: fake.env, tempRoot: fake.root });
    }
    const records = (await readFile(fake.env.FAKE_CODEX_RECORD, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    for (const record of records) {
      assert.deepEqual(record.schema, KIT_SCENE_SCHEMA);
      assert.ok(record.input.endsWith(JSON.stringify(record.schema)));
    }
    assert.deepEqual(project, before);
  } finally { await fake.cleanup(); }
});

test('capabilities uses a fake PATH executable, reports only booleans and times out without a provider', async () => {
  const fake = await fakeCodex();
  try {
    assert.deepEqual(await capabilities({ env: { ...fake.env, VIBI_API_KEY: 'private-value' } }), { codex: true, vibi: true });
    assert.deepEqual(await capabilities({ env: { ...fake.env, PATH: '', VIBI_API_KEY: '' } }), { codex: false, vibi: false });
    assert.deepEqual(await capabilities({ env: { ...fake.env, FAKE_CODEX_MODE: 'version-fail', VIBI_API_KEY: '' } }), { codex: false, vibi: false });
    assert.deepEqual(await capabilities({ env: { ...fake.env, FAKE_CODEX_MODE: 'version-hang', VIBI_API_KEY: '' }, timeoutMs: 100 }), { codex: false, vibi: false });
  } finally { await fake.cleanup(); }
});

test('Codex generates script and sequential kits in private cwd with strict original schemas and full continuity, never saves', async () => {
  const fake = await fakeCodex();
  const workspace = await mkdtemp(join(tmpdir(), 'molecula-codex-http-'));
  const companion = await startCompanionServer({ workspaceRoot: workspace, codexOptions: { env: fake.env, tempRoot: fake.root } });
  try {
    const created = await companion.store.createProject({ title: 'Original' });
    const path = join(workspace, created.projectId, 'project.json');
    const original = await readFile(path);
    const script = await generateScript(input, { env: fake.env, tempRoot: fake.root });
    let draft = applyScriptProposal(created.project, script, ['generated-a', 'generated-b']);
    for (const scene of draft.scenes) draft = applyKitScene(draft, scene.sceneId,
      await generateDrawing({ project: draft, sceneId: scene.sceneId }, { env: fake.env, tempRoot: fake.root }));
    const records = (await readFile(fake.env.FAKE_CODEX_RECORD, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    assert.equal(records.length, 3);
    assert.deepEqual(records[0].schema, SCRIPT_PROPOSAL_SCHEMA);
    assert.deepEqual(records[1].schema, COMPACT_KIT_SCENE_SCHEMA);
    assert.deepEqual(records[2].schema, COMPACT_KIT_SCENE_SCHEMA);
    for (const record of records.slice(1)) assert.ok(record.input.endsWith(JSON.stringify(record.schema)));
    assert.ok(records[2].input.includes(JSON.stringify((draft.scenes[0]!.visual as any).objects[0])));
    for (const record of records) {
      assert.ok(record.cwd.startsWith(await realpath(fake.root)));
      assert.notEqual(record.cwd, process.cwd());
      assert.equal(record.inheritedProviderSecret, false);
      await assert.rejects(readFile(join(record.cwd, 'schema.json')), { code: 'ENOENT' });
      assert.ok(!record.args.join(' ').includes(input.idea), 'prompt is stdin, not command arguments');
    }
    assert.deepEqual(await readFile(path), original);
    assert.ok(!('sources' in created.project));
  } finally { await companion.close(); await rm(workspace, { recursive: true, force: true }); await fake.cleanup(); }
});

test('Codex missing/login/timeout/invalid/oversized/missing output errors are bounded, actionable, redacted and cleaned', async () => {
  const fake = await fakeCodex();
  try {
    for (const [mode, code] of [['fail', 'codex-failed'], ['bad-json', 'invalid-generation'], ['secret-json', 'invalid-generation'],
      ['invalid-utf8', 'invalid-generation'], ['huge', 'invalid-generation'], ['missing-output', 'invalid-generation'], ['hang', 'generation-timeout']]) {
      await assert.rejects(generateScript(input, { env: { ...fake.env, FAKE_CODEX_MODE: mode, VIBI_API_KEY: 'do-not-echo' },
        tempRoot: fake.root, timeoutMs: mode === 'hang' ? 300 : 5000 }), error => {
        assert.ok(error instanceof GenerationError);
        assert.equal(error.code, code);
        assert.ok(!JSON.stringify(error).includes('do-not-echo'));
        if (mode === 'bad-json') assert.match(error.responseText!, /invalid JSON/);
        if (mode === 'secret-json') { assert.match(error.responseText!, /\[oculto\]/); assert.ok(!error.responseText!.includes('sk-fake')); }
        return true;
      });
      assert.ok(!(await readdir(fake.root)).some(name => name.startsWith('molecula-codex-')));
    }
    await assert.rejects(generateScript(input, { env: { ...fake.env, PATH: '' }, tempRoot: fake.root }), /Instala Codex CLI.*codex login/);
    for (const value of [null, {}, { ...input, idea: '' }, { ...input, targetSeconds: 100 }, { ...input, extra: true }]) {
      await assert.rejects(generateScript(value, { env: fake.env }), /Revisa la idea/);
    }
  } finally { await fake.cleanup(); }
});

test('generation routes retain token/Origin/Host/method boundary, reject invalid drafts and do not echo bearer in invalid output', async () => {
  const fake = await fakeCodex('bad-json');
  const root = await mkdtemp(join(tmpdir(), 'molecula-generation-boundary-'));
  const handle = await startCompanionServer({ workspaceRoot: root, token: 'f06-token', codexOptions: { env: fake.env } });
  const headers = { authorization: 'Bearer f06-token', origin: handle.origin, 'content-type': 'application/json' };
  try {
    for (const path of ['/api/script/generate', '/api/drawing/generate']) {
      assert.equal((await fetch(handle.origin + path, { method: 'POST', headers: { origin: handle.origin }, body: '{}' })).status, 401);
      assert.equal((await fetch(handle.origin + path, { method: 'POST', headers: { ...headers, origin: 'https://evil.example' }, body: '{}' })).status, 403);
      assert.equal((await fetch(handle.origin + path, { method: 'POST', headers: { authorization: headers.authorization }, body: '{}' })).status, 403);
      assert.equal((await fetch(handle.origin + path, { headers })).status, 405);
    }
    assert.equal((await fetch(handle.origin + '/api/capabilities')).status, 401);
    assert.deepEqual(await (await fetch(handle.origin + '/api/capabilities', { headers })).json(), { codex: true, vibi: Boolean(fake.env.VIBI_API_KEY), vibiVoiceConfigured: false });
    const badHost = await new Promise<number>(resolve => {
      const req = request(handle.origin + '/api/capabilities', { headers: { ...headers, host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode!); }); req.end();
    });
    assert.equal(badHost, 403);
    for (const body of [{}, { project: {}, sceneId: 'missing' }]) {
      assert.equal((await fetch(handle.origin + '/api/drawing/generate', { method: 'POST', headers, body: JSON.stringify(body) })).status, 400);
    }
    const result = await fetch(handle.origin + '/api/script/generate', { method: 'POST', headers, body: JSON.stringify(input) });
    assert.equal(result.status, 502);
    const text = await result.text();
    assert.ok(!text.includes('f06-token'));
    assert.match(text, /invalid JSON/);
    assert.equal((await handle.store.listProjects()).length, 0);
  } finally { await handle.close(); await rm(root, { recursive: true, force: true }); await fake.cleanup(); }
});

test('fake executable refuses schemas that are not strict instead of pretending Codex accepted them', async () => {
  const fake = await fakeCodex();
  try {
    const schema = join(fake.root, 'not-strict.json');
    await writeFile(schema, JSON.stringify({ type: 'object', properties: { title: { type: 'string' } }, required: [] }));
    await assert.rejects(runCodex(['exec', '--skip-git-repo-check', '--sandbox', 'read-only', '--output-schema', schema,
      '-o', join(fake.root, 'response.json'), '-'], { env: fake.env, cwd: fake.root, input: 'offline' }), /Codex no pudo/);
  } finally { await fake.cleanup(); }
});

test('explicit abort and companion shutdown stop pending generation and remove its temporary files', async () => {
  const fake = await fakeCodex('hang');
  const root = await mkdtemp(join(tmpdir(), 'molecula-codex-cancel-'));
  const options = { env: fake.env, tempRoot: fake.root };
  const waitForStart = async () => {
    for (let i = 0; i < 250; i++) {
      try { await readFile(fake.env.FAKE_CODEX_CHILD); return; } catch { await new Promise(resolve => setTimeout(resolve, 20)); }
    }
    assert.fail('fake child did not start');
  };
  let server: Awaited<ReturnType<typeof startCompanionServer>> | undefined;
  try {
    const controller = new AbortController();
    const running = generateScript(input, options, controller.signal);
    const rejected = assert.rejects(running, error => error instanceof GenerationError && error.code === 'generation-cancelled');
    await waitForStart();
    const pid = Number(await readFile(fake.env.FAKE_CODEX_CHILD, 'utf8'));
    controller.abort();
    await rejected;
    // Unlike a short deadline, the startup handshake proves a grandchild existed.
    for (let i = 0; i < 100; i++) {
      try { process.kill(pid, 0); } catch { break; }
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.throws(() => process.kill(pid, 0), 'cancelled CLI descendants do not survive');
    assert.ok(!(await readdir(fake.root)).some(name => name.startsWith('molecula-codex-')));
    await rm(fake.env.FAKE_CODEX_CHILD);
    server = await startCompanionServer({ workspaceRoot: root, codexOptions: options });
    const drawingProject = validateProject(fixtureJson('storyboard'));
    assert.ok(drawingProject.ok);
    const client = new AbortController();
    const disconnected = fetch(server.origin + '/api/drawing/generate', { method: 'POST', signal: client.signal,
      headers: { origin: server.origin, authorization: `Bearer ${server.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ project: drawingProject.project, sceneId: drawingProject.project.scenes[0]!.sceneId }) });
    const disconnectResult = assert.rejects(disconnected);
    await waitForStart();
    const drawingPid = Number(await readFile(fake.env.FAKE_CODEX_CHILD, 'utf8'));
    client.abort();
    await disconnectResult;
    for (let i = 0; i < 100; i++) {
      try { process.kill(drawingPid, 0); } catch { break; }
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.throws(() => process.kill(drawingPid, 0), 'disconnected drawing descendants do not survive');
    await rm(fake.env.FAKE_CODEX_CHILD);
    const response = fetch(server.origin + '/api/script/generate', { method: 'POST',
      headers: { origin: server.origin, authorization: `Bearer ${server.token}`, 'content-type': 'application/json' }, body: JSON.stringify(input) });
    await waitForStart();
    await server.close();
    server = undefined;
    assert.equal((await response).status, 499);
    assert.ok(!(await readdir(fake.root)).some(name => name.startsWith('molecula-codex-')));
  } finally { await server?.close(); await rm(root, { recursive: true, force: true }); await fake.cleanup(); }
});
