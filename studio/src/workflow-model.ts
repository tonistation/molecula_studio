import type { Project } from '../../src/shared/schema/types.ts';
import { projectToVideoProps } from '../../src/shared/video-props.ts';
import { voiceStatuses } from './voice-model.ts';

export type WorkflowState = 'pending' | 'ready' | 'outdated';
export type WorkflowStates = readonly [WorkflowState, WorkflowState, WorkflowState, WorkflowState];

/** Readiness describes the current content, not approval or a completed render. */
export async function workflowStates(project: Project, missingAssets: string[]): Promise<WorkflowStates> {
  const supported = project.styleId === 'stylized-3d' && project.styleVersion === 1;
  const idea: WorkflowState = supported && project.idea.trim() ? 'ready' : 'pending';
  const script: WorkflowState = project.scenes.length > 0
    && project.scenes.every(scene => scene.text.trim() && scene.visualIntent.trim()) ? 'ready' : 'pending';
  let voice: WorkflowState = 'ready';
  if (project.output.voiceMode === 'withVoice') {
    const statuses = Object.values(await voiceStatuses(project, missingAssets));
    voice = statuses.includes('desactualizada') ? 'outdated'
      : !statuses.length || statuses.includes('sin voz') ? 'pending' : 'ready';
  }
  let preview: WorkflowState = 'pending';
  if (supported && project.scenes.length > 0 && project.scenes.every(scene => scene.visual !== null)) {
    try {
      // Use the same conversion as the live preview, including recoverable caption errors.
      projectToVideoProps(project, {});
      preview = voice;
    } catch { /* Invalid intermediate edits remain pending, never falsely ready. */ }
  }
  return [idea, script, voice, preview];
}
