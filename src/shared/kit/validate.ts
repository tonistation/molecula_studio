import type { Entity, Issue } from '../schema/types.ts';
import { LIMITS } from '../schema/limits.ts';
import { canonicalize } from '../canonical.ts';
import { MODEL_ID_PATTERN } from '../models/model.ts';
import type { KitScene } from './types.ts';
import { KIT_ANIMATION_TYPES, KIT_CAMERA_MOVES, KIT_EASINGS, KIT_LIMITS,
  KIT_OBJECT_TYPES, KIT_PARTICLE_TYPES, KIT_POSES } from './schema.ts';

type Rule = (value: unknown, path: string, issues: Issue[]) => void;
type RecordValue = Record<string, unknown>;
const report = (issues: Issue[], path: string, code: string, message: string): void => {
  issues.push({ path, code, message });
};
const record = (value: unknown): value is RecordValue => typeof value === 'object' && value !== null && !Array.isArray(value);

const number = (min: number, max: number, integer = false): Rule => (value, path, issues) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || (integer && !Number.isSafeInteger(value))) {
    report(issues, path, 'type', integer ? 'must be a safe integer' : 'must be a finite number');
  } else if (value < min || value > max) report(issues, path, 'range', `must be between ${min} and ${max}`);
};
const text = (min: number, max: number, pattern?: RegExp): Rule => (value, path, issues) => {
  if (typeof value !== 'string') return report(issues, path, 'type', 'must be a string');
  if (Array.from(value).length < min || Array.from(value).length > max) report(issues, path, 'range', `must be ${min}-${max} characters`);
  if (/[\x00-\x08\x0b-\x1f\x7f]/.test(value)) report(issues, path, 'text-control', 'forbidden control character');
  if (pattern && !pattern.test(value)) report(issues, path, 'pattern', `must match ${pattern}`);
};
const enumeration = (values: readonly unknown[]): Rule => (value, path, issues) => {
  if (!values.includes(value)) report(issues, path, 'const', `must be one of ${values.join(', ')}`);
};
const object = (required: Record<string, Rule>, optional: Record<string, Rule> = {}): Rule => (value, path, issues) => {
  if (!record(value)) return report(issues, path, 'type', 'must be an object');
  for (const key of Object.keys(value)) {
    if (!Object.hasOwn(required, key) && !Object.hasOwn(optional, key)) report(issues, `${path}.${key}`, 'unknown-key', `unknown key "${key}"`);
  }
  for (const [key, rule] of Object.entries(required)) {
    if (!Object.hasOwn(value, key)) report(issues, `${path}.${key}`, 'required', 'required field');
    else rule(value[key], `${path}.${key}`, issues);
  }
  for (const [key, rule] of Object.entries(optional)) if (Object.hasOwn(value, key)) rule(value[key], `${path}.${key}`, issues);
};
const array = (rule: Rule, max: number, min = 0): Rule => (value, path, issues) => {
  if (!Array.isArray(value)) return report(issues, path, 'type', 'must be an array');
  if (value.length < min || value.length > max) report(issues, path, 'limit', `must contain ${min}-${max} items`);
  value.slice(0, max).forEach((item, index) => rule(item, `${path}[${index}]`, issues));
};
const nullable = (rule: Rule): Rule => (value, path, issues) => { if (value !== null) rule(value, path, issues); };
const vec = (min: number, max: number, length = 3): Rule => array(number(min, max), length, length);
const vector = vec(-100, 100);
const unit: Rule = (value, path, issues) => {
  vec(-1, 1)(value, path, issues);
  if (Array.isArray(value) && value.length === 3 && value.every(item => typeof item === 'number' && Number.isFinite(item))) {
    if (Math.abs(Math.hypot(value[0], value[1], value[2]) - 1) > 1e-6) {
      report(issues, path, 'range', 'must be a non-zero unit vector');
    }
  }
};
const id = text(1, 64, /^[a-z][a-z0-9_-]{0,63}$/);
const color = text(7, 7, /^#[0-9a-fA-F]{6}$/);
const size = number(0.1, 100);
const seed = number(0, 4294967295, true);
const proportions = object({ width: number(0.1, 10), height: number(0.1, 10), depth: number(0.1, 10) });
const pose = enumeration(KIT_POSES);

const params: Record<string, Rule> = {
  box: object({ width: size, height: size, depth: size }),
  sphere: object({ radius: size }), cylinder: object({ radius: size, height: size }),
  cone: object({ radius: size, height: size }),
  lathe: object({ profile: array(vec(0, 100, 2), KIT_LIMITS.profilePoints, 2) }),
  rock: object({ radius: size }), drop: object({ radius: size }),
  character: object({ proportions, bodyColor: color, accentColor: color }, { pose }),
  arrow: object({ proportions, color, direction: unit }),
  car: object({ proportions, bodyColor: color, wheelColor: color }),
  rockLayers: object({ proportions, colors: array(color, 6, 2) }),
  label: object({ proportions, text: text(1, 120), color }),
  model: object({ modelId: text(64, 64, MODEL_ID_PATTERN) }),
};
const animationParams: Record<string, Rule> = {
  move: object({ from: vector, to: vector }), fall: object({ from: vector, to: vector }),
  roll: object({ axis: unit, turns: number(-100, 100) }),
  pulse: object({ amplitude: number(0, 1), cycles: number(0.1, 100) }),
  appear: object({}), disappear: object({}), pose: object({ from: pose, to: pose }),
};

function variant(field: string, rules: Record<string, Rule>): Rule {
  return (value, path, issues) => {
    if (!record(value)) return report(issues, path, 'type', 'must be an object');
    const type = value[field];
    if (typeof type === 'string' && Object.hasOwn(rules, type)) rules[type]!(value, path, issues);
    else report(issues, `${path}.${field}`, 'const', `unknown ${field}`);
  };
}

/** Checks direct callers as well as JSON callers: reject cycles, prototypes and executable/non-JSON values. */
function inspect(value: unknown, path: string, issues: Issue[], seen = new Set<object>(), depth = 1): void {
  if (depth > LIMITS.maxDepth) return report(issues, path, 'depth', 'maximum nesting exceeded');
  if (typeof value === 'number' && !Number.isFinite(value)) return report(issues, path, 'type', 'must be finite');
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return;
  if (typeof value !== 'object') return report(issues, path, 'type', 'must be JSON data');
  if (seen.has(value)) return report(issues, path, 'cycle', 'cyclic data');
  if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    return report(issues, path, 'type', 'must be a plain object');
  }
  seen.add(value);
  if (Object.getOwnPropertySymbols(value).length > 0) report(issues, path, 'type', 'symbol keys are not JSON data');
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) report(issues, `${path}[${index}]`, 'type', 'sparse arrays are not JSON data');
    }
  }
  for (const key of Object.getOwnPropertyNames(value)) {
    if (Array.isArray(value) && key === 'length') continue;
    if (Array.isArray(value) && !/^(0|[1-9][0-9]*)$/.test(key)) report(issues, `${path}.${key}`, 'type', 'array properties are not JSON data');
    if (['__proto__', 'constructor', 'prototype'].includes(key)) report(issues, `${path}.${key}`, 'dangerous-key', 'forbidden key');
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!descriptor.enumerable || !('value' in descriptor)) report(issues, `${path}.${key}`, 'type', 'hidden properties and accessors are not JSON data');
    else inspect(descriptor.value, `${path}.${key}`, issues, seen, depth + 1);
  }
  seen.delete(value);
}

