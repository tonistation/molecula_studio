import { BufferGeometry, Float32BufferAttribute, Vector3 } from 'three';
import type { Vec3 } from '../../../shared/schema/types.ts';

/** Joined ribbon avoids overlapping boxes and keeps a continuous river silhouette. */
export function waterGeometry(points: Vec3[], width: number): BufferGeometry {
  const vertices: number[] = [];
  const edges = points.map((point, i) => {
    const before = new Vector3(...points[Math.max(0, i - 1)]!);
    const after = new Vector3(...points[Math.min(points.length - 1, i + 1)]!);
    const tangent = after.sub(before);
    const side = new Vector3(tangent.z, 0, -tangent.x);
    if (side.lengthSq() < 1e-10) side.set(1, 0, 0);
    side.normalize().multiplyScalar(width / 2);
    const center = new Vector3(...point);
    return [center.clone().add(side), center.clone().sub(side)];
  });
  const triangle = (a: Vector3, b: Vector3, c: Vector3) => vertices.push(...a.toArray(), ...b.toArray(), ...c.toArray());
  for (let i = 0; i < edges.length - 1; i++) {
    const [a, b] = edges[i]! as [Vector3, Vector3];
    const [c, d] = edges[i + 1]! as [Vector3, Vector3];
    triangle(a, c, b);
    triangle(b, c, d);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3));
  geometry.computeVertexNormals();
  return geometry;
}
