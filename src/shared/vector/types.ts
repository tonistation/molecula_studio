import type { Easing } from '../kit/types.ts';

export type Point2 = [number, number];
export type LayerAnimation = {
  startMs: number; endMs: number; easing: Easing;
} & ({ type: 'move'; from: Point2; to: Point2 } | { type: 'fade' | 'scale'; from: number; to: number });
export type LayerBase = {
  id: string; position: Point2; rotation: number; scale: number; opacity: number;
  startMs: number; endMs: number; fill: string; animations: LayerAnimation[];
};
export type VectorLayer = LayerBase & (
  | { type: 'rect' | 'ellipse'; width: number; height: number }
  | { type: 'polygon'; points: Point2[] }
  | { type: 'text'; text: string; fontId: 'builtin-sans-heavy-v1'; fontSize: number }
);
export type VectorVisual = { kind: 'vector'; version: 1; background: string; layers: VectorLayer[] };
