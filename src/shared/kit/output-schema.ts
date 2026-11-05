import { LIMITS } from '../schema/limits.ts';
import { KIT_ANIMATION_TYPES, KIT_CAMERA_MOVES, KIT_EASINGS, KIT_LIMITS,
  KIT_OBJECT_TYPES, KIT_PARTICLE_TYPES, KIT_POSES } from './schema.ts';

type Node = Record<string, unknown>;
const object = (properties: Record<string, Node>): Node => ({ type: 'object', additionalProperties: false,
  required: Object.keys(properties), properties });
const number = (minimum: number, maximum: number, integer = false): Node => ({ type: integer ? 'integer' : 'number', minimum, maximum });
const text = (minLength: number, maxLength: number, pattern = '^[^\\u0000-\\u0008\\u000b-\\u001f\\u007f]*$'): Node => ({ type: 'string', minLength, maxLength, pattern });
const enumeration = (values: readonly (string | number)[]): Node => ({ type: typeof values[0] === 'number' ? 'integer' : 'string', enum: values });
const array = (items: Node, maxItems: number, minItems = 0): Node => ({ type: 'array', items, minItems, maxItems });
const choice = (...anyOf: Node[]): Node => ({ anyOf });
const nullable = (node: Node): Node => choice(node, { type: 'null' });
const ref = (name: string): Node => ({ $ref: `#/$defs/${name}` });
const vector = (min = -100, max = 100, length = 3): Node => min === -100 && max === 100 && length === 3
  ? ref('vector') : array(number(min, max), length, length);

/** Presence variants keep optional persisted fields optional without nullable wire normalization. */
function variants(required: Record<string, Node>, optional: Record<string, Node>): Node {
  let possibilities = [required];
  for (const [key, schema] of Object.entries(optional)) {
    possibilities = possibilities.flatMap(properties => [properties, { ...properties, [key]: schema }]);
  }
  return choice(...possibilities.map(object));
}

const color = ref('color');
const id = ref('id');
const size = ref('size');
const seed = ref('seed');
const time = ref('time');
const easing = ref('easing');
const pose = enumeration(KIT_POSES);
const proportions = ref('proportions');
const unit = { ...vector(-1, 1), description: 'Vector unitario no nulo; norma 1 con tolerancia 1e-6, validada al importar.' };

const objectParams: Record<string, Node> = {
  box: object({ width: size, height: size, depth: size }),
  sphere: object({ radius: size }), cylinder: object({ radius: size, height: size }),
  cone: object({ radius: size, height: size }),
  lathe: object({ profile: array(vector(0, 100, 2), KIT_LIMITS.profilePoints, 2) }),
  rock: object({ radius: size }), drop: object({ radius: size }),
  character: variants({ proportions, bodyColor: color, accentColor: color }, { pose }),
  arrow: object({ proportions, direction: unit, color }),
  car: object({ proportions, bodyColor: color, wheelColor: color }),
  rockLayers: object({ proportions, colors: array(color, 6, 2) }),
  label: object({ proportions, text: text(1, 120), color }),
};
const animationParams: Record<string, Node> = {
  move: object({ from: vector(), to: vector() }), fall: object({ from: vector(), to: vector() }),
  roll: object({ axis: unit, turns: number(-100, 100) }),
  pulse: object({ amplitude: number(0, 1), cycles: number(0.1, 100) }),
  appear: object({}), disappear: object({}), pose: object({ from: pose, to: pose }),
};
const definitions: Record<string, Node> = {
  color: text(7, 7, '^#[0-9a-fA-F]{6}$'), id: text(1, 64, '^[a-z][a-z0-9_-]{0,63}$'),
  size: number(0.1, 100), seed: number(0, 4294967295, true), time: number(0, LIMITS.maxSceneMs, true),
  easing: enumeration(KIT_EASINGS), vector: array(number(-100, 100), 3, 3),
  proportions: object({ width: number(0.1, 10), height: number(0.1, 10), depth: number(0.1, 10) }),
  ...Object.fromEntries(Object.entries(objectParams).map(([name, schema]) => [`params_${name}`, schema])),
  animation: choice(...KIT_ANIMATION_TYPES.map(type => object({ type: enumeration([type]),
    startMs: time, endMs: time, easing, params: animationParams[type]! }))),
  legacy: object({ entityId: id, definitionVersion: number(1, Number.MAX_SAFE_INTEGER, true),
    motion: enumeration(['none', 'idle', 'pulse', 'reveal']), state: enumeration(['default']) }),
  keyframes: array(object({ atMs: time, position: vector(), target: vector(), fovDeg: number(20, 80) }), LIMITS.maxCameraKeyframes, 1),
};

