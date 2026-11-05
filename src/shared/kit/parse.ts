import { parseResponseObject } from '../response-json.ts';
import { validateKitScene } from './validate.ts';
import type { KitValidationOptions } from './validate.ts';
import type { KitScene } from './types.ts';

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
