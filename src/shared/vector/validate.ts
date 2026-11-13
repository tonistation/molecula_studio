import type { Issue } from '../schema/types.ts';
import type { VectorVisual } from './types.ts';
import type { MotionVisual } from '../motion/types.ts';
import { hasForbiddenControl } from '../schema/text.ts';
import { inspectStructure } from '../schema/validate.ts';

export const MAX_LAYERS = 24;
export const MAX_LAYER_ANIMATIONS = 8;
const FORBIDDEN_TEXT = /<\/?[a-z][a-z0-9:-]*(?=[\s/>]|$)|\b(?:https?|ftp|file)\s*:\s*\/\/|\b(?:javascript|vbscript|data)\s*:|\bwww\./i;
type Outcome<T> = { ok: true; visual: T } | { ok: false; issues: Issue[] };

/** Validates the closed, declarative visual. Coordinates use the 1080×1920 canvas. */
export function validateVectorVisual(value: unknown, durationMs: number): Outcome<VectorVisual> {
  return validateVisual(value, durationMs, 'vector') as Outcome<VectorVisual>;
}
export function validateVisual(value: unknown, durationMs: number, kind: 'vector' | 'motion'): Outcome<VectorVisual | MotionVisual> {
  const structural = inspectStructure(value);
  if (structural.length) return { ok: false, issues: structural };
  if (!Number.isSafeInteger(durationMs) || durationMs < 1 || durationMs > 15000) return { ok: false, issues: [{ path: '$', code: 'range', message: 'invalid scene duration' }] };
  const issues: Issue[] = [];
  const fail = (path: string, message: string) => issues.push({ path, code: 'type', message });
  const object = (v: unknown, path: string, keys: string[]): Record<string, unknown> => {
    if (!v || typeof v !== 'object' || Array.isArray(v) || ![Object.prototype, null].includes(Object.getPrototypeOf(v))) {
      fail(path, 'must be a plain object'); return {};
    }
    const o = v as Record<string, unknown>;
    for (const key of Object.keys(o)) if (!keys.includes(key)) fail(`${path}.${key}`, 'unknown key');
    for (const key of keys) if (!Object.hasOwn(o, key)) fail(`${path}.${key}`, 'missing key');
    return o;
  };
  const num = (v: unknown, path: string, min: number, max: number, integer = false) => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max || (integer && !Number.isSafeInteger(v))) fail(path, `must be ${min}–${max}${integer ? ' integer' : ''}`);
  };
  const point = (v: unknown, path: string) => {
    if (!Array.isArray(v) || v.length !== 2) { fail(path, 'must contain two coordinates'); return; }
    num(v[0], `${path}[0]`, -2160, 2160); num(v[1], `${path}[1]`, -3840, 3840);
  };
  const color = (v: unknown, path: string) => { if (typeof v !== 'string' || !/^#[a-f0-9]{6}$/i.test(v)) fail(path, 'must be #RRGGBB'); };
  const interval = (o: Record<string, unknown>, path: string) => {
    num(o.startMs, `${path}.startMs`, 0, durationMs, true); num(o.endMs, `${path}.endMs`, 0, durationMs, true);
    if (typeof o.startMs === 'number' && typeof o.endMs === 'number' && o.startMs >= o.endMs) fail(path, 'endMs must be after startMs');
  };
  const root = object(value, '$', ['kind', 'version', 'background', 'layers']);
  if (root.kind !== kind) fail('$.kind', `must be ${kind}`);
  if (root.version !== 1) fail('$.version', 'must be 1');
  color(root.background, '$.background');
  if (!Array.isArray(root.layers) || root.layers.length > MAX_LAYERS) fail('$.layers', `must be an array of at most ${MAX_LAYERS}`);
  const ids = new Set<string>();
  for (const [i, item] of (Array.isArray(root.layers) ? root.layers.slice(0, MAX_LAYERS) : []).entries()) {
    const p = `$.layers[${i}]`;
    const t = item && typeof item === 'object' ? (item as Record<string, unknown>).type : undefined;
    const extra = t === 'rect' || t === 'ellipse' ? ['width', 'height'] : t === 'polygon' ? ['points'] : t === 'text' ? ['text', 'fontId', 'fontSize'] : t === 'counter' && kind === 'motion' ? ['from', 'to', 'fontId', 'fontSize'] : [];
    if (!extra.length) fail(`${p}.type`, 'unsupported layer type');
    const o = object(item, p, ['id', 'type', 'position', 'rotation', 'scale', 'opacity', 'startMs', 'endMs', 'fill', 'animations', ...extra]);
    if (typeof o.id !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/.test(o.id) || ids.has(o.id)) fail(`${p}.id`, 'must be a unique identifier');
    if (typeof o.id === 'string') ids.add(o.id);
    point(o.position, `${p}.position`); num(o.rotation, `${p}.rotation`, -360, 360); num(o.scale, `${p}.scale`, 0.01, 10); num(o.opacity, `${p}.opacity`, 0, 1); color(o.fill, `${p}.fill`); interval(o, p);
    // Layers are active on [startMs, endMs); at least one local 30fps frame must sample that interval.
    if (Number.isSafeInteger(o.startMs) && Number.isSafeInteger(o.endMs)
      && (o.startMs as number) >= 0 && (o.endMs as number) <= durationMs
      && Math.ceil((o.startMs as number) * 30 / 1000) * 1000 >= (o.endMs as number) * 30) {
      fail(p, 'layer interval must contain a 30fps frame');
    }
    if (t === 'rect' || t === 'ellipse') { num(o.width, `${p}.width`, 1, 2160); num(o.height, `${p}.height`, 1, 3840); }
    if (t === 'polygon') {
      if (!Array.isArray(o.points) || o.points.length < 3 || o.points.length > 32) fail(`${p}.points`, 'must contain 3–32 points');
      else o.points.forEach((v, j) => point(v, `${p}.points[${j}]`));
    }
    if (t === 'text' || t === 'counter') {
      if (o.fontId !== 'builtin-sans-heavy-v1') fail(`${p}.fontId`, 'unsupported font');
      num(o.fontSize, `${p}.fontSize`, 12, 400);
      if (t === 'text' && (typeof o.text !== 'string' || [...o.text].length < 1 || [...o.text].length > 120 || hasForbiddenControl(o.text) || FORBIDDEN_TEXT.test(o.text))) fail(`${p}.text`, 'must be 1–120 characters without markup or URLs');
      if (t === 'counter') { num(o.from, `${p}.from`, -1000000, 1000000); num(o.to, `${p}.to`, -1000000, 1000000); }
    }
    if (!Array.isArray(o.animations) || o.animations.length > MAX_LAYER_ANIMATIONS) fail(`${p}.animations`, 'must be an array of at most 8');
    for (const [j, animation] of (Array.isArray(o.animations) ? o.animations.slice(0, MAX_LAYER_ANIMATIONS) : []).entries()) {
      const ap = `${p}.animations[${j}]`; const a = object(animation, ap, ['type', 'startMs', 'endMs', 'easing', 'from', 'to']);
      interval(a, ap);
      if (typeof a.startMs === 'number' && typeof o.startMs === 'number' && a.startMs < o.startMs || typeof a.endMs === 'number' && typeof o.endMs === 'number' && a.endMs > o.endMs) fail(ap, 'animation must fit layer timing');
      if (!['linear', 'ease-in', 'ease-out', 'ease-in-out'].includes(a.easing as string)) fail(`${ap}.easing`, 'unsupported easing');
      if (a.type === 'move') { point(a.from, `${ap}.from`); point(a.to, `${ap}.to`); }
      else if (a.type === 'fade' || a.type === 'scale') { const max = a.type === 'fade' ? 1 : 10; const min = a.type === 'fade' ? 0 : 0.01; num(a.from, `${ap}.from`, min, max); num(a.to, `${ap}.to`, min, max); }
      else fail(`${ap}.type`, 'unsupported animation');
    }
  }
  return issues.length ? { ok: false, issues } : { ok: true, visual: structuredClone(value) as VectorVisual | MotionVisual };
}
