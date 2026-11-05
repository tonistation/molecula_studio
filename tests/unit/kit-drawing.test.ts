import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fixtureJson } from '../helpers/fixtures.ts';
import { validateProject } from '../../src/shared/schema/validate.ts';
import { LIMITS } from '../../src/shared/schema/limits.ts';
import { validateKitScene } from '../../src/shared/kit/validate.ts';
import { KIT_SCENE_SCHEMA } from '../../src/shared/kit/output-schema.ts';
import { buildKitPrompt } from '../../src/shared/kit/prompt.ts';
import { parseKitResponse } from '../../src/shared/kit/parse.ts';
import { applyKitScene } from '../../src/shared/kit/apply.ts';
import { applyScriptProposal } from '../../src/shared/script/apply.ts';
import type { KitScene } from '../../src/shared/kit/types.ts';

function kit(): KitScene {
  const result = validateKitScene(JSON.parse(readFileSync(new URL('../../docs/plan/examples/kit/sal-del-mar.json', import.meta.url), 'utf8')));
  assert.ok(result.ok);
  return result.scene;
}
function project() {
  const result = validateProject(fixtureJson('storyboard'));
  assert.ok(result.ok);
  return result.project;
}

test('drawing parser tolerates prose/fences and preserves nested strings and escapes', () => {
  const scene = kit();
  scene.labels[0]!.text = 'Agua {dulce} "sí" \\ ```';
  const before = structuredClone(scene);
  for (const text of [JSON.stringify(scene), `Respuesta:\n\`\`\`json\n${JSON.stringify(scene)}\n\`\`\`\nFin.`]) {
    assert.deepEqual(parseKitResponse(text), { ok: true, scene });
  }
  assert.deepEqual(scene, before);
});

test('drawing parser rejects invalid/unknown/code, first malformed object and hostile JSON', () => {
  const scene = kit();
  const bad = [JSON.stringify({ ...scene, kind: 'code' }), JSON.stringify({ ...scene, extra: true }),
    JSON.stringify({ ...scene, objects: [{ ...scene.objects[0], type: 'unknown' }] }),
    JSON.stringify({ ...scene, labels: [{ objectId: 'missing', text: 'Roca', color: '#FFFFFF' }] }),
    `{bad} ${JSON.stringify(scene)}`, '{}', 'No hay JSON', '{"kind":"kit","kind":"kit"}',
    '{"\\u005f_proto__":{}}', JSON.stringify({ deep: Array.from({ length: 17 }).reduce<unknown>(value => ({ nested: value }), {}) }),
    `${'😀'.repeat(LIMITS.maxJsonBytes / 4)} ${JSON.stringify(scene)}`];
  for (const text of bad) {
    const result = parseKitResponse(text);
    assert.equal(result.ok, false, text.slice(0, 80));
    if (!result.ok) {
      assert.ok(result.errors.length > 0);
      assert.ok(result.errors.every(error => /JSON|escena|campo|límite|profundidad|claves|objeto|valor|referencia|tiempo/i.test(error)));
    }
  }
});

test('drawing parser uses scene duration and entity references and never repairs invalid data', () => {
  const scene = kit();
  scene.objects[0]!.animations = [{ type: 'appear', startMs: 0, endMs: 4000, easing: 'linear', params: {} }];
  const invalid = parseKitResponse(JSON.stringify(scene), { durationMs: 3000 });
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.ok(invalid.errors.some(error => error.includes('$.objects[0].animations[0].endMs')));
  assert.deepEqual(parseKitResponse(JSON.stringify(scene), { durationMs: 4000 }), { ok: true, scene });
  const migrated = project();
  const visual = migrated.scenes[0]!.visual as KitScene;
  assert.equal(parseKitResponse(JSON.stringify(visual), { entities: new Map() }).ok, false);
});

