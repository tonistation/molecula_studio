import { AbsoluteFill, Html5Audio, Sequence, useVideoConfig } from 'remotion';
import { sceneAudioPlayback } from '../shared/voice/playback.ts';
import type { VideoProps } from '../shared/video-props.ts';
import { KitScene } from './kit/KitScene.tsx';
import { resolveStyle } from './styles/registry.ts';
import { Captions } from './captions/Captions.tsx';

export const VerticalVideo = ({ scenes, styleId, styleVersion, captionStyle, voiceMode }: VideoProps) => {
  const { fps } = useVideoConfig();
  const style = resolveStyle(styleId, styleVersion);
  if (!style.ok) {
    return <AbsoluteFill style={{
      background: '#FFF0E8', color: '#772211', padding: 100,
      justifyContent: 'center', fontFamily: 'sans-serif', fontSize: 54,
    }}>{style.message}</AbsoluteFill>;
  }
  return (
    <AbsoluteFill>
      {scenes.map(scene => {
        const audio = sceneAudioPlayback(scene, voiceMode, fps);
        return (
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
            {captionStyle.enabled && <Captions text={scene.text} words={scene.words}
              durationInFrames={scene.durationInFrames} style={captionStyle} />}
            {audio && <Html5Audio {...audio} useWebAudioApi crossOrigin="anonymous" pauseWhenBuffering
              acceptableTimeShiftInSeconds={0.1} />}
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
