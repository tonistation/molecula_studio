import { PerspectiveCamera, Vector3 } from 'three';
import type { KitCamera, KitObject } from '../../shared/kit/types.ts';
import type { Vec3 } from '../../shared/schema/types.ts';
import { animateObject, ease, mix, mixVec, progress } from './animate.ts';

export interface CameraState { position: Vec3; target: Vec3; fov: number }

export function cameraAt(spec: KitCamera, ms: number, durationMs: number, objects: KitObject[]): CameraState {
  const track = spec.keyframes;
  if (track?.length) {
    const a = [...track].reverse().find(k => k.atMs <= ms) ?? track[0]!;
    const b = track.find(k => k.atMs > ms) ?? a;
    const t = ease(progress(ms, a.atMs, b.atMs), spec.easing);
    return { position: mixVec(a.position, b.position, t), target: mixVec(a.target, b.target, t), fov: mix(a.fovDeg, b.fovDeg, t) };
  }
  const object = spec.targetObjectId ? objects.find(o => o.id === spec.targetObjectId) : undefined;
  if (spec.targetObjectId && !object) throw new Error(`Camera target missing: ${spec.targetObjectId}`);
  const target = object ? animateObject(object, ms).position : spec.target!;
  const t = ease(progress(ms, 0, durationMs), spec.easing);
  let position = spec.move === 'static' ? [...spec.from] as Vec3 : mixVec(spec.from, spec.to, t);
  if (spec.move === 'orbit') {
    const a = spec.from.map((v, i) => v - target[i]!) as Vec3;
    const b = spec.to.map((v, i) => v - target[i]!) as Vec3;
    const angle = Math.atan2(a[0], a[2]);
    const delta = Math.atan2(Math.sin(Math.atan2(b[0], b[2]) - angle), Math.cos(Math.atan2(b[0], b[2]) - angle));
    const radius = mix(Math.hypot(a[0], a[2]), Math.hypot(b[0], b[2]), t);
    position = [target[0] + Math.sin(angle + delta * t) * radius, mix(spec.from[1], spec.to[1], t), target[2] + Math.cos(angle + delta * t) * radius];
  }
  // Follow interprets from/to as camera offsets from the animated subject.
  if (spec.move === 'follow') position = position.map((v, i) => v + target[i]!) as Vec3;
  return { position, target, fov: 45 };
}

export function makeCamera(state: CameraState, width: number, height: number): PerspectiveCamera {
  const camera = new PerspectiveCamera(state.fov, width / height, 0.01, 2000);
  camera.position.set(...state.position);
  camera.lookAt(...state.target);
  camera.updateMatrixWorld();
  return camera;
}

export function projectPoint(point: Vec3, state: CameraState, width: number, height: number) {
  const camera = makeCamera(state, width, height);
  const projected = new Vector3(...point).project(camera);
  return { x: (projected.x + 1) * width / 2, y: (1 - projected.y) * height / 2,
    visible: projected.z >= -1 && projected.z <= 1 && Math.abs(projected.x) <= 1 && Math.abs(projected.y) <= 1 };
}
