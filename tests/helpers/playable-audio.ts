import { wavBytes } from './media.ts';

/** Real PCM16 mono sine wave, generated locally; no voice/provider/third-party rights. */
export function toneWav(durationMs = 2000, frequency = 440): Buffer {
  const bytes = wavBytes({ sampleRate: 16000, durationMs });
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let index = 0; index < (bytes.length - 44) / 2; index++) {
    view.setInt16(44 + index * 2, Math.round(6000 * Math.sin(2 * Math.PI * frequency * index / 16000)), true);
  }
  return Buffer.from(bytes);
}