const camera = choice(...KIT_CAMERA_MOVES.flatMap(move => {
  const base = { move: enumeration([move]), from: vector(), to: vector(), easing };
  const targets: Record<string, Node>[] = move === 'follow' ? [{ targetObjectId: id }] : [{ target: vector() }, { targetObjectId: id }];
  return targets.map(target => variants({ ...base, ...target }, { keyframes: ref('keyframes') }));
}));

/** Strict structured output contract for prompts/Codex; validateKitScene remains the semantic authority. */
export const KIT_SCENE_SCHEMA = {
  ...object({
    kind: enumeration(['kit']), kitVersion: enumeration([1]),
    palette: variants({ background: color }, { preset: enumeration(['daylight', 'dark']) }),
    sky: object({ top: color, bottom: color,
      sun: nullable(object({ position: vector(), radius: size, color })),
      clouds: array(object({ position: vector(), scale: number(0.1, 10) }), KIT_LIMITS.clouds) }),
    environment: object({ seed,
      terrain: nullable(object({ type: enumeration(['mountain', 'cliff', 'plain']), color, height: number(0, 100), size })),
      water: choice({ type: 'null' }, object({ type: enumeration(['sea']), color, level: number(-100, 100), size }),
        ...['river', 'waterfall'].map(type => object({ type: enumeration([type]), color,
          points: array(vector(), KIT_LIMITS.points, 2), width: size }))) }),
    objects: array(choice(...KIT_OBJECT_TYPES.map(type => variants({ id, type: enumeration([type]),
      params: ref(`params_${type}`), position: vector(), rotation: vector(-6.284, 6.284),
      scale: number(0.1, 10), color, animations: array(ref('animation'), KIT_LIMITS.animationsPerObject) },
    { seed, legacy: ref('legacy') }))), KIT_LIMITS.objects),
    particles: array(object({ type: enumeration(KIT_PARTICLE_TYPES), seed,
      count: number(1, KIT_LIMITS.particlesPerSystem, true), position: vector(), spread: vector(0, 100),
      color, speed: number(0, 100), size: number(0.01, 10) }), KIT_LIMITS.particles),
    labels: array(object({ objectId: id, text: text(1, 120), color }), KIT_LIMITS.labels),
    overlays: array(choice(object({ type: enumeration(['counter']), from: number(0, 9999), to: number(0, 9999),
      startMs: time, endMs: time, color }), object({ type: enumeration(['chevrons']), count: number(1, 8, true),
      direction: enumeration(['left', 'right', 'up', 'down']), color })), KIT_LIMITS.overlays),
    camera,
  }),
  description: 'Una KitScene declarativa. Sin código ni URLs. IDs únicos; referencias locales existentes; legacy coincide con la entidad registrada (tipo, params, color, seed y versión). Tiempos enteros dentro de la duración de escena; endMs > startMs. Keyframes: primero 0, tiempos estrictamente crecientes y posición distinta del objetivo. La cámara requiere exactamente un objetivo y follow requiere targetObjectId. Los vectores de eje/dirección tienen norma 1. Estas relaciones se validan al importar; JSON Schema no puede expresar todas.',
  $defs: definitions,
};
