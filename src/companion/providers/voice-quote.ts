import { createHash, timingSafeEqual } from 'node:crypto';
import { SPANISH_ACCENT_PREFIX } from '../../shared/voice/speech-input.ts';
import { speechPayload } from './speech-payload.ts';

export interface QuoteInput { provider: string; modelId: string; voiceId: string; text: string; scope: string }

export function voiceQuote(input: QuoteInput, payload = speechPayload(input)) {
  const sent = payload.text;
  const directive = sent !== input.text && sent.startsWith(SPANISH_ACCENT_PREFIX) ? 'neutral-latin-american-spanish-v1' : 'none';
  const descriptor = { provider: input.provider, modelId: input.modelId, voiceId: input.voiceId, characters: [...sent].length, directive };
  const fingerprint = createHash('sha256').update(JSON.stringify({ scope: input.scope, voiceId: input.voiceId, payload })).digest('hex');
  return { ...descriptor, fingerprint };
}

export function matchesVoiceQuote(fingerprint: unknown, input: QuoteInput, payload = speechPayload(input)): boolean {
  if (typeof fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(fingerprint)) return false;
  return timingSafeEqual(Buffer.from(fingerprint, 'hex'), Buffer.from(voiceQuote(input, payload).fingerprint, 'hex'));
}
