import type { Project } from '../schema/types.ts';
import { applyFlatVisual } from '../flat/apply.ts';
export const applyMotionVisual = (project: Project, sceneId: string, visual: unknown): Project => applyFlatVisual(project, sceneId, visual, 'motion');
