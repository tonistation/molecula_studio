import { LIMITS } from '../schema/limits.ts';
import type { Project, Scene } from '../schema/types.ts';
import { validateProject } from '../schema/validate.ts';
import { parseScriptResponse } from './parse.ts';
import type { ScriptProposal } from './schema.ts';

/** Pure draft operation: callers allocate fresh IDs; saving owns project revisions/timestamps. */
export function applyScriptProposal(project: Project, proposal: ScriptProposal, sceneIds: readonly string[]): Project {
  const input = validateProject(project);
  if (!input.ok || input.mode !== 'editable') throw new Error('El proyecto no es válido o es de solo lectura.');
  const parsed = parseScriptResponse(JSON.stringify(proposal));
  if (!parsed.ok) throw new Error(parsed.errors.join('\n'));
  const script = parsed.proposal;
  const previousIds = new Set(project.scenes.map(scene => scene.sceneId));
  if (sceneIds.length !== script.scenes.length || new Set(sceneIds).size !== sceneIds.length
    || sceneIds.some(id => previousIds.has(id))) throw new Error('Cada escena requiere un ID nuevo y único.');
  let startMs = 0;
  const scenes: Scene[] = script.scenes.map((scene, index) => {
    const durationMs = Math.round(scene.seconds * 1000 / LIMITS.timeStepMs) * LIMITS.timeStepMs;
    const result: Scene = { sceneId: sceneIds[index]!, revision: 0, title: scene.title,
      text: scene.narration, visualIntent: scene.visualIntent, startMs, durationMs,
      visual: null, audio: null, words: [], mediaBindings: { audio: null, words: null } };
    startMs += durationMs;
    return result;
  });
  if (startMs > LIMITS.maxDurationMs) throw new Error('La duración redondeada supera 60 segundos (60000 ms). Ajusta el guion.');
  const result = validateProject({ ...project, title: script.title, sources: script.sources,
    cover: script.cover, postText: script.postText, scenes, output: { ...project.output, durationMs: startMs } });
  if (!result.ok) throw new Error('El guion no produce un proyecto válido. Revisa las escenas y sus IDs.');
  return result.project;
}
