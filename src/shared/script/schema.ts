import { LIMITS } from '../schema/limits.ts';
import { FORBIDDEN_TEXT_CONTROL_RANGE } from '../schema/text.ts';
import type { ScriptCover, ScriptSource } from '../schema/types.ts';

export interface ScriptProposal {
  title: string;
  sources: ScriptSource[];
  scenes: { title: string; narration: string; visualIntent: string; seconds: number }[];
  cover: ScriptCover;
  postText: string;
}

const text = (minLength: number, maxLength: number) => ({
  type: 'string', minLength, maxLength, pattern: `^[^${FORBIDDEN_TEXT_CONTROL_RANGE}]*$`,
} as const);

/** Closed output contract; aggregate duration/text checks belong to the parser. */
export const SCRIPT_PROPOSAL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'sources', 'scenes', 'cover', 'postText'],
  properties: {
    title: text(1, 120),
    sources: {
      type: 'array', maxItems: LIMITS.maxScriptSources,
      items: {
        type: 'object', additionalProperties: false, required: ['title', 'url'],
        properties: {
          title: text(1, 120),
          url: { ...text(1, LIMITS.maxSourceUrl), pattern: `^https?://[^\\s${FORBIDDEN_TEXT_CONTROL_RANGE}]+$`, description: 'URL HTTP(S) absoluta, sin credenciales; referencia informativa, no se descarga.' },
        },
      },
    },
    scenes: {
      type: 'array', minItems: 1, maxItems: LIMITS.maxScenes,
      description: `La suma de seconds no puede superar ${LIMITS.maxDurationMs / 1000} s; narración total ≤ ${LIMITS.maxTotalText} caracteres. Estas sumas se validan después de generar el JSON.`,
      items: {
        type: 'object', additionalProperties: false,
        required: ['title', 'narration', 'visualIntent', 'seconds'],
        properties: {
          title: text(1, 120),
          narration: text(1, LIMITS.maxSceneText),
          visualIntent: text(1, 1000),
          seconds: { type: 'number', minimum: LIMITS.minSceneMs / 1000, maximum: LIMITS.maxSceneMs / 1000 },
        },
      },
    },
    cover: {
      type: 'object', additionalProperties: false, required: ['headline'],
      properties: { headline: text(1, 120) },
    },
    postText: text(0, LIMITS.maxPostText),
  },
} as const;
