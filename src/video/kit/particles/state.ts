import type { KitScene } from '../../../shared/kit/types.ts';
import type { Vec3 } from '../../../shared/schema/types.ts';
import { seeded } from '../animate.ts';

export function particleAt(spec: KitScene['particles'][number], index: number, ms: number) {
  const noise = (channel: number) => seeded(spec.seed, index * 7 + channel);
  const phase = ((noise(0) + ms / 1000 * spec.speed * 0.15) % 1 + 1) % 1;
  const position: Vec3 = [spec.position[0] + (noise(1) - 0.5) * spec.spread[0], spec.position[1] + (noise(2) - 0.5) * spec.spread[1], spec.position[2] + (noise(3) - 0.5) * spec.spread[2]];
  if (spec.type !== 'sparkle') position[1] = spec.position[1] + (spec.type === 'rain' ? 0.5 - phase : phase - 0.5) * spec.spread[1];
  return { position, scale: spec.size * (spec.type === 'sparkle' ? 0.25 + Math.sin(phase * Math.PI) * 0.75 : 1), opacity: Math.sin(phase * Math.PI) };
}
