import { buildFlatPrompt, type FlatPromptInput } from '../flat/prompt.ts';
export const buildVectorPrompt = (input: FlatPromptInput) => buildFlatPrompt(input, 'vector');
