import type { CaptionStyle, Entity, Output, Project, StylizedVisual, Word } from './schema/types.ts';
import { totalFrames } from './timeline.ts';

export interface VideoSceneProps {
  sceneId: string;
  fromFrame: number;
  durationInFrames: number;
  text: string;
  visualIntent: string;
  visual: StylizedVisual | null;
  words: Word[];
  audioUrl: string | null;
  gainDb: number;
}

export interface VideoProps {
  fps: number;
  width: number;
  height: number;
  durationInFrames: number;
  captionStyle: CaptionStyle;
  voiceMode: Output['voiceMode'];
  entities: Entity[];
  scenes: VideoSceneProps[];
}

export function projectToVideoProps(project: Project, assetUrls: Record<string, string>): VideoProps {
  if (project.styleId !== 'stylized-3d' || project.styleVersion !== 1) {
    throw new Error(`Unsupported style: ${project.styleId} version ${project.styleVersion}`);
  }
  const fps = project.output.fps;
  const scenes = project.scenes.map(scene => {
    if (scene.visual !== null && 'inert' in scene.visual) {
      throw new Error(`Unsupported inert visual in scene ${scene.sceneId}`);
    }
    const fromFrame = totalFrames(scene.startMs, fps);
    const endFrame = totalFrames(scene.startMs + scene.durationMs, fps);
    return {
      sceneId: scene.sceneId,
      fromFrame,
      durationInFrames: endFrame - fromFrame,
      text: scene.text,
      visualIntent: scene.visualIntent,
      visual: scene.visual,
      words: scene.words,
      audioUrl: scene.audio ? assetUrls[scene.audio.assetId] ?? null : null,
      gainDb: scene.audio?.gainDb ?? 0,
    };
  });
  return {
    fps,
    width: project.output.width,
    height: project.output.height,
    durationInFrames: totalFrames(project.output.durationMs, fps),
    captionStyle: project.captionStyle,
    voiceMode: project.output.voiceMode,
    entities: project.entities,
    scenes,
  };
}
