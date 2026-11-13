export const SPANISH_ACCENT_PREFIX = '[neutral Latin American Spanish accent] ';

export function speechInput(text: string, provider: string, modelId: string, locale: string): string {
  return locale === 'es' && provider === 'elevenlabs' && modelId === 'eleven_v4' ? SPANISH_ACCENT_PREFIX + text : text;
}
