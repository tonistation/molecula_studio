import { AbsoluteFill, Html5Audio, Sequence, useVideoConfig } from 'remotion';
import { sceneAudioPlayback } from '../shared/voice/playback.ts';
import type { VideoProps } from '../shared/video-props.ts';
import { KitScene } from './kit/KitScene.tsx';
import { resolveStyle } from './styles/registry.ts';
import { Captions } from './captions/Captions.tsx';
import { resolveModelSnapshots } from './kit/model-snapshots.ts';
import { VectorScene } from './vector/VectorScene.tsx';
import { validateVisual } from '../shared/vector/validate.ts';

export const VerticalVideo = ({ scenes, styleId, styleVersion, captionStyle, voiceMode, models }: VideoProps) => {
  const { fps } = useVideoConfig();
  const style = resolveStyle(styleId, styleVersion);
  if (!style.ok) {
    return <AbsoluteFill style={{
      background: '#FFF0E8', color: '#772211', padding: 100,
      justifyContent: 'center', fontFamily: 'sans-serif', fontSize: 54,
    }}>{style.message}</AbsoluteFill>;
  }
  const wrongVisual = scenes.some(scene => scene.visual !== null && (style.renderer === 'kit'
    ? scene.visual.kind !== 'kit'
    : !validateVisual(scene.visual, 15000, style.renderer).ok));
  if (wrongVisual) return <AbsoluteFill style={{ background: '#FFF0E8', color: '#772211', padding: 100,
    justifyContent: 'center', fontFamily: 'sans-serif', fontSize: 54 }}>El contenido visual no corresponde al estilo.</AbsoluteFill>;
  const kitScenes = scenes.filter(scene => scene.visual === null || scene.visual.kind === 'kit') as Parameters<typeof resolveModelSnapshots>[1];
  const resolved = resolveModelSnapshots(models, style.renderer === 'kit' ? kitScenes : []);
  if (!resolved.ok) return <AbsoluteFill style={{ background: '#FFF0E8', color: '#772211', padding: 100,
    justifyContent: 'center', fontFamily: 'sans-serif', fontSize: 54 }}>El modelo 3D del proyecto falta o no es válido.</AbsoluteFill>;
  return (
    <AbsoluteFill>
      {scenes.map(scene => {
        const audio = sceneAudioPlayback(scene, voiceMode, fps);
        return (
          <Sequence key={scene.sceneId} from={scene.fromFrame} durationInFrames={scene.durationInFrames}>
            {scene.visual ? (scene.visual.kind !== 'kit' ? <VectorScene visual={scene.visual} durationInFrames={scene.durationInFrames} /> : <KitScene spec={scene.visual} durationInFrames={scene.durationInFrames} models={resolved.models} />) : <AbsoluteFill style={{
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
