import type { LayerBase, VectorLayer } from '../vector/types.ts';

export type CounterLayer = LayerBase & { type: 'counter'; from: number; to: number; fontId: 'builtin-sans-heavy-v1'; fontSize: number };
export type MotionLayer = VectorLayer | CounterLayer;
export type MotionVisual = { kind: 'motion'; version: 1; background: string; layers: MotionLayer[] };
