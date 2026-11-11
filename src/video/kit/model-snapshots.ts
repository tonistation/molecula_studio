import { verifyModelSnapshotsSync } from '../../shared/models/integrity.ts';
import type { ProceduralModel } from '../../shared/models/model.ts';

type SceneReferences = readonly { visual: { objects: readonly { type: string; params: unknown }[] } | null }[];

/** Validate once per composition input, not once per object or frame. */
export function resolveModelSnapshots(snapshots: unknown, scenes: SceneReferences):
  { ok: true; models: ReadonlyMap<string, ProceduralModel> } | { ok: false } {
  if (snapshots === undefined) snapshots = [];
  const verified = verifyModelSnapshotsSync(snapshots);
  if (!verified) return { ok: false };
  const models = new Map<string, ProceduralModel>();
  for (const snapshot of verified) {
    models.set(snapshot.id, snapshot.model);
  }
  for (const scene of scenes) for (const object of scene.visual?.objects ?? []) {
    if (object.type === 'model') {
      const params = object.params as { modelId?: unknown } | null;
      if (!params || typeof params.modelId !== 'string' || !models.has(params.modelId)) return { ok: false };
    }
  }
  return { ok: true, models };
}
