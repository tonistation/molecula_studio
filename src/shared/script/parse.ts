import { ProjectJsonError } from '../schema/errors.ts';
import { LIMITS } from '../schema/limits.ts';
import { parseBoundedJsonText } from '../schema/parse.ts';
import { SCRIPT_PROPOSAL_SCHEMA } from './schema.ts';
import type { ScriptProposal } from './schema.ts';

export type ScriptParseResult =
  | { ok: true; proposal: ScriptProposal }
  | { ok: false; errors: string[] };

// Only the vocabulary used by the script contract, not a general JSON Schema engine.
interface ContractNode {
  type: string;
  properties?: Record<string, ContractNode>;
  required?: readonly string[];
  items?: ContractNode;
  minItems?: number;
  maxItems?: number;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  pattern?: string;
}

/** Import data only: no repair, truncation, URL fetching or proposal application. */
export function parseScriptResponse(text: string): ScriptParseResult {
  if (text.length > LIMITS.maxJsonBytes || new TextEncoder().encode(text).byteLength > LIMITS.maxJsonBytes) {
    return { ok: false, errors: [`La respuesta supera el límite de ${LIMITS.maxJsonBytes} bytes.`] };
  }
  const objectText = firstObject(text);
  if (objectText === null) return { ok: false, errors: ['No se encontró un objeto JSON completo en la respuesta.'] };

  let value: unknown;
  try {
    value = parseBoundedJsonText(objectText);
  } catch (error) {
    if (!(error instanceof ProjectJsonError)) throw error;
    const messages: Partial<Record<typeof error.failure, string>> = {
      'duplicate-key': 'El JSON contiene claves duplicadas.',
      'dangerous-key': 'El JSON contiene claves peligrosas no permitidas.',
      'too-deep': `El JSON supera la profundidad máxima de ${LIMITS.maxDepth}.`,
      'too-large': `El JSON supera el límite de ${LIMITS.maxJsonBytes} bytes.`,
    };
    return { ok: false, errors: [messages[error.failure] ?? 'El objeto JSON no es válido. Revisa su sintaxis.'] };
  }

  const errors: string[] = [];
  validateContract(value, SCRIPT_PROPOSAL_SCHEMA, '$', errors);
  if (errors.length > 0) return { ok: false, errors };
  const proposal = value as ScriptProposal;
  // Compensate floating-point accumulation at the inclusive 60-second boundary.
  // Scene values themselves remain untouched (application rounds later).
  let seconds = 0;
  let correction = 0;
  for (const scene of proposal.scenes) {
    const adjusted = scene.seconds - correction;
    const next = seconds + adjusted;
    correction = (next - seconds) - adjusted;
    seconds = next;
  }
  if (seconds > LIMITS.maxDurationMs / 1000) errors.push(`La duración total no puede superar ${LIMITS.maxDurationMs / 1000} segundos.`);
  const characters = proposal.scenes.reduce((sum, scene) => sum + [...scene.narration].length, 0);
  if (characters > LIMITS.maxTotalText) errors.push(`La narración total no puede superar ${LIMITS.maxTotalText} caracteres.`);
  for (const [index, source] of proposal.sources.entries()) {
    if (!isSourceUrl(source.url)) errors.push(`$.sources[${index}].url: debe ser una URL HTTP(S) absoluta, sin espacios ni credenciales.`);
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, proposal };
}

/** Fence markers and prose stay outside the slice; markers inside strings stay intact. */
function firstObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
    } else if (character === '"') inString = true;
    else if (character === '{') depth += 1;
    else if (character === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return null;
}

function validateContract(value: unknown, schema: ContractNode, path: string, errors: string[]): void {
  const report = (message: string): void => { errors.push(`${path}: ${message}`); };
  switch (schema.type) {
    case 'object': {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) return report('debe ser un objeto.');
      const object = value as Record<string, unknown>;
      const properties = schema.properties!;
      if (Object.keys(object).some(key => !Object.hasOwn(properties, key))) report('contiene campos no permitidos.');
      for (const key of schema.required!) {
        if (!Object.hasOwn(object, key)) errors.push(`${path}.${key}: campo obligatorio.`);
        else validateContract(object[key], properties[key]!, `${path}.${key}`, errors);
      }
      return;
    }
    case 'array':
      if (!Array.isArray(value)) return report('debe ser una lista.');
      if (value.length < (schema.minItems ?? 0) || value.length > schema.maxItems!) {
        return report(`debe contener entre ${schema.minItems ?? 0} y ${schema.maxItems} elementos.`);
      }
      value.forEach((item, index) => validateContract(item, schema.items!, `${path}[${index}]`, errors));
      return;
    case 'string': {
      if (typeof value !== 'string') return report('debe ser texto.');
      const length = [...value].length;
      if (length < schema.minLength! || length > schema.maxLength!) report(`debe contener entre ${schema.minLength} y ${schema.maxLength} caracteres.`);
      if (schema.pattern && !new RegExp(schema.pattern).test(value)) report('el texto no tiene el formato permitido.');
      return;
    }
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) return report('debe ser un número finito.');
      if (value < schema.minimum! || value > schema.maximum!) report(`debe estar entre ${schema.minimum} y ${schema.maximum}.`);
      return;
    default:
      throw new Error('Unsupported script contract type');
  }
}

function isSourceUrl(value: string): boolean {
  if (!/^https?:\/\/[^\s]+$/.test(value)) return false;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && url.hostname !== '' && url.username === '' && url.password === '';
  } catch {
    return false;
  }
}
