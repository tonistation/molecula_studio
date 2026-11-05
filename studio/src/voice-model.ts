import type { Project } from '../../src/shared/schema/types.ts';
import { bindingDigests } from '../../src/shared/digests.ts';

export function narrationScript(project: Project): string {
  return project.scenes.map((scene, index) => `${index + 1}. ${scene.title}\n${scene.text}`).join('\n\n');
}

export async function voiceStatuses(project: Project, missingAssets: string[]): Promise<Record<string, string>> {
  const expected = await bindingDigests(project);
  return Object.fromEntries(project.scenes.map((scene, index) => {
    const binding = expected.scenes[index]!;
    const matches = (saved: typeof scene.mediaBindings.audio, input: string | null, output: string | null) =>
      saved === null ? input === null && output === null : saved.inputDigest === input && saved.outputDigest === output;
    const ready = scene.audio && !missingAssets.includes(scene.audio.assetId)
      && binding.audioOutputDigest !== null
      && matches(scene.mediaBindings.audio, binding.audioInputDigest, binding.audioOutputDigest)
      && matches(scene.mediaBindings.words, binding.wordsInputDigest, binding.wordsOutputDigest);
    return [scene.sceneId, !scene.audio ? 'sin voz' : ready ? 'lista' : 'desactualizada'];
  }));
}
