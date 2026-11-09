import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateKitScene } from '../../src/shared/kit/validate.ts';
import { resolveStyle } from '../../src/video/styles/registry.ts';
import { particleAt } from '../../src/video/kit/particles/state.ts';
import { waterGeometry } from '../../src/video/kit/environment/water.ts';
import { animateObject, identitySeed, seeded } from '../../src/video/kit/animate.ts';
import { labelLayout, anchoredLabelLayout } from '../../src/video/kit/overlays/layout.ts';

const fixture = JSON.parse(readFileSync(new URL('../../docs/plan/examples/kit/sal-del-mar.json', import.meta.url), 'utf8'));

test('anchored pills keep their complete bounds safe at every corner, including the actual Minerales projection', () => {
  for (const [width, height] of [[1080, 1920], [180, 240], [64, 48]]) {
    for (const text of ['Minerales', 'W'.repeat(120), '礦🪨é'.repeat(40)]) {
      for (const [x, y] of [[27.7485, 600], [0, 0], [width!, 0], [0, height!], [width!, height!]]) {
        const layout = anchoredLabelLayout(x!, y!, width!, height!, text);
        assert.ok(layout.left >= layout.margin && layout.top >= layout.margin);
        assert.ok(layout.left + layout.width <= width! - layout.margin + 1e-8);
        assert.ok(layout.top + layout.height <= height! - layout.margin + 1e-8);
        const columns = Math.max(1, Math.floor((layout.width - 2 * layout.paddingX) / (layout.fontSize * 1.1)));
        assert.ok(Math.ceil([...text].length / columns) * layout.fontSize * 1.2 + 2 * layout.paddingY <= layout.height + 1e-8);
        anchoredLabelLayout(500, 900, width!, height!, 'Other frame');
        assert.deepEqual(anchoredLabelLayout(x!, y!, width!, height!, text), layout);
      }
    }
  }
});

test('quality fixture validates against the existing kit contract and timing', () => {
  const result = validateKitScene(fixture, { durationMs: 5000 });
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.scene.camera.move, 'dolly-in');
  assert.equal(result.scene.environment.water?.type, 'river');
  assert.ok(result.scene.labels.length > 0);
  assert.ok(result.scene.particles.length > 0);
});

test('style registry resolves only implemented versions, otherwise returns visible error copy', () => {
  assert.deepEqual(resolveStyle('stylized-3d', 1), { ok: true, renderer: 'kit' });
  for (const [id, version] of [['future-style', 1], ['stylized-3d', 2], ['constructor', 1]] as const) {
    const result = resolveStyle(id, version);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.message, /Estilo no implementado/);
  }
});

test('world-sized text labels fit narrow proportions instead of wrapping into a tall column', () => {
  const narrow = labelLayout(100, 150, 'Catálogo del kit');
  assert.ok(narrow.fontSize * ('Catálogo del kit'.length * 0.7 + 2) <= narrow.width);
  assert.ok(narrow.fontSize < 15);
  assert.deepEqual(labelLayout(400, 40, 'Capas'), { width: 400, height: 40, fontSize: 24 });
});

test('particle systems are bounded, seed-specific and independent of seek order', () => {
  const base = { seed: 23, count: 100, position: [1, 2, 3] as [number, number, number], spread: [4, 5, 6] as [number, number, number], color: '#FFFFFF', speed: 1.5, size: 0.1 };
  for (const type of ['rain', 'bubbles', 'sparkle'] as const) {
    const spec = { ...base, type };
    const before = particleAt(spec, 5, 1000);
    particleAt(spec, 5, 5000);
    assert.deepEqual(particleAt(spec, 5, 1000), before);
    assert.notDeepEqual(particleAt({ ...spec, seed: 24 }, 5, 1000), before);
    for (let i = 0; i < 100; i++) {
      const state = particleAt(spec, i, 8000);
      assert.ok(state.opacity >= 0 && state.opacity <= 1);
      state.position.forEach((n, axis) => assert.ok(Math.abs(n - base.position[axis]!) <= base.spread[axis]! / 2));
    }
  }
});

test('shared object identity does not depend on camera, environment or scene order', () => {
  const result = validateKitScene(fixture);
  assert.ok(result.ok);
  const first = result.scene;
  const second = structuredClone(first);
  second.environment.seed = 999;
  second.objects.reverse();
  for (const object of first.objects) {
    const copy = second.objects.find(o => o.id === object.id)!;
    assert.equal(identitySeed(object), identitySeed(copy));
    assert.deepEqual(animateObject(object, 2000), animateObject(copy, 2000));
  }
  for (let i = 0; i < 100; i++) assert.ok(seeded(1, i) >= 0 && seeded(1, i) < 1);
});

test('river and vertical waterfall ribbons have finite deterministic geometry', () => {
  for (const points of [fixture.environment.water.points, [[0, 5, 0], [0, 0, 0]]] as [number, number, number][][]) {
    const first = waterGeometry(points, 0.5);
    const second = waterGeometry(points, 0.5);
    assert.equal(first.getAttribute('position').count, (points.length - 1) * 6);
    assert.deepEqual(first.getAttribute('position').array, second.getAttribute('position').array);
    assert.ok([...first.getAttribute('normal').array].every(Number.isFinite));
    first.dispose(); second.dispose();
  }
});
