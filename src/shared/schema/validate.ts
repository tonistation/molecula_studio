import { LIMITS, SCHEMA_VERSION } from './limits.ts';
import { issue } from './errors.ts';
import type { IssueCode } from './errors.ts';
import type {
  Approval,
  Asset,
  AssetMimeType,
  Camera,
  CameraKeyframe,
  CaptionStyle,
  Component,
  DigestPair,
  Entity,
  Identity,
  Issue,
  MediaBindings,
  Output,
  Project,
  ProjectMode,
  Proportions,
  Scene,
  SceneAudio,
  SceneVisual,
  StylizedVisual,
  ValidateOutcome,
  Vec3,
  Word,
} from './types.ts';

const ID_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const UTC_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/;
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const INSTALLED_STYLE_ID = 'stylized-3d';
const INSTALLED_STYLE_VERSION = 1;

const ROOT_KEYS = [
  'schemaVersion',
  'projectId',
  'revision',
  'title',
  'createdAt',
  'updatedAt',
  'idea',
  'locale',
  'styleId',
  'styleVersion',
  'seed',
  'output',
  'captionStyle',
  'entities',
  'scenes',
  'assets',
  'approval',
] as const;

const OUTPUT_KEYS = ['width', 'height', 'fps', 'durationMs', 'container', 'voiceMode'] as const;
const CAPTION_KEYS = [
  'enabled',
  'fontId',
  'fontSizePx',
  'color',
  'highlightColor',
  'anchor',
  'safeMarginPx',
] as const;
const ENTITY_KEYS = [
  'entityId',
  'definitionVersion',
  'generatorId',
  'generatorVersion',
  'seed',
  'variantOf',
  'identity',
] as const;
const IDENTITY_KEYS = ['type', 'proportions', 'props', 'rigId', 'voiceId'] as const;
const PROPORTIONS_KEYS = ['width', 'height', 'depth'] as const;
const VARIANT_KEYS = ['entityId', 'definitionVersion'] as const;
const SCENE_KEYS = [
  'sceneId',
  'revision',
  'title',
  'startMs',
  'durationMs',
  'text',
  'visualIntent',
  'visual',
  'audio',
  'words',
  'mediaBindings',
] as const;
const SCENE_AUDIO_KEYS = ['assetId', 'offsetMs', 'gainDb'] as const;
const WORD_KEYS = ['text', 'startMs', 'endMs', 'emphasis'] as const;
const BINDING_KEYS = ['inputDigest', 'outputDigest'] as const;
const MEDIA_BINDING_KEYS = ['audio', 'words'] as const;
const VISUAL_KEYS = ['templateId', 'palette', 'background', 'camera', 'components'] as const;
const CAMERA_KEYS = ['projection', 'keyframes'] as const;
const KEYFRAME_KEYS = ['atMs', 'position', 'target', 'fovDeg'] as const;
const COMPONENT_KEYS = [
  'componentId',
  'entityId',
  'definitionVersion',
  'position',
  'rotation',
  'scale',
  'motion',
  'state',
] as const;
const ASSET_KEYS = [
  'assetId',
  'kind',
  'path',
  'mimeType',
  'byteLength',
  'sha256',
  'durationMs',
  'source',
] as const;
const SOURCE_KEYS = ['origin', 'license', 'attribution'] as const;
const APPROVAL_KEYS = ['contentDigest', 'approvedRevision', 'approvedAt'] as const;

const MIME_EXTENSION: Record<AssetMimeType, string> = {
  'audio/wav': 'wav',
  'audio/mpeg': 'mp3',
  'image/png': 'png',
  'image/jpeg': 'jpg',
};

const MIME_KIND: Record<AssetMimeType, 'audio' | 'image'> = {
  'audio/wav': 'audio',
  'audio/mpeg': 'audio',
  'image/png': 'image',
  'image/jpeg': 'image',
};

const IDENTITY_TYPES = ['character', 'car', 'rockLayers', 'arrow', 'label'] as const;
const MOTIONS = ['none', 'idle', 'pulse', 'reveal'] as const;
const MIME_TYPES = ['audio/wav', 'audio/mpeg', 'image/png', 'image/jpeg'] as const;
const ORIGINS = ['user', 'fixture', 'provider'] as const;

type Ctx = { issues: Issue[] };

/**
 * Validates an already-parsed value against schema 1.
 *
 * Never mutates the input and never throws for malformed data: all findings
 * come back as `issues`. Unknown styles return `mode: 'read-only'` with the
 * visual payload preserved as inert JSON.
 */
export function validateProject(value: unknown): ValidateOutcome {
  const structural = inspectStructure(value);
  if (structural.length > 0) return { ok: false, issues: structural };

  const ctx: Ctx = { issues: [] };
  const result = readProject(ctx, value);
  if (ctx.issues.length > 0) return { ok: false, issues: ctx.issues };
  if (result.inertVisual === undefined) {
    return { ok: true, mode: result.mode, project: result.project };
  }
  return { ok: true, mode: result.mode, project: result.project, inertVisual: result.inertVisual };
}

