import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyProject, parseProjectText, serializeProject, validateProject } from '../../src/shared/schema/index.ts';
import { bindingDigests } from '../../src/shared/digests.ts';
import { downloadSnapshot, withScenes } from '../../studio/src/model.ts';
import { fixtureText } from '../helpers/fixtures.ts';

const metadata = { sources: [{ title: 'Fuente', url: 'https://example.org/research?q=sal' }], cover: { headline: 'La sal del mar' }, postText: 'Comparte esta explicación.' };
const base = () => emptyProject({ projectId: 'script', now: '2026-11-05T00:00:00Z' });

test('old v2 remains unchanged, metadata roundtrips and survives editor snapshots', () => {
  const old = base();
  const plain = validateProject(old);
  assert.ok(plain.ok);
  assert.deepEqual(plain.project, old);
  assert.equal(serializeProject(old).includes('sources'), false);
  const project = { ...old, ...metadata };
  const parsed = parseProjectText(serializeProject(project));
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.project, project);
  assert.equal(serializeProject(parsed.project), serializeProject(project));
  assert.deepEqual(withScenes(project, []).sources, metadata.sources);
  assert.deepEqual(downloadSnapshot(project, true).cover, metadata.cover);
  for (const field of ['sources', 'cover', 'postText'] as const) {
    assert.ok(validateProject({ ...old, [field]: metadata[field] }).ok);
  }
});

test('metadata rejects malformed shapes, extra keys, unsafe URLs and excessive fields', () => {
  const invalid = [
    { sources: null }, { sources: [{ title: 'Fuente' }] }, { sources: [{ title: '', url: 'https://example.org' }] },
    { sources: [{ ...metadata.sources[0], extra: true }] },
    ...['javascript:alert(1)', 'data:text/plain,sal', 'file:///etc/passwd', '/relative', 'https://', 'https://user:secret@example.org', ' https://example.org', 'https://example.org/\npath'].map(url => ({ sources: [{ title: 'Fuente', url }] })),
    { sources: Array.from({ length: 13 }, () => metadata.sources[0]) },
    { sources: [{ title: 'x'.repeat(121), url: 'https://example.org' }] },
    { cover: null }, { cover: {} }, { cover: { headline: '' } }, { cover: { headline: 'Sal', extra: true } },
    { cover: { headline: 'x'.repeat(121) } }, { postText: null }, { postText: 'x'.repeat(4001) }, { postText: '\u0000' },
  ];
  for (const extension of invalid) assert.equal(validateProject({ ...base(), ...extension }).ok, false, JSON.stringify(extension));
  assert.ok(validateProject({ ...base(), sources: [{ title: 'Fuente', url: 'http://example.org' }], cover: { headline: '🌊'.repeat(120) }, postText: '🌊'.repeat(4000) }).ok);
  assert.equal(validateProject({ ...base(), schemaVersion: 1, ...metadata }).ok, false);
});

test('each metadata edit changes content approval digest but leaves media digests intact', async () => {
  const parsed = parseProjectText(fixtureText('storyboard'));
  assert.ok(parsed.ok);
  const project = { ...parsed.project, ...metadata };
  const before = await bindingDigests(project);
  for (const change of [{ sources: [{ title: 'Otra', url: 'https://example.org' }] }, { cover: { headline: 'Otra' } }, { postText: 'Otro' }]) {
    const after = await bindingDigests({ ...project, ...change });
    assert.notEqual(after.contentDigest, before.contentDigest);
    assert.deepEqual(after.scenes, before.scenes);
  }
});

test('metadata absence preserves the old content digest and v1 migration shape', async () => {
  const parsed = parseProjectText(fixtureText('storyboard'));
  assert.ok(parsed.ok);
  for (const key of ['sources', 'cover', 'postText']) assert.equal(Object.hasOwn(parsed.project, key), false);
  const roundtrip = parseProjectText(serializeProject(parsed.project));
  assert.ok(roundtrip.ok);
  assert.equal((await bindingDigests(roundtrip.project)).contentDigest, (await bindingDigests(parsed.project)).contentDigest);
  assert.equal(validateProject({ ...base(), sources: undefined }).ok, false);
});

test('metadata has stable nested key order and exact bounded Unicode fields', () => {
  const project = { ...base(), sources: Array.from({ length: 12 }, () => ({ url: 'https://example.org/' + 'a'.repeat(2028), title: '🌊'.repeat(120) })), cover: { headline: '🌊'.repeat(120) }, postText: '' };
  assert.equal(project.sources[0]!.url.length, 2048);
  const valid = validateProject(project);
  assert.ok(valid.ok);
  const wire = serializeProject(valid.project);
  assert.ok(wire.indexOf('"title": "🌊') < wire.indexOf('"url": "https://'));
  const tooLong = structuredClone(project);
  tooLong.sources[0]!.url += 'x';
  assert.equal(validateProject(tooLong).ok, false);
  assert.equal(validateProject({ ...project, sources: [], cover: { headline: '🌊'.repeat(121) } }).ok, false);
});
