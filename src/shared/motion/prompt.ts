import { buildFlatPrompt, type FlatPromptInput } from '../flat/prompt.ts';
export const buildMotionPrompt = (input: FlatPromptInput) => buildFlatPrompt(input, 'motion');
