import test from 'node:test';
import assert from 'node:assert/strict';
import { riverBanksGeometry, waterGeometry } from '../../src/video/kit/environment/water.ts';
import type { Vec3 } from '../../src/shared/schema/types.ts';

test('river banks flank the channel, follow height and leave its center open', () => {
  const points: Vec3[] = [[0, 2, 0], [0, 1, 4], [0, 0, 8]];
  const banks = riverBanksGeometry(points, 2);
  const vertices = banks.getAttribute('position');
  assert.equal(vertices.count, 24);
  const xs = new Set(Array.from({ length: vertices.count }, (_, i) => Math.abs(vertices.getX(i)).toFixed(2)));
  assert.deepEqual(xs, new Set(['0.92', '1.36']));
  banks.computeBoundingBox();
  assert.ok(Math.abs(banks.boundingBox!.min.y - -0.04) < 1e-6);
  assert.ok(Math.abs(banks.boundingBox!.max.y - 2.16) < 1e-6);
  assert.ok(Array.from(vertices.array).every(Number.isFinite));
  const normals = banks.getAttribute('normal');
  for (let i = 0; i < normals.count; i++) assert.ok(normals.getY(i) > 0);
  banks.dispose();
});

test('bent river and banks are deterministic, finite and do not mutate their centerline', () => {
  const points: Vec3[] = [[-2, 1, 0], [0, 0.5, 2], [3, 0, 3]];
  const original = structuredClone(points);
  for (const make of [waterGeometry, riverBanksGeometry]) {
    const a = make(points, 1.4);
    const b = make(points, 1.4);
    assert.deepEqual(a.getAttribute('position').array, b.getAttribute('position').array);
    assert.ok(Array.from(a.getAttribute('position').array).every(Number.isFinite));
    const normals = a.getAttribute('normal');
    for (let i = 0; i < normals.count; i++) assert.ok(normals.getY(i) > 0, 'upward surface normals');
    a.dispose(); b.dispose();
  }
  assert.deepEqual(points, original);
});
