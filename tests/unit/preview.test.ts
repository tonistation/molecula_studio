import test from 'node:test';
import assert from 'node:assert/strict';
import { parseProjectText } from '../../src/shared/schema/parse.ts';
import { fixtureText } from '../helpers/fixtures.ts';
import { draftVideoProps } from '../../studio/src/preview-model.ts';
import { loadPreviewAssets } from '../../studio/src/preview-assets.ts';

test('draft preview estimates edited text without changing saved alignment and uses the draft timeline', () => {
  const result = parseProjectText(fixtureText('storyboard'));
  assert.ok(result.ok);
  const draft = structuredClone(result.project);
  const oldWords = structuredClone(draft.scenes[0]!.words);
  draft.scenes[0]!.text = 'Texto nuevo sin guardar';
  draft.scenes[0]!.durationMs = 3000;
  draft.scenes[1]!.startMs = 3000;
  draft.output.durationMs = 9000;
  const props = draftVideoProps(draft, {});
  assert.equal(props.scenes[0]!.words.map(word => word.text).join(' '), draft.scenes[0]!.text);
  assert.equal(props.scenes[1]!.fromFrame, 90);
  assert.equal(props.durationInFrames, 270);
  assert.deepEqual(draft.scenes[0]!.words, oldWords);
  assert.notEqual(result.project.scenes[0]!.text, draft.scenes[0]!.text);
});

test('unchanged alignment keeps its timing and emphasis; invalid estimates fail before mounting', () => {
  const result = parseProjectText(fixtureText('storyboard'));
  assert.ok(result.ok);
  const draft = result.project;
  draft.scenes[0]!.text = draft.scenes[0]!.words.map(word => word.text).join(' ');
  assert.deepEqual(draftVideoProps(draft, {}).scenes[0]!.words, draft.scenes[0]!.words);
  draft.scenes[0]!.text = 'x'.repeat(81);
  assert.throws(() => draftVideoProps(draft, {}), /80/);
  draft.captionStyle.enabled = false;
  assert.doesNotThrow(() => draftVideoProps(draft, {}));
});

test('preview asset cleanup aborts, revokes resolved and late blobs, and does not publish after unmount', async () => {
  const revoked: string[] = [];
  let signal: AbortSignal | undefined;
  let resolveLate!: (blob: { url: string; revoke(): void }) => void;
  let published = false;
  const late = new Promise<{ url: string; revoke(): void }>(resolve => { resolveLate = resolve; });
  const cleanup = loadPreviewAssets('p', ['ready', 'late'], () => { published = true; }, async (_projectId, id, abort) => {
    signal = abort;
    if (id === 'late') return late;
    return { url: 'blob:ready', revoke: () => { revoked.push(id); } };
  });
  await Promise.resolve();
  cleanup();
  assert.equal(signal?.aborted, true);
  assert.deepEqual(revoked, ['ready']);
  resolveLate({ url: 'blob:late', revoke: () => { revoked.push('late'); } });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(revoked, ['ready', 'late']);
  assert.equal(published, false);
});

test('preview asset snapshot reports partial failure and relinquishes URLs on replacement', async () => {
  let revoked = false;
  const published = new Promise<void>(resolve => {
    const cleanup = loadPreviewAssets('p', ['a', 'missing'], (urls, failed) => {
      assert.deepEqual(urls, { a: 'blob:a' });
      assert.deepEqual(failed, ['missing']);
      cleanup();
      assert.equal(revoked, true);
      resolve();
    }, async (_projectId, id) => {
      if (id === 'missing') throw new Error('404');
      return { url: 'blob:a', revoke: () => { revoked = true; } };
    });
  });
  await published;
});
