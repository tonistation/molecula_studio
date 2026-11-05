import type { Project } from '../../src/shared/schema/types.ts';
import { projectToVideoProps } from '../../src/shared/video-props.ts';
import { estimateWords } from '../../src/shared/voice/estimate.ts';

/** Preview-only estimates never replace saved alignment or media bindings. */
export function draftVideoProps(draft: Project, assetUrls: Record<string, string>) {
  const props = projectToVideoProps(draft, assetUrls);
  const normalize = (text: string) => text.trim().replace(/\s+/gu, ' ');
  for (const scene of props.scenes) {
    if (normalize(scene.words.map(word => word.text).join(' ')) !== normalize(scene.text)) {
      scene.words = [];
    }
    // Validate before mounting the Player so invalid intermediate text is recoverable.
    if (props.captionStyle.enabled && scene.words.length === 0) {
      scene.words = estimateWords(scene.text, Math.round(scene.durationInFrames / props.fps * 1000));
    }
  }
  return props;
}
