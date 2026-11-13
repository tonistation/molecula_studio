import { flatOutputSchema } from '../flat/output-schema.ts';
export const vectorOutputSchema = (durationMs: number) => flatOutputSchema('vector', durationMs);
