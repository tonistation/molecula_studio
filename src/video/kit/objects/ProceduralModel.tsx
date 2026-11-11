import { useMemo } from 'react';
import { Color } from 'three';
import type { ModelPart, ProceduralModel as Model } from '../../../shared/models/model.ts';

function Part({ part, tint, opacity }: { part: ModelPart; tint: string; opacity: number }) {
  const color = useMemo(() => new Color(part.color).multiply(new Color(tint)), [part.color, tint]);
  return <mesh position={part.position} rotation={part.rotation} scale={part.scale} castShadow receiveShadow>
    {part.shape === 'sphere' && <sphereGeometry args={[0.5, 24, 16]} />}
    {part.shape === 'box' && <boxGeometry args={[1, 1, 1]} />}
    {part.shape === 'cylinder' && <cylinderGeometry args={[0.5, 0.5, 1, 24]} />}
    {part.shape === 'cone' && <coneGeometry args={[0.5, 1, 24]} />}
    {part.shape === 'capsule' && <capsuleGeometry args={[0.5, 1, 8, 16]} />}
    <meshStandardMaterial color={color} roughness={0.8} transparent={opacity < 1} opacity={opacity} />
    {opacity < 1 && <meshDepthMaterial attach="customDepthMaterial" alphaHash opacity={opacity} />}
  </mesh>;
}

export function ProceduralModel({ model, tint, opacity }: { model: Model; tint: string; opacity: number }) {
  return <group>{model.parts.map((part, i) => <Part key={i} part={part} tint={tint} opacity={opacity} />)}</group>;
}
