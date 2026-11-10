import test from 'node:test';
import assert from 'node:assert/strict';
import { ConeGeometry, CylinderGeometry, Vector3 } from 'three';
import { arrowShape } from '../../src/video/kit/objects/arrow-shape.ts';

test('arrow keeps every envelope dimension and fits both historical and height-authored arrows', () => {
  for (const proportions of [
    { width: 0.28, height: 1.5, depth: 0.18 },
    { width: 0.18, height: 0.28, depth: 1.5 },
  ]) {
    const shape = arrowShape(proportions, [1, 0, 0]);
    assert.equal(shape.length, 1.5);
    assert.equal(shape.headWidth, 0.28);
    assert.equal(shape.headDepth, 0.18);
    assert.equal(shape.headLength, 1.5 * 0.35);
    assert.equal(shape.shaftLength + shape.headLength, shape.length);
    assert.equal(shape.shaftCenter - shape.shaftLength / 2, -shape.length / 2);
    assert.equal(shape.headCenter + shape.headLength / 2, shape.length / 2);
    assert.ok(Math.abs(shape.shaftCenter + shape.shaftLength / 2 - (shape.headCenter - shape.headLength / 2)) < 1e-12);
    assert.ok(shape.shaftWidth < shape.headWidth && shape.shaftDepth < shape.headDepth);
  }
});

test('arrow has closed nondegenerate meshes, centered bounds and identical orientation for every direction', () => {
  for (const dimensions of [[0.01, 0.01, 0.01], [100, 0.01, 2], [0.28, 1.5, 0.18]]) {
    for (const direction of [[1, 0, 0], [0, -1, 0], [0, 0, 1], [0.6, 0.8, 0], [0.60000001, 0.80000001, 0]] as [number, number, number][]) {
      const [width, height, depth] = dimensions as [number, number, number];
      const s = arrowShape({ width, height, depth }, direction);
      const oriented = new Vector3(0, 1, 0).applyQuaternion(s.quaternion);
      assert.ok(oriented.distanceTo(new Vector3(...direction).normalize()) < 1e-12);
      const shaft = new CylinderGeometry(0.5, 0.5, 1, 8, 1, false);
      const head = new ConeGeometry(0.5, 1, 8, 1, false);
      shaft.scale(s.shaftWidth, s.shaftLength, s.shaftDepth).translate(0, s.shaftCenter, 0);
      head.scale(s.headWidth, s.headLength, s.headDepth).translate(0, s.headCenter, 0);
      for (const geometry of [shaft, head]) {
        assert.equal(geometry.parameters.openEnded, false);
        const positions = geometry.getAttribute('position');
        const normals = geometry.getAttribute('normal');
        assert.ok(Array.from(positions.array).every(Number.isFinite));
        for (let i = 0; i < normals.count; i++) assert.ok(Math.abs(new Vector3().fromBufferAttribute(normals, i).length() - 1) < 1e-6);
        geometry.computeBoundingBox();
        assert.ok(geometry.boundingBox!.max.y > geometry.boundingBox!.min.y);
        const index = geometry.getIndex()!;
        for (let i = 0; i < index.count; i += 3) {
          const a = new Vector3().fromBufferAttribute(positions, index.getX(i));
          const b = new Vector3().fromBufferAttribute(positions, index.getX(i + 1));
          const c = new Vector3().fromBufferAttribute(positions, index.getX(i + 2));
          assert.ok(b.sub(a).cross(c.sub(a)).lengthSq() > 0, 'no zero-area triangles');
        }
        geometry.dispose();
      }
    }
  }
});
