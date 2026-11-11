import type { CameraKeyframe, Component, Proportions, Vec3 } from '../schema/types.ts';

export type Easing = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out';
export type Pose = 'neutral' | 'wave' | 'arms-up' | 'point' | 'squat';

export interface ObjectParams {
  box: { width: number; height: number; depth: number };
  sphere: { radius: number };
  cylinder: { radius: number; height: number };
  cone: { radius: number; height: number };
  lathe: { profile: [number, number][] };
  rock: { radius: number };
  drop: { radius: number };
  character: { proportions: Proportions; bodyColor: string; accentColor: string; pose?: Pose };
  arrow: { proportions: Proportions; direction: Vec3; color: string };
  car: { proportions: Proportions; bodyColor: string; wheelColor: string };
  rockLayers: { proportions: Proportions; colors: string[] };
  label: { proportions: Proportions; text: string; color: string };
  model: { modelId: string };
}

export interface AnimationParams {
  move: { from: Vec3; to: Vec3 };
  fall: { from: Vec3; to: Vec3 };
  roll: { axis: Vec3; turns: number };
  pulse: { amplitude: number; cycles: number };
  appear: Record<string, never>;
  disappear: Record<string, never>;
  pose: { from: Pose; to: Pose };
}

export type KitAnimation = { [T in keyof AnimationParams]: {
  type: T;
  startMs: number;
  endMs: number;
  easing: Easing;
  params: AnimationParams[T];
} }[keyof AnimationParams];

export type KitObject = { [T in keyof ObjectParams]: {
  id: string;
  type: T;
  params: ObjectParams[T];
  position: Vec3;
  rotation: Vec3;
  scale: number;
  color: string;
  animations: KitAnimation[];
  seed?: number;
  /** Preserves v1 procedural motion and its registered identity without approximating it. */
  legacy?: Pick<Component, 'entityId' | 'definitionVersion' | 'motion' | 'state'>;
} }[keyof ObjectParams];

export type KitCamera = {
  move: 'static' | 'dolly-in' | 'pan' | 'orbit' | 'follow';
  from: Vec3;
  to: Vec3;
  easing: Easing;
  /** Optional v1 track: every position, target, timestamp and FOV is retained. */
  keyframes?: CameraKeyframe[];
} & ({ target: Vec3; targetObjectId?: never } | { targetObjectId: string; target?: never });

export interface KitScene {
  kind: 'kit';
  kitVersion: 1;
  palette: { background: string; preset?: 'daylight' | 'dark' };
  sky: {
    top: string;
    bottom: string;
    sun: { position: Vec3; radius: number; color: string } | null;
    clouds: { position: Vec3; scale: number }[];
  };
  environment: {
    seed: number;
    terrain: { type: 'mountain' | 'cliff' | 'plain'; color: string; height: number; size: number } | null;
    water: { type: 'sea'; color: string; level: number; size: number }
      | { type: 'river' | 'waterfall'; color: string; points: Vec3[]; width: number } | null;
  };
  objects: KitObject[];
  particles: {
    type: 'sparkle' | 'rain' | 'bubbles';
    seed: number;
    count: number;
    position: Vec3;
    spread: Vec3;
    color: string;
    speed: number;
    size: number;
  }[];
  labels: { objectId: string; text: string; color: string }[];
  overlays: ({ type: 'counter'; from: number; to: number; startMs: number; endMs: number; color: string }
    | { type: 'chevrons'; count: number; direction: 'left' | 'right' | 'up' | 'down'; color: string })[];
  camera: KitCamera;
}
