import { Vector2 } from 'three';
import type { ReactNode } from 'react';
import type { KitObject as ObjectSpec } from '../../../shared/kit/types.ts';
import type { Vec3 } from '../../../shared/schema/types.ts';
import { animateObject, identitySeed, seeded } from '../animate.ts';
import { arrowShape } from './arrow-shape.ts';

function Solid({ children, color, opacity }: { children: ReactNode; color: string; opacity: number }) {
  return <mesh castShadow receiveShadow>{children}<meshStandardMaterial color={color} flatShading roughness={0.9} transparent={opacity < 1} opacity={opacity} /></mesh>;
}

export function KitObject({ spec, ms }: { spec: ObjectSpec; ms: number }) {
  const state = animateObject(spec, ms);
  const solid = (geometry: ReactNode, color = spec.color) => <Solid color={color} opacity={state.opacity}>{geometry}</Solid>;
  const block = (size: Vec3, position: Vec3, color = spec.color) => <group position={position}>{solid(<boxGeometry args={size} />, color)}</group>;
  const ball = (radius: number, position: Vec3, color = spec.color) => <group position={position}>{solid(<icosahedronGeometry args={[radius, 0]} />, color)}</group>;
  let content: ReactNode;
  switch (spec.type) {
    case 'box': content = solid(<boxGeometry args={[spec.params.width, spec.params.height, spec.params.depth]} />); break;
    case 'sphere': content = solid(<sphereGeometry args={[spec.params.radius, 12, 8]} />); break;
    case 'cylinder': content = solid(<cylinderGeometry args={[spec.params.radius, spec.params.radius, spec.params.height, 10]} />); break;
    case 'cone': content = solid(<coneGeometry args={[spec.params.radius, spec.params.height, 8]} />); break;
    case 'lathe': content = solid(<latheGeometry args={[spec.params.profile.map(p => new Vector2(...p)), 12]} />); break;
    case 'rock': {
      const seed = identitySeed(spec);
      content = <group rotation={[seeded(seed, 0), seeded(seed, 1), seeded(seed, 2)]} scale={[0.85 + seeded(seed, 3) * 0.3, 0.7 + seeded(seed, 4) * 0.35, 0.9 + seeded(seed, 5) * 0.3]}>{solid(<dodecahedronGeometry args={[spec.params.radius, 0]} />)}</group>;
      break;
    }
    case 'drop': content = <group scale={[1, 1.5, 1]}>{ball(spec.params.radius, [0, 0, 0])}<group position={[0, spec.params.radius * 0.7, 0]}>{solid(<coneGeometry args={[spec.params.radius * 0.75, spec.params.radius * 1.6, 8]} />)}</group></group>; break;
    case 'character': {
      const { width: w, height: h, depth: d } = spec.params.proportions;
      const { bodyColor, accentColor } = spec.params;
      const hip = h * (0.48 - state.pose.crouch * 0.5);
      content = <group>
        {block([w * 0.64, h * 0.3, d], [0, hip + h * 0.15, 0], bodyColor)}
        {ball(w * 0.34, [0, hip + h * 0.43, 0], accentColor)}
        {[-1, 1].map(side => <group key={side} position={[side * w * 0.43, hip + h * 0.28, 0]} rotation={[0, 0, side === -1 ? state.pose.leftArm : state.pose.rightArm]}>
          {block([w * 0.2, h * 0.3, d * 0.7], [0, -h * 0.15, 0], bodyColor)}
          {ball(w * 0.12, [0, -h * 0.32, 0], accentColor)}
        </group>)}
        {[-1, 1].map(side => <group key={side} position={[side * w * 0.22, hip, 0]} rotation={[state.pose.crouch, 0, side * state.pose.crouch]}>
          {block([w * 0.25, hip, d * 0.8], [0, -hip / 2, 0], bodyColor)}
        </group>)}
        {[-1, 1].map(side => <group key={side}>
          {ball(w * 0.045, [side * w * 0.12, hip + h * 0.46, w * 0.29], '#172D45')}
        </group>)}
      </group>;
      break;
    }
    case 'arrow': {
      const s = arrowShape(spec.params.proportions, spec.params.direction);
      content = <group quaternion={s.quaternion}>
        <group position={[0, s.shaftCenter, 0]} scale={[s.shaftWidth, s.shaftLength, s.shaftDepth]}>{solid(<cylinderGeometry args={[0.5, 0.5, 1, 8, 1, false]} />, spec.params.color)}</group>
        <group position={[0, s.headCenter, 0]} scale={[s.headWidth, s.headLength, s.headDepth]}>{solid(<coneGeometry args={[0.5, 1, 8, 1, false]} />, spec.params.color)}</group>
      </group>;
      break;
    }
    case 'car': {
      const { width: w, height: h, depth: d } = spec.params.proportions;
      content = <group>
        {block([w, h * 0.4, d], [0, h * 0.35, 0], spec.params.bodyColor)}
        {block([w * 0.82, h * 0.4, d * 0.48], [0, h * 0.72, -d * 0.08], spec.params.bodyColor)}
        {block([w * 0.84, h * 0.23, d * 0.3], [0, h * 0.77, d * 0.17], '#BCEAF3')}
        {[-1, 1].flatMap(x => [-1, 1].map(z => <group key={`${x}:${z}`} position={[x * w * 0.5, h * 0.22, z * d * 0.3]} rotation={[0, 0, Math.PI / 2]}>{solid(<cylinderGeometry args={[h * 0.22, h * 0.22, w * 0.18, 10]} />, spec.params.wheelColor)}</group>))}
      </group>;
      break;
    }
    case 'rockLayers': {
      const { width: w, height: h, depth: d } = spec.params.proportions;
      const colors = spec.params.colors;
      content = <group>{colors.map((color, i) => <group key={i} rotation={[0, (seeded(identitySeed(spec), i) - 0.5) * 0.08, 0]}>{block([w, h / colors.length, d], [0, h * (i + 0.5) / colors.length, 0], color)}</group>)}</group>;
      break;
    }
    case 'label': content = null; break; // Rendered as projected DOM, never a texture or HTML in WebGL.
    default: { const unreachable: never = spec; throw new Error(`Unsupported object: ${String(unreachable)}`); }
  }
  return <group position={state.position} rotation={state.rotation} scale={state.scale} visible={state.opacity > 0}>{content}</group>;
}