test('script and drawing stages both validate and drawing/redrawing changes only targeted visual and scene revision', () => {
  const input = project();
  const draft = applyScriptProposal(input, { title: 'Sal', sources: [], cover: { headline: 'Sal' }, postText: '',
    scenes: [0, 1].map(() => ({ title: 'Mar', narration: 'El agua lleva sal.', visualIntent: 'Roca junto al mar', seconds: 5 })) }, ['s-first', 's-second']);
  assert.ok(validateProject(draft).ok);
  const before = structuredClone(draft);
  const scene = kit();
  const drawn = applyKitScene(draft, 's-first', scene);
  assert.deepEqual(draft, before);
  assert.ok(validateProject(drawn).ok);
  assert.deepEqual(drawn, { ...draft, scenes: [{ ...draft.scenes[0]!, visual: scene, revision: 1 }, draft.scenes[1]] });
  const second = applyKitScene(drawn, 's-second', scene);
  const changed = kit();
  changed.palette.background = '#112233';
  const redrawn = applyKitScene(second, 's-first', changed);
  assert.deepEqual(redrawn.scenes[1], second.scenes[1]);
  assert.deepEqual(redrawn.scenes[0], { ...second.scenes[0]!, visual: changed, revision: 2 });
  assert.deepEqual(applyKitScene(second, 's-first', changed), redrawn);
  changed.objects[0]!.color = '#000000';
  assert.notDeepEqual(redrawn.scenes[0]!.visual, changed);
});

test('invalid drawings leave input untouched including dangling legacy identities and whole-project errors', () => {
  const input = project();
  const before = structuredClone(input);
  const visual = input.scenes[0]!.visual as KitScene;
  const badLegacy = structuredClone(visual);
  badLegacy.objects[0]!.seed = 987;
  for (const [target, id, drawing] of [
    [input, 'missing', kit()], [input, input.scenes[0]!.sceneId, badLegacy],
    [{ ...input, seed: -1 }, input.scenes[0]!.sceneId, kit()],
    [{ ...input, styleId: 'unknown' }, input.scenes[0]!.sceneId, kit()],
    [{ ...input, scenes: input.scenes.map((scene, index) => index === 0 ? { ...scene, revision: Number.MAX_SAFE_INTEGER } : scene) }, input.scenes[0]!.sceneId, kit()],
    [input, input.scenes[0]!.sceneId, { ...kit(), kind: 'code' }],
  ] as const) assert.throws(() => applyKitScene(target, id, drawing));
  const tooLong = kit();
  tooLong.overlays = [{ type: 'counter', startMs: 0, endMs: input.scenes[0]!.durationMs + 1, from: 0, to: 1, color: '#FFFFFF' }];
  assert.throws(() => applyKitScene(input, input.scenes[0]!.sceneId, tooLong));
  assert.deepEqual(input, before);
});

test('redrawing an existing storyboard preserves audio, words, bindings, approval, settings and all other scenes', () => {
  const input = project();
  const before = structuredClone(input);
  const drawing = kit();
  const target = input.scenes[0]!;
  const result = applyKitScene(input, target.sceneId, drawing);
  assert.deepEqual(result, { ...input, scenes: [{ ...target, visual: drawing, revision: target.revision + 1 }, ...input.scenes.slice(1)] });
  assert.deepEqual(input, before);
  assert.ok(validateProject(result).ok);
});

test('kit prompt is deterministic, single scene, literal schema/catalog and complete reusable object identities', () => {
  const input = project();
  const previous = { ...input.scenes[0]!, visual: kit() };
  const args = { scene: input.scenes[1]!, previousScenes: [previous], references: [{ title: 'Referencia', url: 'https://example.org' }] };
  const before = structuredClone(args);
  const prompt = buildKitPrompt(args);
  assert.equal(buildKitPrompt(args), prompt);
  assert.ok(prompt.includes(JSON.stringify(KIT_SCENE_SCHEMA)));
  assert.ok(prompt.includes(JSON.stringify(previous.visual.objects)));
  for (const term of ['objectId', 'low-poly', 'cámara', 'una sola', 'JSON', 'referencias', 'seed', '6000']) assert.ok(prompt.includes(term), term);
  assert.deepEqual(args, before);
});
