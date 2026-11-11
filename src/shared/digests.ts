import { canonicalize } from './canonical.ts';
import type { Asset, Project, Scene } from './schema/types.ts';
import { verifyModelSnapshots } from './models/integrity.ts';

const encoder = new TextEncoder();

/** Root fields excluded from the content digest (identity, edits, audit, approval). */
const CONTENT_EXCLUDED_KEYS = new Set([
  'projectId',
  'revision',
  'createdAt',
  'updatedAt',
  'approval',
]);

/** SHA-256 as lowercase hex, using WebCrypto so the module stays isomorphic. */
export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === 'string' ? encoder.encode(data) : Uint8Array.from(data);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export interface SceneBindingDigests {
  sceneId: string;
  audioInputDigest: string | null;
  audioOutputDigest: string | null;
  audioTimingDigest: string | null;
  wordsInputDigest: string | null;
  wordsOutputDigest: string | null;
}

export interface BindingDigests {
  contentDigest: string;
  scenes: SceneBindingDigests[];
}

/**
 * Expected digests for the fixed `binding-v1` projections.
 *
 * These are recomputed for comparison only: callers must preserve historical
 * bindings when they differ instead of "repairing" them.
 */
export async function bindingDigests(project: Project): Promise<BindingDigests> {
  project = structuredClone(project);
  if (project.models !== undefined && await verifyModelSnapshots(project.models) === null) {
    throw new Error('La integridad de los modelos no coincide con su identificador.');
  }
  const scenes = await Promise.all(
    project.scenes.map((scene) => sceneBindingDigests(project, scene)),
  );

  // Content digest is the whole root minus identity, edit counters, audit
  // dates and editorial approval (project-format.md, "Vínculos portables").
  const content = Object.fromEntries(
    Object.entries(project).filter(([key]) => !CONTENT_EXCLUDED_KEYS.has(key)),
  );

  return {
    contentDigest: await sha256Hex(canonicalize(content)),
    scenes,
  };
}

async function sceneBindingDigests(
  project: Project,
  scene: Scene,
): Promise<SceneBindingDigests> {
  const audio = scene.audio;
  const asset = audio ? project.assets.find((item) => item.assetId === audio.assetId) : undefined;
  const verifiedSha = asset?.sha256 ?? null;

  const audioInputDigest = audio
    ? await sha256Hex(canonicalize({ text: scene.text, locale: project.locale }))
    : null;

  const audioOutputDigest =
    audio && verifiedSha
      ? await sha256Hex(
          canonicalize({
            assetId: audio.assetId,
            sha256: verifiedSha,
            offsetMs: audio.offsetMs,
            gainDb: audio.gainDb,
          }),
        )
      : null;

  const audioTimingDigest =
    audio && verifiedSha && asset && asset.durationMs !== null && project.output.voiceMode === 'withVoice'
      ? await sha256Hex(
          canonicalize({
            sha256: verifiedSha,
            offsetMs: audio.offsetMs,
            durationMs: consumedAudioMs(asset, scene),
          }),
        )
      : null;

  const hasWords = scene.words.length > 0;
  const wordsInputDigest = hasWords
    ? await sha256Hex(
        canonicalize({ text: scene.text, locale: project.locale, audioTimingDigest }),
      )
    : null;
  const wordsOutputDigest = hasWords ? await sha256Hex(canonicalize(scene.words)) : null;

  return {
    sceneId: scene.sceneId,
    audioInputDigest,
    audioOutputDigest,
    audioTimingDigest,
    wordsInputDigest,
    wordsOutputDigest,
  };
}

/** Audio actually consumed by the scene, bounded by the scene and the file. */
function consumedAudioMs(asset: Asset, scene: Scene): number {
  const remaining = (asset.durationMs ?? 0) - (scene.audio?.offsetMs ?? 0);
  return Math.min(remaining, scene.durationMs);
}
