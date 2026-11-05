import { LIMITS } from '../schema/limits.ts';
import type { ScriptCover, ScriptSource } from '../schema/types.ts';

export interface ScriptProposal {
  title: string;
  sources: ScriptSource[];
  scenes: { title: string; narration: string; visualIntent: string; seconds: number }[];
  cover: ScriptCover;
  postText: string;
}

/** Closed output contract; aggregate duration/text checks belong to the parser. */
export const SCRIPT_PROPOSAL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'sources', 'scenes', 'cover', 'postText'],
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 120 },
    sources: {
      type: 'array', maxItems: LIMITS.maxScriptSources,
      items: {
        type: 'object', additionalProperties: false, required: ['title', 'url'],
        properties: {
          title: { type: 'string', minLength: 1, maxLength: 120 },
          url: { type: 'string', minLength: 1, maxLength: LIMITS.maxSourceUrl, pattern: '^https?://[^\\s]+$', description: 'URL HTTP(S) absoluta, sin credenciales; referencia informativa, no se descarga.' },
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
          title: { type: 'string', minLength: 1, maxLength: 120 },
          narration: { type: 'string', minLength: 1, maxLength: LIMITS.maxSceneText },
          visualIntent: { type: 'string', minLength: 1, maxLength: 1000 },
          seconds: { type: 'number', minimum: LIMITS.minSceneMs / 1000, maximum: LIMITS.maxSceneMs / 1000 },
        },
      },
    },
    cover: {
      type: 'object', additionalProperties: false, required: ['headline'],
      properties: { headline: { type: 'string', minLength: 1, maxLength: 120 } },
    },
    postText: { type: 'string', minLength: 0, maxLength: LIMITS.maxPostText },
  },
} as const;