export interface KitValidationOptions { durationMs?: number; entities?: Map<string, Entity>; modelIds?: ReadonlySet<string> }
export type KitValidationOutcome = { ok: true; scene: KitScene } | { ok: false; issues: Issue[] };

/** Validates a declarative scene; no code, arbitrary parameter bags or URLs are interpreted. */
export function validateKitScene(value: unknown, options: KitValidationOptions = {}): KitValidationOutcome {
  const issues: Issue[] = [];
  inspect(value, '$', issues);
  if (issues.length > 0) return { ok: false, issues };
  const duration = options.durationMs ?? LIMITS.maxSceneMs;
  const time = number(0, duration, true);
  const interval = (value: unknown, path: string): void => {
    if (record(value) && typeof value.startMs === 'number' && typeof value.endMs === 'number' && value.endMs <= value.startMs) {
      report(issues, `${path}.endMs`, 'order', 'must be after startMs');
    }
  };
  const animation: Rule = (value, path, findings) => {
    object({ type: enumeration(KIT_ANIMATION_TYPES), startMs: time, endMs: time, easing: enumeration(KIT_EASINGS),
      params: (p, at, errors) => {
        if (record(value) && typeof value.type === 'string' && Object.hasOwn(animationParams, value.type)) animationParams[value.type]!(p, at, errors);
      } })(value, path, findings);
    interval(value, path);
  };
  const kitObject = object({ id, type: enumeration([...KIT_OBJECT_TYPES, 'model']),
    params: (_value, _path, _issues) => {}, position: vector, rotation: vec(-6.284, 6.284),
    scale: number(0.1, 10), color, animations: array(animation, KIT_LIMITS.animationsPerObject) }, {
    seed, legacy: object({ entityId: id, definitionVersion: number(1, Number.MAX_SAFE_INTEGER, true),
      motion: enumeration(['none', 'idle', 'pulse', 'reveal']), state: enumeration(['default']) }),
  });
  const camera = object({ move: enumeration(KIT_CAMERA_MOVES), from: vector, to: vector, easing: enumeration(KIT_EASINGS) }, {
    target: vector, targetObjectId: id,
    keyframes: array(object({ atMs: time, position: vector, target: vector, fovDeg: number(20, 80) }), LIMITS.maxCameraKeyframes, 1),
  });
  const water = variant('type', {
    sea: object({ type: enumeration(['sea']), color, level: number(-100, 100), size }),
    river: object({ type: enumeration(['river']), color, points: array(vector, KIT_LIMITS.points, 2), width: size }),
    waterfall: object({ type: enumeration(['waterfall']), color, points: array(vector, KIT_LIMITS.points, 2), width: size }),
  });
  const overlay = variant('type', {
    counter: object({ type: enumeration(['counter']), from: number(0, 9999), to: number(0, 9999), startMs: time, endMs: time, color }),
    chevrons: object({ type: enumeration(['chevrons']), count: number(1, 8, true), direction: enumeration(['left', 'right', 'up', 'down']), color }),
  });
  object({ kind: enumeration(['kit']), kitVersion: enumeration([1]),
    palette: object({ background: color }, { preset: enumeration(['daylight', 'dark']) }),
    sky: object({ top: color, bottom: color, sun: nullable(object({ position: vector, radius: size, color })),
      clouds: array(object({ position: vector, scale: number(0.1, 10) }), KIT_LIMITS.clouds) }),
    environment: object({ seed, terrain: nullable(object({ type: enumeration(['mountain', 'cliff', 'plain']), color, height: number(0, 100), size })), water: nullable(water) }),
    objects: array((item, path, errors) => {
      kitObject(item, path, errors);
      if (record(item) && typeof item.type === 'string' && Object.hasOwn(params, item.type)) params[item.type]!(item.params, `${path}.params`, errors);
    }, KIT_LIMITS.objects),
    particles: array(object({ type: enumeration(KIT_PARTICLE_TYPES), seed, count: number(1, KIT_LIMITS.particlesPerSystem, true),
      position: vector, spread: vec(0, 100), color, speed: number(0, 100), size: number(0.01, 10) }), KIT_LIMITS.particles),
    labels: array(object({ objectId: id, text: text(1, 120), color }), KIT_LIMITS.labels),
    overlays: array(overlay, KIT_LIMITS.overlays), camera,
  })(value, '$', issues);
  if (issues.length > 0) return { ok: false, issues };
  const scene = value as KitScene;
  const ids = new Set<string>();
  for (const [index, item] of scene.objects.entries()) {
    const path = `$.objects[${index}]`;
    if (ids.has(item.id)) report(issues, `${path}.id`, 'unique', 'duplicate object id');
    ids.add(item.id);
    if (item.type === 'model' && options.modelIds && !options.modelIds.has(item.params.modelId)) {
      report(issues, `${path}.params.modelId`, 'reference', 'model snapshot is not registered');
    }
    if (item.legacy && options.entities) {
      const entity = options.entities.get(item.legacy.entityId);
      if (!entity || entity.definitionVersion !== item.legacy.definitionVersion) {
        report(issues, `${path}.legacy`, 'reference', 'entity version is not registered');
      } else {
        const identity = entity.identity;
        const expectedColor = identity.type === 'rockLayers' ? identity.props.colors[0]!
          : identity.type === 'character' || identity.type === 'car' ? identity.props.bodyColor : identity.props.color;
        const expectedParams = { proportions: identity.proportions, ...identity.props };
        if (identity.type !== item.type || entity.seed !== item.seed || item.color !== expectedColor
          || canonicalize(item.params) !== canonicalize(expectedParams)) {
          report(issues, `${path}.legacy`, 'reference', 'legacy object must match its registered identity');
        }
      }
    }
  }
  for (const [index, label] of scene.labels.entries()) {
    if (!ids.has(label.objectId)) report(issues, `$.labels[${index}].objectId`, 'reference', 'object is not registered');
  }
  scene.overlays.forEach((value, index) => { if (value.type === 'counter') interval(value, `$.overlays[${index}]`); });
  const cam = scene.camera;
  if (Object.hasOwn(cam, 'target') === Object.hasOwn(cam, 'targetObjectId')) report(issues, '$.camera', 'required', 'exactly one of target or targetObjectId is required');
  if (cam.targetObjectId && !ids.has(cam.targetObjectId)) report(issues, '$.camera.targetObjectId', 'reference', 'object is not registered');
  if (cam.move === 'follow' && !cam.targetObjectId) report(issues, '$.camera.targetObjectId', 'required', 'follow requires targetObjectId');
  if (cam.target && canonicalize(cam.from) === canonicalize(cam.target)) report(issues, '$.camera.target', 'range', 'camera position and target must differ');
  let previous = -1;
  cam.keyframes?.forEach((frame, index) => {
    const path = `$.camera.keyframes[${index}]`;
    if ((index === 0 && frame.atMs !== 0) || frame.atMs <= previous) report(issues, `${path}.atMs`, 'order', 'keyframes must start at zero and strictly increase');
    if (canonicalize(frame.position) === canonicalize(frame.target)) report(issues, `${path}.target`, 'range', 'camera position and target must differ');
    previous = frame.atMs;
  });
  return issues.length > 0 ? { ok: false, issues } : { ok: true, scene: structuredClone(scene) };
}
