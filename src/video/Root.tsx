import { Composition } from 'remotion';
import type { CalculateMetadataFunction } from 'remotion';
import storyboard from '../../docs/plan/examples/storyboard-project.json';
import { validateProject } from '../shared/schema/index.ts';
import { projectToVideoProps } from '../shared/video-props.ts';
import type { VideoProps } from '../shared/video-props.ts';
import { VerticalVideo } from './VerticalVideo.tsx';

const parsed = validateProject(storyboard);
if (!parsed.ok || parsed.mode !== 'editable') {
  throw new Error('Invalid storyboard project');
}
const defaultProps = projectToVideoProps(parsed.project, {});

type CompositionProps = { [Key in keyof VideoProps]: VideoProps[Key] };

const calculateMetadata: CalculateMetadataFunction<CompositionProps> = ({ props }) => ({
  durationInFrames: props.durationInFrames,
  width: props.width,
  height: props.height,
  fps: props.fps,
});

export const RemotionRoot = () => (
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
);
