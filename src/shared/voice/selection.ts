/** Session-only generation choice; never added to project.json. */
export interface VoiceSelection { provider: string; voiceId: string }
export interface CatalogVoice {
  voiceId: string;
  name: string;
  language?: string;
  accent?: string;
  gender?: string;
  style?: string;
  description?: string;
  previewAvailable?: true;
}
export interface VoiceCatalog {
  provider: string;
  voices: CatalogVoice[];
  hasMore: boolean;
}
