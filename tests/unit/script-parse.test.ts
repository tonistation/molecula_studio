import test from 'node:test';
import assert from 'node:assert/strict';
import { parseScriptResponse } from '../../src/shared/script/parse.ts';
import type { ScriptProposal } from '../../src/shared/script/schema.ts';
import { LIMITS } from '../../src/shared/schema/limits.ts';

function proposal(): ScriptProposal {
  return { title: 'Sal', sources: [{ title: 'Fuente', url: 'https://example.org/sal' }], scenes: [{ title: 'Pregunta', narration: '¿De dónde sale la sal?', visualIntent: 'Un salero junto al mar', seconds: 3 }], cover: { headline: 'Sal del mar' }, postText: 'Comparte esta pregunta.' };
}

function rejects(value: unknown, pattern?: RegExp): void {
  const result = parseScriptResponse(JSON.stringify(value));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.errors.length > 0);
    assert.ok(result.errors.every(error => typeof error === 'string'));
    if (pattern) assert.match(result.errors.join('\n'), pattern);
  }
}

test('script parser accepts plain JSON, fences and surrounding prose without changing values', () => {
  const value = proposal();
  value.scenes[0]!.seconds = 2.345;
  const json = JSON.stringify(value);
  for (const text of [json, `\uFEFF\n${json}`, `\`\`\`json\n${json}\n\`\`\``, `Aquí está el guion:\n\`\`\`json\n${json}\n\`\`\`\nFin.`, `Antes ${json} después ${JSON.stringify(proposal())}`]) {
    assert.deepEqual(parseScriptResponse(text), { ok: true, proposal: value });
  }
});

test('script extraction respects braces, escaped quotes, backslashes and literal fences inside strings', () => {
  const value = proposal();
  value.scenes[0]!.narration = 'Una {roca} dice "hola" \\ y ```json no es un bloque';
  value.postText = 'Cierre } { \\" fin';
  assert.deepEqual(parseScriptResponse(`Respuesta: ${JSON.stringify(value)} fin`), { ok: true, proposal: value });
});

test('script parser validates only the first object and never falls back to a later valid one', () => {
  const result = parseScriptResponse(`{} ${JSON.stringify(proposal())}`);
  assert.equal(result.ok, false);
});

test('script parser requires every declared root and nested field', () => {
  for (const key of ['title', 'sources', 'scenes', 'cover', 'postText']) {
    const value = proposal() as unknown as Record<string, unknown>;
    delete value[key];
    rejects(value, /obligatorio/);
  }
  for (const key of ['title', 'narration', 'visualIntent', 'seconds']) {
    const value = proposal();
    delete (value.scenes[0] as unknown as Record<string, unknown>)[key];
    rejects(value, /obligatorio/);
  }
  rejects({ ...proposal(), sources: [{ title: 'Fuente' }] }, /obligatorio/);
  rejects({ ...proposal(), cover: {} }, /obligatorio/);
});

test('script parser rejects unknown fields at every object level', () => {
  for (const location of ['root', 'scene', 'source', 'cover']) {
    const value = proposal();
    const target = location === 'root' ? value : location === 'scene' ? value.scenes[0]! : location === 'source' ? value.sources[0]! : value.cover;
    Object.assign(target, { extra: true });
    rejects(value, /no permitidos/);
  }
});

test('script parser enforces scene count and individual/aggregate duration without rounding', () => {
  const value = proposal();
  for (const count of [0, 13]) rejects({ ...value, scenes: Array.from({ length: count }, () => value.scenes[0]) });
  for (const seconds of [0.999, 15.001, '3', null]) rejects({ ...value, scenes: [{ ...value.scenes[0], seconds }] });
  value.scenes = Array.from({ length: 12 }, () => ({ ...proposal().scenes[0]!, seconds: 5 }));
  assert.deepEqual(parseScriptResponse(JSON.stringify(value)), { ok: true, proposal: value });
  value.scenes[0]!.seconds = 5.0001;
  rejects(value, /60/);
  value.scenes = Array.from({ length: 5 }, () => ({ ...proposal().scenes[0]!, seconds: 15 }));
  rejects(value, /60/);
});

