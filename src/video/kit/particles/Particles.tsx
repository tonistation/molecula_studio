import type { KitScene } from '../../../shared/kit/types.ts';
import { particleAt } from './state.ts';

export function Particles({ spec, ms }: { spec: KitScene['particles'][number]; ms: number }) {
  return <group>{Array.from({ length: spec.count }, (_, i) => {
    const state = particleAt(spec, i, ms);
    return <mesh key={i} position={state.position} scale={spec.type === 'rain' ? [state.scale * 0.3, state.scale * 4, state.scale * 0.3] : state.scale}>
      {spec.type === 'bubbles' ? <sphereGeometry args={[1, 6, 4]} /> : <octahedronGeometry args={[1, 0]} />}
      <meshBasicMaterial color={spec.color} transparent opacity={state.opacity * 0.85} wireframe={spec.type === 'bubbles'} />
    </mesh>;
  })}</group>;
}
