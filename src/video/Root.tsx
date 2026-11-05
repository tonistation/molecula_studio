import { Composition } from 'remotion';
import type { CalculateMetadataFunction } from 'remotion';
import storyboard from '../../docs/plan/examples/storyboard-project.json';
import saltScene from '../../docs/plan/examples/kit/sal-del-mar.json';
import { validateKitScene } from '../shared/kit/validate.ts';
import { validateProject } from '../shared/schema/index.ts';
import { projectToVideoProps } from '../shared/video-props.ts';
import type { VideoProps } from '../shared/video-props.ts';
import { VerticalVideo } from './VerticalVideo.tsx';

const parsed = validateProject(storyboard);
if (!parsed.ok || parsed.mode !== 'editable') {
  throw new Error('Invalid storyboard project');
}
const defaultProps = projectToVideoProps(parsed.project, {});
const saltResult = validateKitScene(saltScene, { durationMs: 5000 });
if (!saltResult.ok) throw new Error(`Invalid salt scene: ${JSON.stringify(saltResult.issues)}`);
const saltKit = saltResult.scene;
const saltProps: VideoProps = {
  ...defaultProps,
  durationInFrames: 300,
  scenes: [0, 1].map(i => ({
    sceneId: `salt-${i}`, title: 'El río transporta minerales', fromFrame: i * 150, durationInFrames: 150,
    text: '', visualIntent: 'Un río baja la montaña y arrastra una roca.', words: [], audioUrl: null, gainDb: 0,
    visual: i === 0 ? saltKit : { ...saltKit, camera: { ...saltKit.camera, from: [7, 6, 13], to: [6, 5.5, 12] } },
  })),
};

type CompositionProps = { [Key in keyof VideoProps]: VideoProps[Key] };

const calculateMetadata: CalculateMetadataFunction<CompositionProps> = ({ props }) => ({
  durationInFrames: props.durationInFrames,
  width: props.width,
  height: props.height,
  fps: props.fps,
});

export const RemotionRoot = () => (
  <>
    <Composition
      id="Vertical"
      component={VerticalVideo}
      width={1080}
      height={1920}
      fps={30}
      durationInFrames={360}
      defaultProps={defaultProps}
      calculateMetadata={calculateMetadata}
    />
    <Composition
      id="SalDelMar"
      component={VerticalVideo}
      width={1080}
      height={1920}
      fps={30}
      durationInFrames={300}
      defaultProps={saltProps}
      calculateMetadata={calculateMetadata}
    />
  </>
);
