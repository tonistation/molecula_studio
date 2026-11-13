type Node = Record<string, unknown>;
const object = (properties: Record<string, Node>): Node => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const number = (minimum: number, maximum: number, integer = false): Node => ({ type: integer ? 'integer' : 'number', minimum, maximum });
const choice = (...anyOf: Node[]): Node => ({ anyOf });
const literal = (value: string | number): Node => ({ type: typeof value === 'number' ? 'integer' : 'string', enum: [value] });
const array = (items: Node, minItems: number, maxItems: number): Node => ({ type: 'array', items, minItems, maxItems });
const ref = (name: string): Node => ({ $ref: `#/$defs/${name}` });

/** Closed schema for generation; cross-field timing is checked after parsing. */
export function flatOutputSchema(kind: 'vector' | 'motion', durationMs: number): Node {
  if (!Number.isSafeInteger(durationMs) || durationMs < 1 || durationMs > 15000) throw new Error('Duración de escena no válida.');
  const time = number(0, durationMs, true);
  const animation = (type: 'move' | 'fade' | 'scale') => object({ type: literal(type), startMs: time, endMs: time,
    easing: { type: 'string', enum: ['linear', 'ease-in', 'ease-out', 'ease-in-out'] },
    from: type === 'move' ? ref('point') : number(type === 'fade' ? 0 : 0.01, type === 'fade' ? 1 : 10),
    to: type === 'move' ? ref('point') : number(type === 'fade' ? 0 : 0.01, type === 'fade' ? 1 : 10) });
  const layer = (type: string, extra: Record<string, Node>) => object({ id: ref('id'), type: literal(type), position: ref('point'),
    rotation: number(-360, 360), scale: number(0.01, 10), opacity: number(0, 1), startMs: time, endMs: time,
    fill: ref('color'), animations: array(ref('animation'), 0, 8), ...extra });
  const font = { fontId: literal('builtin-sans-heavy-v1'), fontSize: number(12, 400) };
  const layers = [layer('rect', { width: number(1, 2160), height: number(1, 3840) }),
    layer('ellipse', { width: number(1, 2160), height: number(1, 3840) }),
    layer('polygon', { points: array(ref('point'), 3, 32) }),
    layer('text', { text: { type: 'string', minLength: 1, maxLength: 120 }, ...font })];
  if (kind === 'motion') layers.push(layer('counter', { from: number(-1000000, 1000000), to: number(-1000000, 1000000), ...font }));
  return { ...object({ kind: literal(kind), version: literal(1), background: ref('color'), layers: array(choice(...layers), 1, 24) }),
    $defs: { color: { type: 'string', pattern: '^#[a-fA-F0-9]{6}$' }, id: { type: 'string', pattern: '^[a-z][a-z0-9_-]{0,63}$' },
      // Structured Outputs documents homogeneous items, not per-position tuple schemas.
      // This safe subset includes the full canvas but is narrower than persisted Y coordinates.
      point: array(number(-2160, 2160), 2, 2), animation: choice(animation('move'), animation('fade'), animation('scale')) } };
}
