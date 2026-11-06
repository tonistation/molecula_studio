import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseProjectText } from '../../src/shared/schema/index.ts';
import { projectToVideoProps } from '../../src/shared/video-props.ts';
import type { KitScene } from '../../src/shared/kit/types.ts';
import { cameraAt, projectPoint } from '../../src/video/kit/camera.ts';
import { animateObject } from '../../src/video/kit/animate.ts';

function storyboard() {
  const parsed = parseProjectText(readFileSync(new URL('../../docs/plan/examples/kit/sal-del-mar-storyboard.json', import.meta.url), 'utf8'));
  assert.ok(parsed.ok, JSON.stringify(parsed));
  assert.equal(parsed.mode, 'editable');
  return parsed.project;
}

test('salt storyboard is portable, valid and deterministically fills a 30–45 second timeline', () => {
  const project = storyboard();
  const before = structuredClone(project);
  const props = projectToVideoProps(project, {});
  assert.deepEqual(props, projectToVideoProps(project, {}));
  assert.deepEqual(project, before);
  assert.equal(project.output.voiceMode, 'silent');
  assert.deepEqual(project.assets, []);
  assert.ok(props.durationInFrames >= props.fps * 30 && props.durationInFrames <= props.fps * 45);
  let end = 0;
  for (const scene of props.scenes) {
    assert.equal(scene.fromFrame, end);
    end += scene.durationInFrames;
    assert.equal(scene.audioUrl, null);
    assert.ok(scene.words.length > 0);
    assert.equal(scene.words.map(word => word.text).join(' '), scene.text);
  }
  assert.equal(end, props.durationInFrames);
});

test('story follows rain, dissolution, river transport and evaporation with different physical compositions', () => {
  const kits = storyboard().scenes.map(scene => scene.visual as KitScene);
  const [rain, detail, river, sea] = kits;
  assert.ok(rain && detail && river && sea);
  assert.equal(rain.environment.terrain?.type, 'mountain');
  assert.ok(rain.particles.some(particle => particle.type === 'rain'));
  assert.ok(detail.objects.some(object => object.id === 'mineral-grain' && object.animations.some(animation => animation.type === 'move')));
  assert.notDeepEqual(detail.environment, rain.environment);
  assert.equal(river.environment.water?.type, 'river');
  assert.ok(river.objects.some(object => object.id === 'river-drop' && object.animations.some(animation => animation.type === 'move')));
  assert.equal(sea.environment.water?.type, 'sea');
  assert.ok(sea.objects.some(object => object.id === 'vapor-arrow' && object.type === 'arrow' && object.params.direction[1] > 0));
  assert.ok(sea.labels.some(label => label.text === 'Las sales quedan'));
  for (const kit of [detail, sea]) assert.ok(kit.objects.some(object => object.type === 'label' && object.params.text === 'Símbolos ampliados'));
  assert.equal(new Set(kits.map(kit => kit.camera.move)).size, kits.length);
  const rock = rain.objects.find(object => object.id === 'source-rock')!;
  const repeated = detail.objects.find(object => object.id === rock.id)!;
  for (const key of ['type', 'params', 'color', 'seed'] as const) assert.deepEqual(repeated[key], rock[key]);
  const drop = detail.objects.find(object => object.id === 'river-drop')!;
  const downstream = river.objects.find(object => object.id === drop.id)!;
  for (const key of ['type', 'params', 'color', 'seed'] as const) assert.deepEqual(downstream[key], drop[key]);
});

test('authored cameras move and keep label anchors in the safe central picture throughout each shot', () => {
  for (const scene of storyboard().scenes) {
    const kit = scene.visual as KitScene;
    assert.notDeepEqual(kit.camera.from, kit.camera.to);
    for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
      const ms = scene.durationMs * fraction;
      const camera = cameraAt(kit.camera, ms, scene.durationMs, kit.objects);
      for (const label of kit.labels) {
        const object = kit.objects.find(item => item.id === label.objectId)!;
        const point = projectPoint(animateObject(object, ms).position, camera, 1080, 1920);
        assert.ok(point.visible && point.x > 200 && point.x < 880 && point.y > 600 && point.y < 1650,
          `${scene.sceneId}: ${label.text} at ${fraction}: ${JSON.stringify(point)}`);
      }
      for (const object of kit.objects) {
        if (object.type === 'label') {
          const state = animateObject(object, ms);
          const point = projectPoint(state.position, camera, 1080, 1920);
          const distance = Math.hypot(...state.position.map((value, index) => value - camera.position[index]!));
          const pixelsPerUnit = 1920 / (2 * Math.tan(camera.fov * Math.PI / 360) * distance);
          const halfWidth = object.params.proportions.width * state.scale * pixelsPerUnit / 2;
          assert.ok(point.visible && point.x - halfWidth > 120 && point.x + halfWidth < 960 && point.y > 750 && point.y < 1700,
            `${scene.sceneId}: complete schematic note must fit safe picture`);
        }
        if (object.type !== 'arrow' || object.params.direction[1] !== 1) continue;
        const state = animateObject(object, ms);
        const tip = projectPoint([state.position[0], state.position[1] + object.params.proportions.depth * 0.65, state.position[2]], camera, 1080, 1920);
        assert.ok(tip.visible && tip.y > 680, `${scene.sceneId}: vapor tip must clear upper captions: ${tip.y}`);
      }
    }
  }
});
