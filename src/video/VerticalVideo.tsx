import { AbsoluteFill, Sequence } from 'remotion';
import type { VideoProps } from '../shared/video-props.ts';

export const VerticalVideo = ({ scenes }: VideoProps) => (
  <AbsoluteFill>
    {scenes.map(scene => (
      <Sequence key={scene.sceneId} from={scene.fromFrame} durationInFrames={scene.durationInFrames}>
        <AbsoluteFill style={{
          backgroundColor: scene.visual?.palette.background ?? '#DDEEF5',
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
        </AbsoluteFill>
      </Sequence>
    ))}
  </AbsoluteFill>
);
