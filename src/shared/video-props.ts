import type { CaptionStyle, Entity, Output, Project, Word } from './schema/types.ts';
import type { KitScene } from './kit/types.ts';
import { totalFrames } from './timeline.ts';
import { estimateWords } from './voice/estimate.ts';

export interface VideoSceneProps {
  sceneId: string;
  title: string;
  fromFrame: number;
  durationInFrames: number;
  text: string;
  visualIntent: string;
  visual: KitScene | null;
  words: Word[];
  audioUrl: string | null;
  gainDb: number;
}

export type VideoProps = {
  styleId: string;
  styleVersion: number;
  fps: number;
  width: number;
  height: number;
  durationInFrames: number;
  captionStyle: CaptionStyle;
  voiceMode: Output['voiceMode'];
  entities: Entity[];
  scenes: VideoSceneProps[];
};

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
    const normalize = (text: string) => text.trim().replace(/\s+/gu, ' ');
    // Derive captions without rewriting persisted alignment or media bindings.
    const matchesText = normalize(scene.words.map(word => word.text).join(' ')) === normalize(scene.text);
    const words = matchesText ? scene.words : [];
    return {
      sceneId: scene.sceneId,
      title: scene.title,
      fromFrame,
      durationInFrames: endFrame - fromFrame,
      text: scene.text,
      visualIntent: scene.visualIntent,
      visual: scene.visual,
      words: project.captionStyle.enabled && words.length === 0
        ? estimateWords(scene.text, Math.round((endFrame - fromFrame) / fps * 1000))
        : words,
      audioUrl: scene.audio ? assetUrls[scene.audio.assetId] ?? null : null,
      gainDb: scene.audio?.gainDb ?? 0,
    };
  });
  return {
    styleId: project.styleId,
    styleVersion: project.styleVersion,
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
