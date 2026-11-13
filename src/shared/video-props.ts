import type { CaptionStyle, Entity, Output, Project, Word } from './schema/types.ts';
import type { KitScene } from './kit/types.ts';
import type { VectorVisual } from './vector/types.ts';
import type { MotionVisual } from './motion/types.ts';
import { validateVectorVisual } from './vector/validate.ts';
import { validateMotionVisual } from './motion/validate.ts';
import type { ModelSnapshot } from './models/model.ts';
import { totalFrames } from './timeline.ts';
import { estimateWords } from './voice/estimate.ts';
import { verifyModelSnapshotsSync } from './models/integrity.ts';

export interface VideoSceneProps {
  sceneId: string;
  title: string;
  fromFrame: number;
  durationInFrames: number;
  text: string;
  visualIntent: string;
  visual: KitScene | VectorVisual | MotionVisual | null;
  words: Word[];
  audioUrl: string | null;
  gainDb: number;
  audioOffsetMs: number;
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
  models?: ModelSnapshot[];
  scenes: VideoSceneProps[];
};

export function projectToVideoProps(project: Project, assetUrls: Record<string, string>): VideoProps {
  const models = project.models === undefined ? undefined : verifyModelSnapshotsSync(project.models);
  if (models === null) throw new Error('La integridad de los modelos no coincide con su identificador.');
  if (project.styleVersion !== 1 || !(project.styleId === 'stylized-3d' ||
    project.schemaVersion === 3 && (project.styleId === 'vector-2d' || project.styleId === 'motion-graphics'))) {
    throw new Error(`Unsupported style: ${project.styleId} version ${project.styleVersion}`);
  }
  const fps = project.output.fps;
  const scenes = project.scenes.map(scene => {
    if (scene.visual !== null && 'inert' in scene.visual) {
      throw new Error(`Unsupported inert visual in scene ${scene.sceneId}`);
    }
    if (scene.visual !== null && project.styleId !== 'stylized-3d') {
      const valid = project.styleId === 'vector-2d' ? validateVectorVisual(scene.visual, scene.durationMs) : validateMotionVisual(scene.visual, scene.durationMs);
      if (!valid.ok) throw new Error(`Unsupported visual in scene ${scene.sceneId}`);
    }
    if (scene.visual !== null && project.styleId === 'stylized-3d' && scene.visual.kind !== 'kit') {
      throw new Error(`Unsupported visual in scene ${scene.sceneId}`);
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
      audioOffsetMs: scene.audio?.offsetMs ?? 0,
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
    ...(models === undefined ? {} : { models }),
    scenes,
  };
}
