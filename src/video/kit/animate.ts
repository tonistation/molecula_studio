import type { Easing, KitObject, Pose } from '../../shared/kit/types.ts';
import type { Vec3 } from '../../shared/schema/types.ts';
import { Euler, Quaternion, Vector3 } from 'three';

export function ease(value: number, kind: Easing): number {
  const t = Math.max(0, Math.min(1, value));
  if (kind === 'ease-in') return t * t;
  if (kind === 'ease-out') return 1 - (1 - t) ** 2;
  if (kind === 'ease-in-out') return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
  return t;
}

export const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
export const mixVec = (a: Vec3, b: Vec3, t: number): Vec3 => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
export const progress = (ms: number, start: number, end: number): number => end <= start ? Number(ms >= end) : (ms - start) / (end - start);

export function identitySeed(object: KitObject): number {
  if (object.seed !== undefined) return object.seed;
  let hash = 2166136261;
  for (const char of object.id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0;
}

/** Stateless indexed noise: geometry never depends on scene order or previous frames. */
export function seeded(seed: number, index: number): number {
  let n = Math.imul((seed ^ index) >>> 0, 0x45d9f3b);
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

export type JointPose = { leftArm: number; rightArm: number; crouch: number };
const poses: Record<Pose, JointPose> = {
  neutral: { leftArm: 0, rightArm: 0, crouch: 0 },
  wave: { leftArm: 0, rightArm: -2.5, crouch: 0 },
  'arms-up': { leftArm: 2.8, rightArm: -2.8, crouch: 0 },
  point: { leftArm: 0, rightArm: -1.6, crouch: 0 },
  squat: { leftArm: 0.5, rightArm: -0.5, crouch: 0.35 },
};

export function animateObject(object: KitObject, ms: number) {
  let position: Vec3 = [...object.position];
  const rotation: Vec3 = [...object.rotation];
  const orientation = new Quaternion().setFromEuler(new Euler(...rotation));
  let scale = object.scale;
  let opacity = object.animations.some(a => a.type === 'appear') ? 0 : 1;
  let pose = poses[object.type === 'character' ? object.params.pose ?? 'neutral' : 'neutral'];
  const seconds = Math.max(0, ms) / 1000;
  if (object.legacy?.motion === 'idle') position[1] += Math.sin(seconds * 2 + seeded(identitySeed(object), 0) * Math.PI * 2) * 0.04;
  if (object.legacy?.motion === 'pulse') scale *= 1 + Math.sin(seconds * 3) * 0.08;
  if (object.legacy?.motion === 'reveal') opacity = ease(ms / 500, 'ease-out');
  for (const animation of object.animations) {
    if (ms < animation.startMs) continue;
    const t = ease(progress(ms, animation.startMs, animation.endMs), animation.easing);
    switch (animation.type) {
      case 'move': case 'fall': position = mixVec(animation.params.from, animation.params.to, t); break;
      case 'roll': {
        orientation.multiply(new Quaternion().setFromAxisAngle(new Vector3(...animation.params.axis).normalize(), animation.params.turns * Math.PI * 2 * t));
        break;
      }
      case 'pulse': scale *= 1 + animation.params.amplitude * Math.sin(t * Math.PI * 2 * animation.params.cycles); break;
      case 'appear': opacity = t; break;
      case 'disappear': opacity = 1 - t; break;
      case 'pose': {
        const a = poses[animation.params.from];
        const b = poses[animation.params.to];
        pose = { leftArm: mix(a.leftArm, b.leftArm, t), rightArm: mix(a.rightArm, b.rightArm, t), crouch: mix(a.crouch, b.crouch, t) };
        break;
      }
    }
  }
  const angles = new Euler().setFromQuaternion(orientation);
  rotation[0] = angles.x;
  rotation[1] = angles.y;
  rotation[2] = angles.z;
  return { position, rotation, scale, opacity, pose };
}