// ---------------------------------------------------------------------------
// Structure pre-checks (depth, dangerous keys, cycles, non-plain values)
// ---------------------------------------------------------------------------

function inspectStructure(root: unknown): Issue[] {
  const issues: Issue[] = [];
  const seen = new Set<object>();

  const walk = (value: unknown, path: string, depth: number): void => {
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        issues.push(issue(path, 'type', 'numbers must be finite'));
      }
      return;
    }
    if (typeof value !== 'object' || value === null) return;

    if (seen.has(value)) {
      issues.push(issue(path, 'cycle', 'cyclic structures are not valid JSON data'));
      return;
    }
    if (depth > LIMITS.maxDepth) {
      issues.push(issue(path, 'depth', `nesting exceeds ${LIMITS.maxDepth}`));
      return;
    }
    if (!Array.isArray(value) && !isPlainObject(value)) {
      issues.push(issue(path, 'type', 'only plain objects and arrays are supported'));
      return;
    }

    seen.add(value);
    try {
      if (Array.isArray(value)) {
        for (let index = 0; index < value.length; index += 1) {
          walk(value[index], `${path}[${index}]`, depth + 1);
        }
        return;
      }
      for (const key of Object.keys(value)) {
        if (DANGEROUS_KEYS.has(key)) {
          issues.push(issue(path, 'dangerous-key', `key "${key}" is not allowed`));
          continue;
        }
        walk((value as Record<string, unknown>)[key], `${path}.${key}`, depth + 1);
      }
    } finally {
      seen.delete(value);
    }
  };

  walk(root, '$', 1);
  return issues;
}

// ---------------------------------------------------------------------------
// Reader helpers: record an issue and return a safe fallback
// ---------------------------------------------------------------------------

function push(ctx: Ctx, path: string, code: IssueCode, message: string): void {
  ctx.issues.push(issue(path, code, message));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function readObject(
  ctx: Ctx,
  path: string,
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (!isPlainObject(value)) {
    push(ctx, path, 'type', 'must be an object');
    return {};
  }
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) push(ctx, path, 'unknown-key', `unknown key "${key}"`);
  }
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) push(ctx, path, 'required', `missing key "${key}"`);
  }
  return value;
}

function readArray(ctx: Ctx, path: string, value: unknown, max: number): unknown[] {
  if (!Array.isArray(value)) {
    push(ctx, path, 'type', 'must be an array');
    return [];
  }
  if (value.length > max) push(ctx, path, 'limit', `must contain at most ${max} items`);
  return value;
}

function readString(ctx: Ctx, path: string, value: unknown, min: number, max: number): string {
  if (typeof value !== 'string') {
    push(ctx, path, 'type', 'must be a string');
    return '';
  }
  const length = textLength(value);
  if (length < min || length > max) push(ctx, path, 'range', `must be ${min}-${max} characters`);
  if (hasForbiddenControl(value)) {
    push(ctx, path, 'text-control', 'must not contain NUL or control characters other than tab/newline');
  }
  return value;
}

function readBoolean(ctx: Ctx, path: string, value: unknown): boolean {
  if (typeof value !== 'boolean') {
    push(ctx, path, 'type', 'must be a boolean');
    return false;
  }
  return value;
}

function readInt(ctx: Ctx, path: string, value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    push(ctx, path, 'type', 'must be an integer');
    return min;
  }
  if (!Number.isSafeInteger(value)) {
    push(ctx, path, 'range', 'must be a safe integer');
    return min;
  }
  if (value < min || value > max) {
    push(ctx, path, 'range', `must be between ${min} and ${max}`);
    return min;
  }
  return value;
}

function readNumber(ctx: Ctx, path: string, value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    push(ctx, path, 'type', 'must be a finite number');
    return min;
  }
  if (value < min || value > max) {
    push(ctx, path, 'range', `must be between ${min} and ${max}`);
    return min;
  }
  return value;
}

function readConst<const T>(ctx: Ctx, path: string, value: unknown, expected: T): T {
  if (value !== expected) push(ctx, path, 'const', `must be ${JSON.stringify(expected)}`);
  return expected;
}

function readEnum<T extends string>(
  ctx: Ctx,
  path: string,
  value: unknown,
  allowed: readonly T[],
): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    push(ctx, path, 'const', `must be one of ${allowed.map((item) => `"${item}"`).join(', ')}`);
    return allowed[0] as T;
  }
  return value as T;
}

function readId(ctx: Ctx, path: string, value: unknown): string {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    push(ctx, path, 'pattern', 'must match [a-z][a-z0-9_-]{0,63}');
    return '';
  }
  return value;
}

