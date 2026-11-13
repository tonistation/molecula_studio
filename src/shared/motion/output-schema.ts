import { flatOutputSchema } from '../flat/output-schema.ts';
export const motionOutputSchema = (durationMs: number) => flatOutputSchema('motion', durationMs);
