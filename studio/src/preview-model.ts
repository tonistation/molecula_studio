import type { Project } from '../../src/shared/schema/types.ts';
import { projectToVideoProps } from '../../src/shared/video-props.ts';

/** Draft and saved exports share derived captions without rewriting alignment. */
export function draftVideoProps(draft: Project, assetUrls: Record<string, string>) {
  return projectToVideoProps(draft, assetUrls);
}
