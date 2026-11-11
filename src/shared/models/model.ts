import type { Vec3 } from '../schema/types.ts';

/** Portable, bounded data only. Coordinates describe a model in local space. */
export interface ProceduralModel {
  version: 1;
  name: string;
  semanticId: string;
  parts: ModelPart[];
}

/** The ID is opaque in shared code; the library verifies its content address. */
export interface ModelSnapshot {
  id: string;
  model: ProceduralModel;
}

export const MODEL_ID_PATTERN = /^[0-9a-f]{64}$/;
export const MAX_PROJECT_MODELS = 64;

export interface ModelPart {
  shape: 'sphere' | 'box' | 'cylinder' | 'capsule' | 'cone';
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
  color: string;
}

const keys = (value: unknown, expected: string[]): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Object.getOwnPropertySymbols(value).length) return false;
  const names = Object.getOwnPropertyNames(value);
  return names.length === expected.length && names.every(name => expected.includes(name)
    && Object.getOwnPropertyDescriptor(value, name)?.enumerable
    && 'value' in Object.getOwnPropertyDescriptor(value, name)!);
};

const plainArray = (value: unknown, min: number, max: number): value is unknown[] => {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
    || value.length < min || value.length > max || Object.getOwnPropertySymbols(value).length) return false;
  const names = Object.getOwnPropertyNames(value);
  return names.length === value.length + 1 && names.every(name => {
    if (name === 'length') return true;
    if (!/^(0|[1-9][0-9]*)$/.test(name) || Number(name) >= value.length) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    return !!descriptor?.enumerable && 'value' in descriptor;
  });
};
const vector = (value: unknown, min: number, max: number): value is Vec3 =>
  plainArray(value, 3, 3) && value.every(n => typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max);

export function validateProceduralModel(value: unknown): { ok: true; model: ProceduralModel } | { ok: false } {
  if (!keys(value, ['version', 'name', 'semanticId', 'parts']) || value.version !== 1
    || typeof value.name !== 'string' || Array.from(value.name).length < 1 || Array.from(value.name).length > 80
    || !/^[\p{L}\p{N}][\p{L}\p{N} ,.'-]*$/u.test(value.name)
    || typeof value.semanticId !== 'string' || !/^[a-z][a-z0-9-]{0,47}$/.test(value.semanticId)
    || !plainArray(value.parts, 1, 24)) return { ok: false };
  for (const part of value.parts) {
    if (!keys(part, ['shape', 'position', 'rotation', 'scale', 'color'])
      || !['sphere', 'box', 'cylinder', 'capsule', 'cone'].includes(part.shape as string)
      || !vector(part.position, -4, 4) || !vector(part.rotation, -6.284, 6.284)
      || !vector(part.scale, 0.01, 4) || typeof part.color !== 'string'
      || !/^#[0-9a-fA-F]{6}$/.test(part.color)) return { ok: false };
  }
  return { ok: true, model: value as unknown as ProceduralModel };
}
