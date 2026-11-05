import { ProjectJsonError } from './schema/errors.ts';
import { LIMITS } from './schema/limits.ts';
import { parseBoundedJsonText } from './schema/parse.ts';

export type ResponseJsonResult = { ok: true; value: unknown } | { ok: false; errors: string[] };

/** Shared manual/provider boundary: bound the full response, decode only its first object. */
export function parseResponseObject(text: string): ResponseJsonResult {
  if (text.length > LIMITS.maxJsonBytes || new TextEncoder().encode(text).byteLength > LIMITS.maxJsonBytes) {
    return { ok: false, errors: [`La respuesta supera el límite de ${LIMITS.maxJsonBytes} bytes.`] };
  }
  const objectText = firstObject(text);
  if (objectText === null) return { ok: false, errors: ['No se encontró un objeto JSON completo en la respuesta.'] };
  try {
    return { ok: true, value: parseBoundedJsonText(objectText) };
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
