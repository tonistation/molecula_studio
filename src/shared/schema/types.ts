/** A single validation finding. `path` is rooted at `$` and uses dot/bracket notation. */
export type Issue = { path: string; code: string; message: string };

export type ProjectMode = 'editable' | 'read-only';

export type Vec3 = [number, number, number];

export interface Proportions {
  width: number;
  height: number;
  depth: number;
}

export type Identity =
  | {
      type: 'character';
      proportions: Proportions;
      props: { bodyColor: string; accentColor: string };
      rigId: 'character-basic-v1';
      voiceId: null;
    }
  | {
      type: 'car';
      proportions: Proportions;
      props: { bodyColor: string; wheelColor: string };
      rigId: 'rigid-v1';
      voiceId: null;
    }
  | {
      type: 'rockLayers';
      proportions: Proportions;
      props: { colors: string[] };
      rigId: 'rigid-v1';
      voiceId: null;
    }
  | {
      type: 'arrow';
      proportions: Proportions;
      props: { color: string; direction: Vec3 };
      rigId: 'rigid-v1';
      voiceId: null;
    }
  | {
      type: 'label';
      proportions: Proportions;
      props: { text: string; color: string };
      rigId: 'rigid-v1';
      voiceId: null;
    };

export interface Entity {
  entityId: string;
  definitionVersion: number;
  generatorId: 'procedural-v1';
  generatorVersion: 1;
  seed: number;
  variantOf: { entityId: string; definitionVersion: number } | null;
  identity: Identity;
}

export interface CameraKeyframe {
  atMs: number;
  position: Vec3;
  target: Vec3;
  fovDeg: number;
}

export interface Camera {
  projection: 'perspective';
  keyframes: CameraKeyframe[];
}

export interface Component {
  componentId: string;
  entityId: string;
  definitionVersion: number;
  position: Vec3;
  rotation: Vec3;
  scale: number;
  motion: 'none' | 'idle' | 'pulse' | 'reveal';
  state: 'default';
}

export interface StylizedVisual {
  templateId: 'explainer-v1';
  palette: 'daylight' | 'dark';
  background: string;
  camera: Camera;
  components: Component[];
}

/**
 * Visual payload of a style this runtime does not install. It is preserved
 * verbatim inside `inert` and must never be interpreted, previewed or exported.
 */
export interface InertVisual {
  readonly inert: unknown;
}

export type SceneVisual = StylizedVisual | InertVisual;

export interface Word {
  text: string;
  startMs: number;
  endMs: number;
  emphasis: boolean;
}

export interface SceneAudio {
  assetId: string;
  offsetMs: number;
  gainDb: number;
}

export interface DigestPair {
  inputDigest: string;
  outputDigest: string;
}

export interface MediaBindings {
  audio: DigestPair | null;
  words: DigestPair | null;
}

export interface Scene {
  sceneId: string;
  revision: number;
  title: string;
  startMs: number;
  durationMs: number;
  text: string;
  visualIntent: string;
  visual: SceneVisual | null;
  audio: SceneAudio | null;
  words: Word[];
  mediaBindings: MediaBindings;
}

export type AssetKind = 'audio' | 'image';

export type AssetMimeType = 'audio/wav' | 'audio/mpeg' | 'image/png' | 'image/jpeg';

export interface Asset {
  assetId: string;
  kind: AssetKind;
  path: string;
  mimeType: AssetMimeType;
  byteLength: number;
  sha256: string | null;
  durationMs: number | null;
  source: {
    origin: 'user' | 'fixture' | 'provider';
    license: string;
    attribution: string;
  };
}

export interface Output {
  width: 1080;
  height: 1920;
  fps: 30;
  durationMs: number;
  container: 'mp4';
  voiceMode: 'silent' | 'withVoice';
}

export interface CaptionStyle {
  enabled: boolean;
  fontId: 'builtin-sans-heavy-v1';
  fontSizePx: number;
  color: string;
  highlightColor: string;
  anchor: 'upper' | 'lower' | 'center';
  safeMarginPx: number;
}

export interface Approval {
  contentDigest: string;
  approvedRevision: number;
  approvedAt: string;
}

export interface Project {
  schemaVersion: 1;
  projectId: string;
  revision: number;
  title: string;
  createdAt: string;
  updatedAt: string;
  idea: string;
  locale: 'es' | 'en';
  styleId: string;
  styleVersion: number;
  seed: number;
  output: Output;
  captionStyle: CaptionStyle;
  entities: Entity[];
  scenes: Scene[];
  assets: Asset[];
  approval: Approval | null;
}

export type ParseFailure =
  | 'too-large'
  | 'too-deep'
  | 'invalid-json'
  | 'duplicate-key'
  | 'dangerous-key'
  | 'unsupported-version'
  | 'invalid-schema';

export type ValidateOutcome =
  | { ok: true; mode: ProjectMode; project: Project; inertVisual?: unknown }
  | { ok: false; issues: Issue[] };

export type ParseOutcome =
  | { ok: true; mode: ProjectMode; project: Project; inertVisual?: unknown }
  | { ok: false; failure: ParseFailure; issues: Issue[] };