test('script parser counts Unicode code points and rejects oversized text without truncation', () => {
  const value = proposal();
  value.title = '😀'.repeat(120);
  value.scenes[0]!.narration = '😀'.repeat(2000);
  value.postText = '😀'.repeat(4000);
  assert.deepEqual(parseScriptResponse(JSON.stringify(value)), { ok: true, proposal: value });
  rejects({ ...value, title: value.title + 'x' });
  rejects({ ...value, postText: value.postText + 'x' });
  rejects({ ...value, scenes: [{ ...value.scenes[0], narration: value.scenes[0]!.narration + 'x' }] });
  value.scenes = Array.from({ length: 7 }, () => ({ ...value.scenes[0]!, seconds: 1 }));
  rejects(value, /12000/);
});

test('script duration summation accepts a decimal 60-second boundary without rounding scenes', () => {
  const value = proposal();
  value.scenes = [5.4, 5.4, 5.4, 14.6, 14.6, 14.6].map(seconds => ({ ...proposal().scenes[0]!, seconds }));
  assert.deepEqual(parseScriptResponse(JSON.stringify(value)), { ok: true, proposal: value });
  value.scenes[0]!.seconds += 0.00000001;
  rejects(value, /60/);
});

test('script parser enforces all remaining string and metadata bounds and types', () => {
  const value = proposal();
  for (const title of ['', 1, null, 'x'.repeat(121)]) rejects({ ...value, title });
  for (const key of ['title', 'narration', 'visualIntent']) rejects({ ...value, scenes: [{ ...value.scenes[0], [key]: '' }] });
  rejects({ ...value, scenes: [{ ...value.scenes[0], title: 'x'.repeat(121) }] });
  rejects({ ...value, scenes: [{ ...value.scenes[0], visualIntent: 'x'.repeat(1001) }] });
  rejects({ ...value, cover: { headline: 'x'.repeat(121) } });
  rejects({ ...value, sources: Array.from({ length: 13 }, () => value.sources[0]) });
  rejects({ ...value, sources: [{ title: '', url: 'https://example.org' }] });
  rejects({ ...value, sources: [{ title: 'x'.repeat(121), url: 'https://example.org' }] });
  rejects({ ...value, sources: null });
  rejects({ ...value, scenes: {} });
  rejects({ ...value, cover: [] });
  rejects({ ...value, postText: false });
  assert.equal(parseScriptResponse(JSON.stringify({ ...value, sources: [], postText: '' })).ok, true);
});

test('script sources accept only absolute HTTP(S) URLs without credentials or whitespace', () => {
  for (const url of ['javascript:alert(1)', '/sal', 'https://', 'https://user:pass@example.org', 'https://example.org/a b', 'https://example.org/\n', 'https://example.org/' + 'x'.repeat(2048)]) {
    rejects({ ...proposal(), sources: [{ title: 'Fuente', url }] }, /url/);
  }
});

test('script parser returns Spanish errors for missing, incomplete and malformed JSON', () => {
  for (const text of ['', 'Sin JSON', '{', '{"title":"sin cierre}', '{"title":}', '{"a":1,}', '{"a":01}', '{"a":1e999}', '{"a":"\\q"}', '{"a": [1,]}']) {
    const result = parseScriptResponse(text);
    assert.equal(result.ok, false, text);
    if (!result.ok) assert.match(result.errors.join('\n'), /JSON|objeto/);
  }
});

test('script parser preserves strict duplicate and dangerous key safeguards including escaped keys', () => {
  for (const prefix of ['"title":"x","title":"y"', '"title":"x","ti\\u0074le":"y"', '"__proto__":{}', '"constructor":{}', '"prototype":{}', '"cover":{"__pro\\u0074o__":{}}']) {
    const result = parseScriptResponse(`{${prefix}} ${JSON.stringify(proposal())}`);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.errors.join('\n'), /duplicadas|peligrosas/);
  }
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test('script parser bounds the entire response bytes and JSON nesting', () => {
  for (const text of ['x'.repeat(LIMITS.maxJsonBytes + 1), '😀'.repeat(LIMITS.maxJsonBytes / 4) + JSON.stringify(proposal())]) {
    const result = parseScriptResponse(text);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.errors.join('\n'), /bytes/);
  }
  const result = parseScriptResponse('{"a":' + '['.repeat(LIMITS.maxDepth + 1) + '0' + ']'.repeat(LIMITS.maxDepth + 1) + '}');
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.errors.join('\n'), /profundidad/);
});
