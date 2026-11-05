import { useMemo } from 'react';
import { ThreeCanvas } from '@remotion/three';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import type { KitScene as SceneSpec } from '../../shared/kit/types.ts';
import { cameraAt, makeCamera } from './camera.ts';
import { Environment } from './environment/Environment.tsx';
import { KitObject } from './objects/KitObject.tsx';
import { Particles } from './particles/Particles.tsx';
import { Overlays } from './overlays/Overlays.tsx';

export function KitScene({ spec, durationInFrames }: { spec: SceneSpec; durationInFrames: number }) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const ms = frame * 1000 / fps;
  const state = cameraAt(spec.camera, ms, durationInFrames * 1000 / fps, spec.objects);
  const camera = useMemo(() => makeCamera(state, width, height), [state.position.join(','), state.target.join(','), state.fov, width, height]);
  const dark = spec.palette.preset === 'dark';
  return <AbsoluteFill style={{ background: `linear-gradient(${spec.sky.top}, ${spec.sky.bottom})` }}>
    <ThreeCanvas
      width={width} height={height} camera={camera} dpr={1} flat
      gl={{ alpha: true, antialias: true }}
      fallback={<AbsoluteFill style={{ background: '#FFF0E8', color: '#772211', padding: 100, fontSize: 48 }}>
        No se pudo iniciar WebGL. Revisa el navegador y la configuración gráfica.
      </AbsoluteFill>}
    >
      <fog attach="fog" args={[spec.palette.background, dark ? 18 : 28, dark ? 65 : 100]} />
      <ambientLight intensity={dark ? 0.45 : 0.8} />
      <hemisphereLight args={[dark ? '#819BCC' : '#DAF4FF', '#678655', dark ? 0.5 : 1.2]} />
      <directionalLight position={[-5, 10, 7]} intensity={dark ? 1 : 2.2} color={dark ? '#AFC8FF' : '#FFF2CB'} />
      <Environment spec={spec} ms={ms} />
      {spec.objects.map(object => <KitObject key={object.id} spec={object} ms={ms} />)}
      {spec.particles.map((system, i) => <Particles key={i} spec={system} ms={ms} />)}
    </ThreeCanvas>
    <Overlays spec={spec} ms={ms} camera={state} width={width} height={height} />
  </AbsoluteFill>;
}
