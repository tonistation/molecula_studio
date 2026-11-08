import type { CatalogVoice } from '../../shared/voice/selection.ts';

const labels: Record<string, string> = {
  es: 'Español', spanish: 'Español', en: 'Inglés', english: 'Inglés', pt: 'Portugués', portuguese: 'Portugués',
  vi: 'Vietnamita', zh: 'Chino', id: 'Indonesio', ja: 'Japonés', th: 'Tailandés',
  male: 'Masculina', female: 'Femenina', 'gender diversity': 'Diversa',
  american: 'Estadounidense', british: 'Británico', mexican: 'Mexicano', australian: 'Australiano',
  warm: 'Cálida', confident: 'Segura', expressive: 'Expresiva', steady: 'Estable', deep: 'Grave',
  'gentle / kind': 'Suave / amable', cute: 'Dulce', mysterious: 'Misteriosa', magnetic: 'Magnética',
};

function text(value: unknown, limit = 120): string | undefined {
  if (typeof value !== 'string' || !value.trim() || [...value].length > limit
    || /[\p{Cc}\p{Cf}<>]|https?:|www\./iu.test(value)) return undefined;
  return value.trim();
}

function label(value: unknown): string | undefined {
  const clean = text(value);
  if (!clean) return undefined;
  const key = clean.toLowerCase();
  return Object.hasOwn(labels, key) ? labels[key] : clean;
}

/** Only fields documented by the public Vibi catalog examples; never derive geography from a name. */
export function voiceDetails(provider: string, row: Record<string, unknown>): Partial<CatalogVoice> {
  const result: Partial<CatalogVoice> = {};
  const put = (key: 'language' | 'accent' | 'gender' | 'style' | 'description', value: unknown) => {
    const clean = key === 'description' ? text(value, 500) : label(value);
    if (clean) result[key] = clean;
  };
  if (provider === 'elevenlabs' || provider === 'capcut') {
    put('language', row.language); put('gender', row.gender);
  }
  if (provider === 'elevenlabs') {
    put('accent', row.accent); put('style', row.descriptive); put('description', row.description);
    const verified = Array.isArray(row.verified_languages) && row.verified_languages.length <= 50
      ? row.verified_languages.find(item => item && typeof item === 'object' && item.language_id === 'es') : undefined;
    if (verified) {
      // Prefer an explicitly verified Spanish variant, never an accent inferred from the name or locale.
      result.language = 'Español'; delete result.accent; put('accent', verified.accent);
    }
  }
  if (provider === 'minimax') {
    const tags = Array.isArray(row.tag_list) && row.tag_list.length <= 20 ? row.tag_list.filter(tag => text(tag)) as string[] : [];
    put('language', tags.find(tag => /^(Spanish|English|Portuguese|Japanese|Chinese \(Mandarin\))$/i.test(tag)));
    put('gender', tags.find(tag => /^(male|female)$/i.test(tag)));
    put('accent', tags.find(tag => /^(ES|EN|PT)-[a-zA-Z ()-]{1,60}$/.test(tag)));
    put('description', row.description);
  }
  if (provider === 'capcut' && Array.isArray(row.tags) && row.tags.length <= 20) {
    // CapCut's "accent" filters describe tone, not a geographic accent.
    put('style', row.tags.find(tag => typeof tag === 'string' && /^(steady|deep|gentle \/ kind|cute|mysterious|magnetic)$/i.test(tag)));
  }
  return result;
}

/** No arbitrary Google buckets, redirects, signed queries, credentials or user-supplied origins. */
export function publicPreviewUrl(provider: string, voiceId: string, raw: unknown, base = 'https://api.vibi.pro'): string | undefined {
  if (typeof raw !== 'string' || raw.length > 1024 || /[%\\\s]/u.test(raw)) return undefined;
  let url: URL;
  try { url = new URL(raw); } catch { return undefined; }
  if (url.username || url.password || url.search || url.hash) return undefined;
  if (provider === 'capcut' && url.origin === base && url.pathname === `/v1/capcut/voices/${voiceId}/preview`) return url.href;
  if (url.protocol !== 'https:' || url.port) return undefined;
  if (provider === 'elevenlabs' && url.hostname === 'storage.googleapis.com'
    && /^\/eleven-public-prod\/(?:audio\/[a-zA-Z0-9_-]{1,128}|premade\/voices\/[a-zA-Z0-9_-]{1,128}\/[a-zA-Z0-9_-]{1,128})\.mp3$/.test(url.pathname)) return url.href;
  if (provider === 'minimax' && url.hostname === 'cdn.hailuoai.video'
    && /^\/moss\/voice_sample\/[a-zA-Z0-9_-]{1,128}\.mp3$/.test(url.pathname)) return url.href;
  return undefined;
}
