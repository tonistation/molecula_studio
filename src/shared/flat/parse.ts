import { parseResponseObject } from '../response-json.ts';
import { validateVisual } from '../vector/validate.ts';

export function parseFlatResponse(text: string, durationMs: number, kind: 'vector' | 'motion') {
  const decoded = parseResponseObject(text);
  if (!decoded.ok) return decoded;
  const result = validateVisual(decoded.value, durationMs, kind);
  if (!result.ok) return { ok: false as const, errors: ['El dibujo contiene campos, valores o tiempos no válidos para el estilo y la duración de la escena.'] };
  if (!result.visual.layers.length) return { ok: false as const, errors: ['El dibujo debe contener al menos una capa.'] };
  if (result.visual.layers.some(layer => layer.type === 'text' && /(?:https?:\/\/|www\.|<[^>]*>|```|javascript:)/i.test(layer.text))) {
    return { ok: false as const, errors: ['El dibujo no puede incluir URLs, marcado ni código.'] };
  }
  return { ok: true as const, visual: result.visual };
}
