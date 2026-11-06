/** Session-only generation choice; never added to project.json. */
export interface VoiceSelection { provider: string; voiceId: string }
export interface VoiceCatalog {
  provider: string;
  voices: { voiceId: string; name: string }[];
  hasMore: boolean;
}
