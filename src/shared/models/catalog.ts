import { canonicalize } from '../canonical.ts';
import { verifyModelSnapshotsSync } from './integrity.ts';
import { MAX_PROJECT_MODELS, type ModelSnapshot } from './model.ts';

/** Keep portable snapshots first, then fill remaining bounded slots by scene relevance. */
export function selectModelCatalog(projectModels: readonly ModelSnapshot[], catalog: readonly ModelSnapshot[], text: string): ModelSnapshot[] {
  const project = verifyModelSnapshotsSync(projectModels);
  if (!project) throw new Error('Invalid project models');
  const terms = new Set(text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
  const score = (snapshot: ModelSnapshot) => `${snapshot.model.name} ${snapshot.model.semanticId}`.toLowerCase()
    .split(/[^\p{L}\p{N}]+/u).filter(word => word.length > 2 && terms.has(word)).length;
  const verified: ModelSnapshot[] = [];
  for (let i = 0; i < catalog.length; i += MAX_PROJECT_MODELS) {
    const batch = verifyModelSnapshotsSync(catalog.slice(i, i + MAX_PROJECT_MODELS));
    if (!batch) throw new Error('Invalid catalog models');
    verified.push(...batch);
  }
  const combined = new Map(project.map(snapshot => [snapshot.id, snapshot]));
  for (const snapshot of verified.sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id))) {
    const existing = combined.get(snapshot.id);
    if (existing && canonicalize(existing.model) !== canonicalize(snapshot.model)) throw new Error('Conflicting model');
    if (!existing && combined.size < MAX_PROJECT_MODELS) combined.set(snapshot.id, snapshot);
  }
  return [...combined.values()];
}
