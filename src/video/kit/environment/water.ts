import { BufferGeometry, Float32BufferAttribute, Vector3 } from 'three';
import type { Vec3 } from '../../../shared/schema/types.ts';

/** Joined ribbon avoids overlapping boxes and keeps a continuous river silhouette. */
export function waterGeometry(points: Vec3[], width: number): BufferGeometry {
  return ribbonGeometry(courseEdges(points, width / 2));
}

function courseEdges(points: Vec3[], offset: number): [Vector3, Vector3][] {
  return points.map((point, i) => {
    const before = new Vector3(...points[Math.max(0, i - 1)]!);
    const after = new Vector3(...points[Math.min(points.length - 1, i + 1)]!);
    const tangent = after.sub(before);
    const side = new Vector3(tangent.z, 0, -tangent.x);
    if (side.lengthSq() < 1e-10) side.set(1, 0, 0);
    side.normalize().multiplyScalar(offset);
    const center = new Vector3(...point);
    return [center.clone().add(side), center.clone().sub(side)];
  });
}

/** Sloped banks intersect the water edge, not a wider plane underneath its center. */
export function riverBanksGeometry(points: Vec3[], width: number): BufferGeometry {
  const inner = courseEdges(points, width * 0.46);
  const outer = courseEdges(points, width * 0.68);
  const banks: [Vector3, Vector3][][] = [0, 1].map(side => points.map((_, i) => {
    const low = inner[i]![side]!.clone().add(new Vector3(0, -width * 0.02, 0));
    const high = outer[i]![side]!.clone().add(new Vector3(0, width * 0.08, 0));
    return side === 0 ? [high, low] : [low, high];
  }));
  return ribbonGeometry(...banks);
}

function ribbonGeometry(...courses: [Vector3, Vector3][][]): BufferGeometry {
  const vertices: number[] = [];
  const triangle = (a: Vector3, b: Vector3, c: Vector3) => vertices.push(...a.toArray(), ...b.toArray(), ...c.toArray());
  for (const edges of courses) for (let i = 0; i < edges.length - 1; i++) {
    const [a, b] = edges[i]! as [Vector3, Vector3];
    const [c, d] = edges[i + 1]! as [Vector3, Vector3];
    triangle(a, b, c);
    triangle(b, d, c);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3));
  geometry.computeVertexNormals();
  return geometry;
}
