import type { CounterLayer, MotionLayer } from '../../shared/motion/types.ts';
import { ease, mix, progress } from '../kit/animate.ts';

/** Determine the decimal precision implied by the shortest numeric representation. */
function decimalPlaces(value: number): number {
  const [mantissa, exponent = '0'] = String(value).toLowerCase().split('e');
  return Math.max(0, (mantissa!.split('.')[1]?.length ?? 0) - Number(exponent));
}

/** The counter spans the actual sampled frames, including the last visible frame. */
export function counterTextAtFrame(layer: CounterLayer, frame: number, fps: number, durationInFrames = Infinity): string {
  const first = Math.ceil(layer.startMs * fps / 1000);
  const last = Math.min(Math.ceil(layer.endMs * fps / 1000) - 1, durationInFrames - 1);
  const t = first >= last ? 1 : Math.max(0, Math.min(1, (frame - first) / (last - first)));
  if (t === 0) return String(layer.from);
  if (t === 1) return String(layer.to);
  const places = Math.max(decimalPlaces(layer.from), decimalPlaces(layer.to));
  const value = mix(layer.from, layer.to, t);
  if (places > 6) return String(Number(value.toPrecision(6)));
  const formatted = value.toFixed(places);
  return Number(formatted) === 0 ? (0).toFixed(places) : formatted;
}

/** Evaluate from scene-relative milliseconds; later active array entries win per property. */
export function layerAt(layer: MotionLayer, ms: number) {
  let position: [number, number] = [...layer.position];
  let scale = layer.scale;
  let opacity = layer.opacity;
  for (const animation of layer.animations) {
    if (ms < animation.startMs) continue;
    const t = ease(progress(ms, animation.startMs, animation.endMs), animation.easing);
    if (animation.type === 'move') position = [mix(animation.from[0], animation.to[0], t), mix(animation.from[1], animation.to[1], t)];
    else if (animation.type === 'fade') opacity = mix(animation.from, animation.to, t);
    else scale = mix(animation.from, animation.to, t);
  }
  return { visible: ms >= layer.startMs && ms < layer.endMs, position, scale, opacity };
}