function readColor(ctx: Ctx, path: string, value: unknown): string {
  if (typeof value !== 'string' || !HEX_COLOR.test(value)) {
    push(ctx, path, 'pattern', 'must be a #RRGGBB color');
    return '#000000';
  }
  return value;
}

function readDigest(ctx: Ctx, path: string, value: unknown, nullable: boolean): string | null {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || !SHA256_HEX.test(value)) {
    push(ctx, path, 'digest', 'must be 64 lowercase hex characters');
    return null;
  }
  return value;
}

function readUtcDate(ctx: Ctx, path: string, value: unknown): string {
  if (typeof value !== 'string' || !isValidUtcTimestamp(value)) {
    push(ctx, path, 'date', 'must be an ISO 8601 UTC timestamp ending in Z');
    return '';
  }
  return value;
}

/**
 * Accepts `YYYY-MM-DDTHH:MM:SS[.fraction]Z` with real calendar components.
 * `Date.parse` alone would normalize `2026-02-30` into March, so components are
 * checked explicitly instead of trusting the platform parser.
 */
function isValidUtcTimestamp(value: string): boolean {
  if (!UTC_DATE.test(value)) return false;

  const [datePart, timePart] = value.slice(0, -1).split('T');
  if (!datePart || !timePart) return false;

  const [year, month, day] = datePart.split('-').map(Number);
  const [hour, minute, second] = timePart.split('.')[0]!.split(':').map(Number);
  if (year === undefined || month === undefined || day === undefined) return false;
  if (hour === undefined || minute === undefined || second === undefined) return false;
  if (hour > 23 || minute > 59 || second > 59) return false;

  const check = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return (
    check.getUTCFullYear() === year &&
    check.getUTCMonth() === month - 1 &&
    check.getUTCDate() === day
  );
}

function readVec3(
  ctx: Ctx,
  path: string,
  value: unknown,
  min: number,
  max: number,
): Vec3 {
  if (!Array.isArray(value) || value.length !== 3) {
    push(ctx, path, 'type', 'must be an array of three numbers');
    return [0, 0, 0];
  }
  const x = readNumber(ctx, `${path}[0]`, value[0], min, max);
  const y = readNumber(ctx, `${path}[1]`, value[1], min, max);
  const z = readNumber(ctx, `${path}[2]`, value[2], min, max);
  return [x, y, z];
}

