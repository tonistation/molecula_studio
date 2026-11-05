import test from 'node:test';
import assert from 'node:assert/strict';
import { parseProjectText } from '../../src/shared/schema/index.ts';
import { projectToVideoProps } from '../../src/shared/video-props.ts';
import { fixtureText } from '../helpers/fixtures.ts';

function storyboard() {
  const result = parseProjectText(fixtureText('storyboard'));
  assert.ok(result.ok);
  return result.project;
}

test('converts storyboard into contiguous frame ranges and preserves rendering inputs', () => {
  const project = storyboard();
  const props = projectToVideoProps(project, {});
  assert.equal(props.fps, 30);
  assert.equal(props.width, 1080);
  assert.equal(props.height, 1920);
  assert.equal(props.durationInFrames, 360);
  assert.deepEqual(props.scenes.map(s => [s.fromFrame, s.durationInFrames]), [[0, 180], [180, 180]]);
  assert.deepEqual(props.entities, project.entities);
  assert.equal(props.scenes[0]!.text, project.scenes[0]!.text);
  assert.deepEqual(props.scenes[0]!.visual, project.scenes[0]!.visual);
  assert.deepEqual(props.scenes[0]!.words, project.scenes[0]!.words);
  assert.equal(props.scenes[0]!.audioUrl, null);
});

test('is deterministic and does not mutate its inputs', () => {
  const project = storyboard();
  const before = structuredClone(project);
  assert.deepEqual(projectToVideoProps(project, {}), projectToVideoProps(project, {}));
  assert.deepEqual(project, before);
});

test('retains visual intent when there is no visual', () => {
  const project = storyboard();
  project.scenes[0]!.visual = null;
  const scene = projectToVideoProps(project, {}).scenes[0]!;
  assert.equal(scene.visual, null);
  assert.equal(scene.visualIntent, project.scenes[0]!.visualIntent);
});

test('maps selected audio URL and gain', () => {
  const project = storyboard();
  project.scenes[0]!.audio = { assetId: 'asset_voice', offsetMs: 0, gainDb: -3 };
  const scene = projectToVideoProps(project, { asset_voice: 'blob:audio' }).scenes[0]!;
  assert.equal(scene.audioUrl, 'blob:audio');
  assert.equal(scene.gainDb, -3);
});

test('rejects unsupported styles and inert visuals explicitly', () => {
  const unknown = storyboard();
  unknown.styleId = 'unknown-style';
  assert.throws(() => projectToVideoProps(unknown, {}), /style/i);
  const inert = storyboard();
  inert.scenes[0]!.visual = { inert: {} };
  assert.throws(() => projectToVideoProps(inert, {}), /visual/i);
});
