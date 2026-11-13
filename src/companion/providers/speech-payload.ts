import { speechInput } from '../../shared/voice/speech-input.ts';

export interface SpeechConfig { text: string; provider: string; modelId: string; voiceId: string }

/** Canonical paid request body, shared by quoting, cache identity and submission. */
export function speechPayload(config: SpeechConfig) {
  const language_code = config.provider === 'minimax' ? 'Spanish' : 'es';
  return {
    text: speechInput(config.text, config.provider, config.modelId, language_code),
    language_code,
    provider: config.provider,
    model_id: config.modelId,
    voice_settings: config.provider === 'elevenlabs' ? { stability: 0.5, similarity_boost: 0.75, speed: 1 } : { speed: 1, pitch: 0 },
  };
}
