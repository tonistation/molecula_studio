import { useEffect, useMemo } from 'react';
import { DoubleSide, Vector3 } from 'three';
import type { KitScene } from '../../../shared/kit/types.ts';
import type { Vec3 } from '../../../shared/schema/types.ts';
import { seeded } from '../animate.ts';
import { waterGeometry } from './water.ts';

function WaterCourse({ points, width, color }: { points: Vec3[]; width: number; color: string }) {
  const geometry = useMemo(() => waterGeometry(points, width), [points, width]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <mesh geometry={geometry}><meshStandardMaterial color={color} side={DoubleSide} flatShading roughness={0.85} /></mesh>;
}

export function Environment({ spec, ms }: { spec: KitScene; ms: number }) {
  const { terrain, water, seed } = spec.environment;
  return <>
    {spec.sky.sun && <mesh position={spec.sky.sun.position}><icosahedronGeometry args={[spec.sky.sun.radius, 2]} /><meshBasicMaterial color={spec.sky.sun.color} /></mesh>}
    {spec.sky.clouds.map((cloud, i) => <group key={i} position={cloud.position} scale={cloud.scale}>
      {[-1, 0, 1].map(n => <mesh key={n} position={[n * 0.65, n === 0 ? 0.2 : 0, 0]} scale={[1, 0.6, 0.65]}><icosahedronGeometry args={[0.8, 1]} /><meshStandardMaterial color="#FFFFFF" flatShading /></mesh>)}
    </group>)}
    {terrain && <group>
      <mesh position={[0, -0.35, 0]}><cylinderGeometry args={[terrain.size / 2, terrain.size * 0.43, 0.7, 12]} /><meshStandardMaterial color={terrain.color} flatShading /></mesh>
      {terrain.type === 'mountain' && [-1, 0, 1].map((n, i) => {
        const h = terrain.height * (0.7 + seeded(seed, i) * 0.3);
        return <group key={i} position={[n * terrain.size * 0.22, 0, -terrain.size * 0.17 - Math.abs(n) * 0.3]}>
          <mesh position={[0, h / 2, 0]} rotation={[0, seeded(seed, i + 4) * 2, 0]}><coneGeometry args={[terrain.size * 0.3, h, 5]} /><meshStandardMaterial color={terrain.color} flatShading /></mesh>
          <mesh position={[0, h * 0.89, 0]} rotation={[0, seeded(seed, i + 4) * 2, 0]}><coneGeometry args={[terrain.size * 0.078, h * 0.24, 5]} /><meshStandardMaterial color="#E8F2DF" flatShading /></mesh>
        </group>;
      })}
      {terrain.type === 'cliff' && <mesh position={[0, terrain.height / 2, -terrain.size / 4]}><boxGeometry args={[terrain.size, terrain.height, terrain.size / 2]} /><meshStandardMaterial color={terrain.color} flatShading /></mesh>}
    </group>}
    {water?.type === 'sea' && <mesh position={[0, water.level, 0]} rotation={[-Math.PI / 2, 0, 0]}><circleGeometry args={[water.size / 2, 48]} /><meshStandardMaterial color={water.color} flatShading roughness={0.3} /></mesh>}
    {water && water.type !== 'sea' && <>
      <WaterCourse points={water.points} width={water.width} color={water.color} />
      {Array.from({ length: 18 }, (_, i) => {
        const phase = ((ms / 1700 + seeded(seed, i + 30)) % 1 + 1) % 1;
        const distance = phase * (water.points.length - 1);
        const index = Math.min(Math.floor(distance), water.points.length - 2);
        const a = new Vector3(...water.points[index]!);
        const b = new Vector3(...water.points[index + 1]!);
        const position = a.lerp(b, distance - index);
        position.y += water.width * 0.1;
        return <mesh key={i} position={position} scale={[water.width * 0.08, water.width * 0.035, water.width * 0.18]}><icosahedronGeometry args={[1, 0]} /><meshBasicMaterial color="#C9FBFF" /></mesh>;
      })}
    </>}
  </>;
}