function readOptionalObject(
  ctx: Ctx,
  path: string,
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> | null {
  if (value === null) return null;
  return readObject(ctx, path, value, keys);
}

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

interface ReadProjectResult {
  mode: ProjectMode;
  project: Project;
  inertVisual?: unknown;
}

function readProject(ctx: Ctx, value: unknown): ReadProjectResult {
  const root = readObject(ctx, '$', value, ROOT_KEYS);

  const schemaVersion = readConst(ctx, '$.schemaVersion', root.schemaVersion, SCHEMA_VERSION);
  const projectId = readId(ctx, '$.projectId', root.projectId);
  const revision = readInt(ctx, '$.revision', root.revision, 0, Number.MAX_SAFE_INTEGER);
  const title = readString(ctx, '$.title', root.title, 1, 120);
  const createdAt = readUtcDate(ctx, '$.createdAt', root.createdAt);
  const updatedAt = readUtcDate(ctx, '$.updatedAt', root.updatedAt);
  if (createdAt && updatedAt && Date.parse(updatedAt) < Date.parse(createdAt)) {
    push(ctx, '$.updatedAt', 'date-order', 'updatedAt must not be before createdAt');
  }
  const idea = readString(ctx, '$.idea', root.idea, 0, 4000);
  const locale = readEnum(ctx, '$.locale', root.locale, ['es', 'en'] as const);
  const styleId = readId(ctx, '$.styleId', root.styleId);
  const styleVersion = readInt(ctx, '$.styleVersion', root.styleVersion, 1, Number.MAX_SAFE_INTEGER);
  const seed = readInt(ctx, '$.seed', root.seed, 0, 4294967295);

  const output = readOutput(ctx, '$.output', root.output);
  const captionStyle = readCaptionStyle(ctx, '$.captionStyle', root.captionStyle);
  const assets = readAssets(ctx, '$.assets', root.assets);
  const entities = readEntities(ctx, '$.entities', root.entities);

  const mode: ProjectMode =
    styleId === INSTALLED_STYLE_ID && styleVersion === INSTALLED_STYLE_VERSION
      ? 'editable'
      : 'read-only';

  const scenes = readScenes(ctx, '$.scenes', root.scenes, {
    mode,
    output,
    entities: new Map(entities.map((entity) => [entity.entityId, entity])),
    assets: new Map(assets.map((asset) => [asset.assetId, asset])),
  });

  const approval = readApproval(ctx, '$.approval', root.approval, revision, updatedAt);

  const project: Project = {
    schemaVersion,
    projectId,
    revision,
    title,
    createdAt,
    updatedAt,
    idea,
    locale,
    styleId,
    styleVersion,
    seed,
    output,
    captionStyle,
    entities,
    scenes: scenes.items,
    assets,
    approval,
  };

  return { mode, project, inertVisual: scenes.inertVisual };
}

function readOutput(ctx: Ctx, path: string, value: unknown): Output {
  const raw = readObject(ctx, path, value, OUTPUT_KEYS);
  const width = readConst(ctx, `${path}.width`, raw.width, 1080);
  const height = readConst(ctx, `${path}.height`, raw.height, 1920);
  const fps = readConst(ctx, `${path}.fps`, raw.fps, 30);
  const durationMs = readInt(ctx, `${path}.durationMs`, raw.durationMs, 0, LIMITS.maxDurationMs);
  if (typeof raw.durationMs === 'number' && raw.durationMs % LIMITS.timeStepMs !== 0) {
    push(ctx, `${path}.durationMs`, 'grid', `must be a multiple of ${LIMITS.timeStepMs}ms`);
  }
  const container = readConst(ctx, `${path}.container`, raw.container, 'mp4');
  const voiceMode = readEnum(ctx, `${path}.voiceMode`, raw.voiceMode, ['silent', 'withVoice'] as const);
  return { width, height, fps, durationMs, container, voiceMode };
}

function readCaptionStyle(ctx: Ctx, path: string, value: unknown): CaptionStyle {
  const raw = readObject(ctx, path, value, CAPTION_KEYS);
  return {
    enabled: readBoolean(ctx, `${path}.enabled`, raw.enabled),
    fontId: readConst(ctx, `${path}.fontId`, raw.fontId, 'builtin-sans-heavy-v1'),
    fontSizePx: readInt(ctx, `${path}.fontSizePx`, raw.fontSizePx, 24, 120),
    color: readColor(ctx, `${path}.color`, raw.color),
    highlightColor: readColor(ctx, `${path}.highlightColor`, raw.highlightColor),
    anchor: readEnum(ctx, `${path}.anchor`, raw.anchor, ['upper', 'lower', 'center'] as const),
    safeMarginPx: readInt(ctx, `${path}.safeMarginPx`, raw.safeMarginPx, 48, 240),
  };
}

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

function readAssets(ctx: Ctx, path: string, value: unknown): Asset[] {
  const items = readArray(ctx, path, value, LIMITS.maxAssets);
  const seen = new Set<string>();

  return items.map((item, index) => {
    const at = `${path}[${index}]`;
    const raw = readObject(ctx, at, item, ASSET_KEYS);

    const assetId = readId(ctx, `${at}.assetId`, raw.assetId);
    if (seen.has(assetId)) push(ctx, `${at}.assetId`, 'unique', `duplicate assetId "${assetId}"`);
    seen.add(assetId);

    const kind = readEnum(ctx, `${at}.kind`, raw.kind, ['audio', 'image'] as const);
    const mimeType = readEnum(ctx, `${at}.mimeType`, raw.mimeType, MIME_TYPES);
    if (MIME_KIND[mimeType] !== kind) {
      push(ctx, `${at}.mimeType`, 'const', `MIME type "${mimeType}" does not match kind "${kind}"`);
    }

    const assetPath = readString(ctx, `${at}.path`, raw.path, 1, 120);
    const expectedPath = `assets/${assetId}.${MIME_EXTENSION[mimeType]}`;
    if (assetPath !== expectedPath) {
      push(ctx, `${at}.path`, 'path', `must be exactly "${expectedPath}"`);
    }

    const byteLength = readInt(ctx, `${at}.byteLength`, raw.byteLength, 1, LIMITS.maxAssetBytes);
    const sha256 = readDigest(ctx, `${at}.sha256`, raw.sha256, true);
    const durationMs =
      kind === 'audio'
        ? readInt(ctx, `${at}.durationMs`, raw.durationMs, 1, LIMITS.maxAudioDurationMs)
        : readConst(ctx, `${at}.durationMs`, raw.durationMs, null);

    const sourceRaw = readObject(ctx, `${at}.source`, raw.source, SOURCE_KEYS);
    const source = {
      origin: readEnum(ctx, `${at}.source.origin`, sourceRaw.origin, ORIGINS),
      license: readString(ctx, `${at}.source.license`, sourceRaw.license, 1, 200),
      attribution: readString(ctx, `${at}.source.attribution`, sourceRaw.attribution, 0, 500),
    };

    return { assetId, kind, path: assetPath, mimeType, byteLength, sha256, durationMs, source };
  });
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

function readEntities(ctx: Ctx, path: string, value: unknown): Entity[] {
  const items = readArray(ctx, path, value, LIMITS.maxEntities);
  const seen = new Set<string>();

  const entities = items.map((item, index) => {
    const at = `${path}[${index}]`;
    const raw = readObject(ctx, at, item, ENTITY_KEYS);

    const entityId = readId(ctx, `${at}.entityId`, raw.entityId);
    if (seen.has(entityId)) push(ctx, `${at}.entityId`, 'unique', `duplicate entityId "${entityId}"`);
    seen.add(entityId);

    const definitionVersion = readInt(
      ctx,
      `${at}.definitionVersion`,
      raw.definitionVersion,
      1,
      Number.MAX_SAFE_INTEGER,
    );
    const generatorId = readConst(ctx, `${at}.generatorId`, raw.generatorId, 'procedural-v1');
    const generatorVersion = readConst(ctx, `${at}.generatorVersion`, raw.generatorVersion, 1);
    const seed = readInt(ctx, `${at}.seed`, raw.seed, 0, 4294967295);

    const variantRaw = readOptionalObject(ctx, `${at}.variantOf`, raw.variantOf, VARIANT_KEYS);
    const variantOf = variantRaw
      ? {
          entityId: readId(ctx, `${at}.variantOf.entityId`, variantRaw.entityId),
          definitionVersion: readInt(
            ctx,
            `${at}.variantOf.definitionVersion`,
            variantRaw.definitionVersion,
            1,
            Number.MAX_SAFE_INTEGER,
          ),
        }
      : null;

    const identity = readIdentity(ctx, `${at}.identity`, raw.identity);

    return {
      entityId,
      definitionVersion,
      generatorId,
      generatorVersion,
      seed,
      variantOf,
      identity,
    };
  });

  const byId = new Map(entities.map((entity) => [entity.entityId, entity]));
  entities.forEach((entity, index) => {
    if (!entity.variantOf) return;
    if (!byId.has(entity.variantOf.entityId)) {
      push(
        ctx,
        `${path}[${index}].variantOf.entityId`,
        'reference',
        `variant origin "${entity.variantOf.entityId}" is not registered`,
      );
      return;
    }
    if (hasVariantCycle(entity.entityId, byId)) {
      push(ctx, `${path}[${index}].variantOf`, 'cycle', 'variant lineage must not form a cycle');
    }
  });

  return entities;
}

function hasVariantCycle(entityId: string, byId: Map<string, Entity>): boolean {
  const seen = new Set<string>();
  let current: string | undefined = entityId;
  while (current !== undefined) {
    if (seen.has(current)) return true;
    seen.add(current);
    current = byId.get(current)?.variantOf?.entityId;
  }
  return false;
}

function readIdentity(ctx: Ctx, path: string, value: unknown): Identity {
  const raw = readObject(ctx, path, value, IDENTITY_KEYS);
  const type = readEnum(ctx, `${path}.type`, raw.type, IDENTITY_TYPES);
  const proportions = readProportions(ctx, `${path}.proportions`, raw.proportions);
  const rigId = readEnum(ctx, `${path}.rigId`, raw.rigId, ['character-basic-v1', 'rigid-v1'] as const);
  readConst(ctx, `${path}.voiceId`, raw.voiceId, null);

  const expectedRig = type === 'character' ? 'character-basic-v1' : 'rigid-v1';
  if (rigId !== expectedRig) {
    push(ctx, `${path}.rigId`, 'const', `identity type "${type}" requires rig "${expectedRig}"`);
  }

  switch (type) {
    case 'character': {
      const props = readObject(ctx, `${path}.props`, raw.props, ['bodyColor', 'accentColor']);
      return {
        type,
        proportions,
        props: {
          bodyColor: readColor(ctx, `${path}.props.bodyColor`, props.bodyColor),
          accentColor: readColor(ctx, `${path}.props.accentColor`, props.accentColor),
        },
        rigId: 'character-basic-v1',
        voiceId: null,
      };
    }
    case 'car': {
      const props = readObject(ctx, `${path}.props`, raw.props, ['bodyColor', 'wheelColor']);
      return {
        type,
        proportions,
        props: {
          bodyColor: readColor(ctx, `${path}.props.bodyColor`, props.bodyColor),
          wheelColor: readColor(ctx, `${path}.props.wheelColor`, props.wheelColor),
        },
        rigId: 'rigid-v1',
        voiceId: null,
      };
    }
    case 'rockLayers': {
      const props = readObject(ctx, `${path}.props`, raw.props, ['colors']);
      const colors = readArray(ctx, `${path}.props.colors`, props.colors, 6);
      if (colors.length < 2) {
        push(ctx, `${path}.props.colors`, 'range', 'must contain 2-6 colors');
      }
      return {
        type,
        proportions,
        props: {
          colors: colors.map((color, index) =>
            readColor(ctx, `${path}.props.colors[${index}]`, color),
          ),
        },
        rigId: 'rigid-v1',
        voiceId: null,
      };
    }
    case 'arrow': {
      const props = readObject(ctx, `${path}.props`, raw.props, ['color', 'direction']);
      const color = readColor(ctx, `${path}.props.color`, props.color);
      const direction = readVec3(ctx, `${path}.props.direction`, props.direction, -1, 1);
      const length = Math.hypot(direction[0], direction[1], direction[2]);
      if (Math.abs(length - 1) > 1e-6) {
        push(ctx, `${path}.props.direction`, 'range', 'must be a non-zero unit vector');
      }
      return {
        type,
        proportions,
        props: { color, direction },
        rigId: 'rigid-v1',
        voiceId: null,
      };
    }
    case 'label': {
      const props = readObject(ctx, `${path}.props`, raw.props, ['text', 'color']);
      return {
        type,
        proportions,
        props: {
          text: readString(ctx, `${path}.props.text`, props.text, 1, 120),
          color: readColor(ctx, `${path}.props.color`, props.color),
        },
        rigId: 'rigid-v1',
        voiceId: null,
      };
    }
  }
}

function readProportions(ctx: Ctx, path: string, value: unknown): Proportions {
  const raw = readObject(ctx, path, value, PROPORTIONS_KEYS);
  return {
    width: readNumber(ctx, `${path}.width`, raw.width, 0.1, 10),
    height: readNumber(ctx, `${path}.height`, raw.height, 0.1, 10),
    depth: readNumber(ctx, `${path}.depth`, raw.depth, 0.1, 10),
  };
}

// ---------------------------------------------------------------------------
// Scenes
// ---------------------------------------------------------------------------

interface SceneEnv {
  mode: ProjectMode;
  output: Output;
  entities: Map<string, Entity>;
  assets: Map<string, Asset>;
}

function readScenes(
  ctx: Ctx,
  path: string,
  value: unknown,
  env: SceneEnv,
): { items: Scene[]; inertVisual?: unknown } {
  const rawScenes = readArray(ctx, path, value, LIMITS.maxScenes);
  const seen = new Set<string>();
  const inertVisual: Array<{ sceneId: string; visual: unknown }> = [];

  let expectedStartMs = 0;
  let totalText = 0;
  let totalWords = 0;

  const items = rawScenes.map((item, index) => {
    const at = `${path}[${index}]`;
    const raw = readObject(ctx, at, item, SCENE_KEYS);

    const sceneId = readId(ctx, `${at}.sceneId`, raw.sceneId);
    if (seen.has(sceneId)) push(ctx, `${at}.sceneId`, 'unique', `duplicate sceneId "${sceneId}"`);
    seen.add(sceneId);

    const revision = readInt(ctx, `${at}.revision`, raw.revision, 0, Number.MAX_SAFE_INTEGER);
    const title = readString(ctx, `${at}.title`, raw.title, 1, 120);

    const startMs = readInt(ctx, `${at}.startMs`, raw.startMs, 0, LIMITS.maxDurationMs);
    if (startMs % LIMITS.timeStepMs !== 0) {
      push(ctx, `${at}.startMs`, 'grid', `must be a multiple of ${LIMITS.timeStepMs}ms`);
    }
    if (startMs !== expectedStartMs) {
      push(ctx, `${at}.startMs`, 'layout', `must start at ${expectedStartMs} to stay contiguous`);
    }

    const durationMs = readInt(
      ctx,
      `${at}.durationMs`,
      raw.durationMs,
      LIMITS.minSceneMs,
      LIMITS.maxSceneMs,
    );
    if (durationMs % LIMITS.timeStepMs !== 0) {
      push(ctx, `${at}.durationMs`, 'grid', `must be a multiple of ${LIMITS.timeStepMs}ms`);
    }
    expectedStartMs += durationMs;

    const text = readString(ctx, `${at}.text`, raw.text, 0, LIMITS.maxSceneText);
    totalText += textLength(text);
    const visualIntent = readString(ctx, `${at}.visualIntent`, raw.visualIntent, 0, 1000);

    const visual = readSceneVisual(ctx, `${at}.visual`, raw.visual, durationMs, env);
    if (visual && 'inert' in visual) inertVisual.push({ sceneId, visual: visual.inert });

    const audio = readSceneAudio(ctx, `${at}.audio`, raw.audio, env.assets);
    const words = readWords(ctx, `${at}.words`, raw.words, durationMs);
    totalWords += words.length;

    const mediaBindings = readMediaBindings(ctx, `${at}.mediaBindings`, raw.mediaBindings, {
      hasAudio: audio !== null,
      hasWords: words.length > 0,
    });

    return {
      sceneId,
      revision,
      title,
      startMs,
      durationMs,
      text,
      visualIntent,
      visual,
      audio,
      words,
      mediaBindings,
    };
  });

  if (expectedStartMs !== env.output.durationMs) {
    push(
      ctx,
      `${path}`,
      'sum',
      `scene durations must sum to output.durationMs (${env.output.durationMs}), got ${expectedStartMs}`,
    );
  }
  if (totalText > LIMITS.maxTotalText) {
    push(ctx, path, 'limit', `total scene text must stay under ${LIMITS.maxTotalText} characters`);
  }
  if (totalWords > LIMITS.maxWordsPerProject) {
    push(ctx, path, 'limit', `total words must stay under ${LIMITS.maxWordsPerProject}`);
  }

  return env.mode === 'read-only' ? { items, inertVisual } : { items };
}

function readSceneVisual(
  ctx: Ctx,
  path: string,
  value: unknown,
  durationMs: number,
  env: SceneEnv,
): SceneVisual | null {
  if (value === null) return null;
  if (!isPlainObject(value)) {
    push(ctx, path, 'type', 'visual must be null or an object');
    return null;
  }
  if (env.mode === 'read-only') return { inert: value };
  return readStylizedVisual(ctx, path, value, durationMs, env.entities);
}

function readStylizedVisual(
  ctx: Ctx,
  path: string,
  value: unknown,
  durationMs: number,
  entities: Map<string, Entity>,
): StylizedVisual {
  const raw = readObject(ctx, path, value, VISUAL_KEYS);
  return {
    templateId: readConst(ctx, `${path}.templateId`, raw.templateId, 'explainer-v1'),
    palette: readEnum(ctx, `${path}.palette`, raw.palette, ['daylight', 'dark'] as const),
    background: readColor(ctx, `${path}.background`, raw.background),
    camera: readCamera(ctx, `${path}.camera`, raw.camera, durationMs),
    components: readComponents(ctx, `${path}.components`, raw.components, entities),
  };
}

function readCamera(ctx: Ctx, path: string, value: unknown, durationMs: number): Camera {
  const raw = readObject(ctx, path, value, CAMERA_KEYS);
  const projection = readConst(ctx, `${path}.projection`, raw.projection, 'perspective');
  const keyframes = readArray(ctx, `${path}.keyframes`, raw.keyframes, LIMITS.maxCameraKeyframes);
  if (keyframes.length < 1) push(ctx, `${path}.keyframes`, 'limit', 'must contain 1-8 keyframes');

  let previousAtMs = -1;
  const items = keyframes.map((item, index) => {
    const at = `${path}.keyframes[${index}]`;
    const frame = readObject(ctx, at, item, KEYFRAME_KEYS);
    const atMs = readInt(ctx, `${at}.atMs`, frame.atMs, 0, durationMs);
    if (index === 0 && atMs !== 0) {
      push(ctx, `${at}.atMs`, 'order', 'first keyframe must be at 0');
    }
    if (atMs <= previousAtMs) {
      push(ctx, `${at}.atMs`, 'order', 'keyframes must be strictly increasing');
    }
    previousAtMs = atMs;

    const position = readVec3(ctx, `${at}.position`, frame.position, -100, 100);
    const target = readVec3(ctx, `${at}.target`, frame.target, -100, 100);
    if (position[0] === target[0] && position[1] === target[1] && position[2] === target[2]) {
      push(ctx, `${at}.target`, 'range', 'position and target must be different');
    }

    return {
      atMs,
      position,
      target,
      fovDeg: readNumber(ctx, `${at}.fovDeg`, frame.fovDeg, 20, 80),
    } satisfies CameraKeyframe;
  });

  return { projection, keyframes: items };
}

function readComponents(
  ctx: Ctx,
  path: string,
  value: unknown,
  entities: Map<string, Entity>,
): Component[] {
  const items = readArray(ctx, path, value, LIMITS.maxComponents);
  if (items.length < 1) push(ctx, path, 'limit', 'must contain 1-16 components');

  const seen = new Set<string>();
  return items.map((item, index) => {
    const at = `${path}[${index}]`;
    const raw = readObject(ctx, at, item, COMPONENT_KEYS);

    const componentId = readId(ctx, `${at}.componentId`, raw.componentId);
    if (seen.has(componentId)) {
      push(ctx, `${at}.componentId`, 'unique', `duplicate componentId "${componentId}"`);
    }
    seen.add(componentId);

    const entityId = readId(ctx, `${at}.entityId`, raw.entityId);
    const definitionVersion = readInt(
      ctx,
      `${at}.definitionVersion`,
      raw.definitionVersion,
      1,
      Number.MAX_SAFE_INTEGER,
    );
    const entity = entities.get(entityId);
    if (!entity) {
      push(ctx, `${at}.entityId`, 'reference', `entity "${entityId}" is not registered`);
    } else if (entity.definitionVersion !== definitionVersion) {
      push(
        ctx,
        `${at}.definitionVersion`,
        'reference',
        `must reference current definitionVersion ${entity.definitionVersion}`,
      );
    }

    return {
      componentId,
      entityId,
      definitionVersion,
      position: readVec3(ctx, `${at}.position`, raw.position, -100, 100),
      rotation: readVec3(ctx, `${at}.rotation`, raw.rotation, -6.284, 6.284),
      scale: readNumber(ctx, `${at}.scale`, raw.scale, 0.1, 10),
      motion: readEnum(ctx, `${at}.motion`, raw.motion, MOTIONS),
      state: readConst(ctx, `${at}.state`, raw.state, 'default'),
    } satisfies Component;
  });
}

function readSceneAudio(
  ctx: Ctx,
  path: string,
  value: unknown,
  assets: Map<string, Asset>,
): SceneAudio | null {
  if (value === null) return null;
  const raw = readObject(ctx, path, value, SCENE_AUDIO_KEYS);

  const assetId = readId(ctx, `${path}.assetId`, raw.assetId);
  const offsetMs = readInt(ctx, `${path}.offsetMs`, raw.offsetMs, 0, LIMITS.maxDurationMs);
  const gainDb = readNumber(ctx, `${path}.gainDb`, raw.gainDb, -24, 6);

  const asset = assets.get(assetId);
  if (!asset) {
    push(ctx, `${path}.assetId`, 'reference', `audio asset "${assetId}" is not in the manifest`);
  } else if (asset.kind !== 'audio') {
    push(ctx, `${path}.assetId`, 'reference', `asset "${assetId}" is not an audio asset`);
  } else if (asset.durationMs !== null && offsetMs >= asset.durationMs) {
    push(ctx, `${path}.offsetMs`, 'range', 'offsetMs must fall inside the audio asset');
  }

  return { assetId, offsetMs, gainDb };
}

function readWords(ctx: Ctx, path: string, value: unknown, durationMs: number): Word[] {
  const items = readArray(ctx, path, value, LIMITS.maxWordsPerScene);
  let previousEndMs = 0;

  return items.map((item, index) => {
    const at = `${path}[${index}]`;
    const raw = readObject(ctx, at, item, WORD_KEYS);

    const text = readString(ctx, `${at}.text`, raw.text, 1, 80);
    const startMs = readInt(ctx, `${at}.startMs`, raw.startMs, 0, durationMs);
    const endMs = readInt(ctx, `${at}.endMs`, raw.endMs, 0, durationMs);
    if (startMs >= endMs) {
      push(ctx, `${at}.endMs`, 'order', 'endMs must be greater than startMs');
    }
    if (startMs < previousEndMs) {
      push(ctx, `${at}.startMs`, 'order', 'words must be ordered and must not overlap');
    }
    previousEndMs = endMs;

    return {
      text,
      startMs,
      endMs,
      emphasis: readBoolean(ctx, `${at}.emphasis`, raw.emphasis),
    } satisfies Word;
  });
}

function readMediaBindings(
  ctx: Ctx,
  path: string,
  value: unknown,
  present: { hasAudio: boolean; hasWords: boolean },
): MediaBindings {
  const raw = readObject(ctx, path, value, MEDIA_BINDING_KEYS);
  const audio = readDigestPair(ctx, `${path}.audio`, raw.audio);
  const words = readDigestPair(ctx, `${path}.words`, raw.words);

  if (audio && !present.hasAudio) {
    push(ctx, `${path}.audio`, 'binding', 'audio binding must be null when scene.audio is null');
  }
  if (words && !present.hasWords) {
    push(ctx, `${path}.words`, 'binding', 'words binding must be null when scene.words is empty');
  }

  return { audio, words };
}

function readDigestPair(ctx: Ctx, path: string, value: unknown): DigestPair | null {
  if (value === null) return null;
  const raw = readObject(ctx, path, value, BINDING_KEYS);
  return {
    inputDigest: readDigest(ctx, `${path}.inputDigest`, raw.inputDigest, false) ?? '',
    outputDigest: readDigest(ctx, `${path}.outputDigest`, raw.outputDigest, false) ?? '',
  };
}

// ---------------------------------------------------------------------------
// Approval
// ---------------------------------------------------------------------------

function readApproval(
  ctx: Ctx,
  path: string,
  value: unknown,
  revision: number,
  updatedAt: string,
): Approval | null {
  if (value === null) return null;
  const raw = readObject(ctx, path, value, APPROVAL_KEYS);

  const contentDigest = readDigest(ctx, `${path}.contentDigest`, raw.contentDigest, false) ?? '';
  const approvedRevision = readInt(ctx, `${path}.approvedRevision`, raw.approvedRevision, 0, revision);
  const approvedAt = readUtcDate(ctx, `${path}.approvedAt`, raw.approvedAt);
  if (approvedAt && updatedAt && Date.parse(approvedAt) > Date.parse(updatedAt)) {
    push(ctx, `${path}.approvedAt`, 'date-order', 'approvedAt must not be after updatedAt');
  }

  return { contentDigest, approvedRevision, approvedAt };
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

function textLength(value: string): number {
  return [...value].length;
}

function hasForbiddenControl(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 && code !== 0x09 && code !== 0x0a) return true;
  }
  return false;
}
