import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fakeCodex } from '../helpers/fake-codex.ts';
import { fixtureJson } from '../helpers/fixtures.ts';
import { validateProject } from '../../src/shared/schema/validate.ts';
import { generateScript, generateDrawing, generateModelDrawing, GenerationError } from '../../src/companion/providers/codex-cli.ts';

const input = { idea: 'Una roca', styleId: 'stylized-3d', locale: 'es' as const, targetSeconds: 15 };
const keys = ['MOLECULA_CODEX_SCRIPT_MODEL', 'MOLECULA_CODEX_DRAW_MODEL', 'MOLECULA_CODEX_MODEL_BUILD_MODEL'] as const;

test('each task selects only its configured model, with drawing fallback for model bundles', async () => {
  const fake = await fakeCodex();
  try {
    for (const key of keys) delete fake.env[key];
    fake.env.VIBI_API_KEY = 'test-vibi-secret';
    fake.env.OPENAI_API_KEY = 'test-openai-secret';
    fake.env.CODEX_API_KEY = 'test-codex-secret';
    const project = validateProject(fixtureJson('storyboard'));
    assert.ok(project.ok);
    const drawing = { project: project.project, sceneId: project.project.scenes[0]!.sceneId };
    const options = { env: fake.env, tempRoot: fake.root };
    await generateScript(input, options);
    await generateDrawing(drawing, options);
    await generateModelDrawing({ ...drawing, modelMode: true }, [], options);
    fake.env.MOLECULA_CODEX_SCRIPT_MODEL = 'script-v1';
    fake.env.MOLECULA_CODEX_DRAW_MODEL = 'draw.v2:fast';
    await generateScript(input, options);
    await generateDrawing(drawing, options);
    await generateModelDrawing({ ...drawing, modelMode: true }, [], options);
    fake.env.MOLECULA_CODEX_MODEL_BUILD_MODEL = 'build_v3';
    await generateModelDrawing({ ...drawing, modelMode: true }, [], options);
    const records = (await readFile(fake.env.FAKE_CODEX_RECORD, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    assert.equal(records.length, 7);
    assert.deepEqual(records.map(record => {
      const index = record.args.indexOf('--model');
      return index < 0 ? undefined : record.args[index + 1];
    }), ['gpt-6.1-terra', 'gpt-6.1-terra', 'gpt-6.1-terra', 'script-v1', 'draw.v2:fast', 'draw.v2:fast', 'build_v3']);
    for (const record of records) {
      assert.equal(record.args.filter((arg: string) => arg === '--model').length, 1);
      assert.ok(record.args.includes('--ephemeral'));
      assert.equal(record.args[record.args.indexOf('--sandbox') + 1], 'read-only');
      assert.equal(record.inheritedProviderSecret, false);
    }
  } finally { await fake.cleanup(); }
});

test('invalid selected model is rejected before spawning without exposing its value', async () => {
  const fake = await fakeCodex();
  try {
    for (const key of keys) delete fake.env[key];
    const result = validateProject(fixtureJson('storyboard'));
    assert.ok(result.ok);
    const drawing = { project: result.project, sceneId: result.project.scenes[0]!.sceneId };
    for (const value of ['', '-flag', 'bad model', 'bad\nmodel', 'model\n', 'model;touch', 'é', 'x'.repeat(81)]) {
      for (const [key, run] of [
        [keys[0], () => generateScript(input, { env: fake.env, tempRoot: fake.root })],
        [keys[1], () => generateDrawing(drawing, { env: fake.env, tempRoot: fake.root })],
        [keys[2], () => generateModelDrawing({ ...drawing, modelMode: true }, [], { env: fake.env, tempRoot: fake.root })],
      ] as const) {
        fake.env[key] = value;
        await assert.rejects(run(), error => {
          assert.ok(error instanceof GenerationError);
          assert.equal(error.code, 'invalid-codex-model');
          assert.match(error.message, /modelo.*Codex/i);
          if (value) assert.ok(!error.message.includes(value));
          return true;
        });
        delete fake.env[key];
      }
    }
    fake.env.MOLECULA_CODEX_DRAW_MODEL = '-inherited-bad';
    await assert.rejects(generateModelDrawing({ ...drawing, modelMode: true }, [], { env: fake.env, tempRoot: fake.root }),
      (error: unknown) => error instanceof GenerationError && error.code === 'invalid-codex-model');
    await assert.rejects(readFile(fake.env.FAKE_CODEX_RECORD), { code: 'ENOENT' });
  } finally { await fake.cleanup(); }
});

test('valid boundary model is passed once and provider failure does not trigger a retry', async () => {
  const fake = await fakeCodex('fail');
  try {
    fake.env.MOLECULA_CODEX_SCRIPT_MODEL = 'x'.repeat(80);
    fake.env.VIBI_API_KEY = 'private-key-for-test';
    await assert.rejects(generateScript(input, { env: fake.env, tempRoot: fake.root }),
      (error: unknown) => {
        assert.ok(error instanceof GenerationError);
        assert.equal(error.code, 'codex-failed');
        assert.match(error.message, /modelo configurado esté disponible para tu cuenta/);
        assert.match(error.message, /MOLECULA_CODEX_\*/);
        assert.match(error.message, /codex login/);
        assert.match(error.message, /límites de uso/);
        assert.ok(!JSON.stringify(error).includes('private-stub-output-4815'));
        assert.ok(!JSON.stringify(error).includes('private-key-for-test'));
        assert.equal(error.responseText, undefined);
        return true;
      });
    const records = (await readFile(fake.env.FAKE_CODEX_RECORD, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    assert.equal(records.length, 1);
    assert.equal(records[0].args[records[0].args.indexOf('--model') + 1], 'x'.repeat(80));
  } finally { await fake.cleanup(); }
});
