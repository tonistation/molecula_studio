import { AbsoluteFill, Sequence } from 'remotion';
import type { VideoProps } from '../shared/video-props.ts';
import { KitScene } from './kit/KitScene.tsx';
import { resolveStyle } from './styles/registry.ts';

export const VerticalVideo = ({ scenes, styleId, styleVersion }: VideoProps) => {
  const style = resolveStyle(styleId, styleVersion);
  if (!style.ok) {
    return <AbsoluteFill style={{
      background: '#FFF0E8', color: '#772211', padding: 100,
      justifyContent: 'center', fontFamily: 'sans-serif', fontSize: 54,
    }}>{style.message}</AbsoluteFill>;
  }
  return (
    <AbsoluteFill>
      {scenes.map(scene => (
        <Sequence key={scene.sceneId} from={scene.fromFrame} durationInFrames={scene.durationInFrames}>
          {scene.visual ? <KitScene spec={scene.visual} durationInFrames={scene.durationInFrames} /> : <AbsoluteFill style={{
            backgroundColor: '#DDEEF5',
            color: '#172D45',
            justifyContent: 'center',
            alignItems: 'center',
            padding: 100,
            fontFamily: 'sans-serif',
            fontSize: 72,
            fontWeight: 800,
            textAlign: 'center',
          }}>
            {scene.title || scene.visualIntent}
          </AbsoluteFill>}
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
