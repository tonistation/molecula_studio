import { parseResponseObject } from '../response-json.ts';
import { validateKitScene } from './validate.ts';
import type { KitValidationOptions } from './validate.ts';
import type { KitScene } from './types.ts';
import { canonicalize } from '../canonical.ts';
import { sha256Sync } from '../models/sha256-sync.ts';
import { MODEL_ID_PATTERN, validateProceduralModel, type ModelSnapshot } from '../models/model.ts';
import { verifyModelSnapshotsSync } from '../models/integrity.ts';
import { MAX_GENERATED_MODELS } from './output-schema.ts';

export type KitParseResult = { ok: true; scene: KitScene } | { ok: false; errors: string[] };

/** Identical import boundary in manual and automatic modes; never applies or repairs data. */
export function parseKitResponse(text: string, options: KitValidationOptions = {}): KitParseResult {
  const decoded = parseResponseObject(text);
  if (!decoded.ok) return decoded;
  const result = validateKitScene(decoded.value, options);
  if (result.ok) return result;
  // Unknown keys and structural inspection paths may contain untrusted names.
  // Keep known contract locations, but never echo raw validator messages/values.
  return { ok: false, errors: [...new Set(result.issues.map(issue => {
    const path = ['unknown-key', 'depth', 'dangerous-key', 'cycle'].includes(issue.code) ? '$' : issue.path;
    const messages: Record<string, string> = {
      reference: 'La escena contiene una referencia a un objeto o entidad no válido.',
      order: 'La escena contiene tiempos fuera de orden.',
      'unknown-key': 'La escena contiene campos no permitidos.',
      required: 'La escena omite un campo obligatorio o un objetivo de cámara válido.',
      limit: 'La escena supera un límite de recursos.',
      depth: 'La escena supera un límite de profundidad.',
      range: 'La escena contiene un valor fuera del rango permitido.',
      unique: 'La escena contiene IDs de objeto duplicados.',
    };
    return `${path}: ${messages[issue.code] ?? 'La escena contiene un valor no válido para el contrato del kit.'}`;
  }))] };
}

export type KitModelBundleResult = { ok: true; scene: KitScene; models: ModelSnapshot[] } | { ok: false; errors: string[] };

/** Resolve response-local aliases and verified catalog references without mutating inputs. */
export function parseKitModelBundle(text: string, options: KitValidationOptions = {}, catalog: readonly ModelSnapshot[] = []): KitModelBundleResult {
  const decoded = parseResponseObject(text);
  if (!decoded.ok) return decoded;
  const invalid = (): KitModelBundleResult => ({ ok: false, errors: ['La respuesta contiene modelos o referencias no válidos.'] });
  const value = decoded.value as Record<string, unknown>;
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== 2 || !Object.hasOwn(value, 'scene') || !Object.hasOwn(value, 'models')
    || !Array.isArray(value.models) || value.models.length > MAX_GENERATED_MODELS) return invalid();
  const verifiedCatalog = verifyModelSnapshotsSync(catalog);
  if (!verifiedCatalog) return invalid();
  const available = new Map(verifiedCatalog.map(snapshot => [snapshot.id, snapshot]));
  const aliases = new Map<string, string>();
  const generated = new Map<string, ModelSnapshot>();
  for (const item of value.models) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).length !== 2
      || !Object.hasOwn(item, 'alias') || !Object.hasOwn(item, 'model')
      || typeof item.alias !== 'string' || !/^new-[a-z][a-z0-9-]{0,43}$/.test(item.alias)
      || aliases.has(item.alias) || !validateProceduralModel(item.model).ok) return invalid();
    const model = JSON.parse(canonicalize(item.model));
    const id = sha256Sync(canonicalize(model));
    if (generated.has(id)) return invalid();
    aliases.set(item.alias, id);
    generated.set(id, { id, model });
    available.set(id, { id, model });
  }
  const scene = value.scene as Record<string, unknown>;
  if (!scene || typeof scene !== 'object' || Array.isArray(scene) || !Array.isArray(scene.objects)) return invalid();
  const used = new Set(generated.keys());
  for (const item of scene.objects) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || item.type !== 'model') continue;
    if (!item.params || typeof item.params !== 'object' || Array.isArray(item.params)
      || typeof item.params.modelId !== 'string') return invalid();
    const ref = item.params.modelId;
    const id = aliases.get(ref) ?? (MODEL_ID_PATTERN.test(ref) && verifiedCatalog.some(snapshot => snapshot.id === ref) ? ref : '');
    if (!id || !available.has(id)) return invalid();
    item.params.modelId = id;
    used.add(id);
  }
  const parsed = parseKitResponse(JSON.stringify(scene), { ...options, modelIds: new Set(available.keys()) });
  if (!parsed.ok) return parsed;
  const models = verifyModelSnapshotsSync([...used].map(id => available.get(id)));
  return models ? { ok: true, scene: parsed.scene, models } : invalid();
}
