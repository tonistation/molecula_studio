import { wavBytes } from './media.ts';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

/** Real PCM16 mono sine wave, generated locally; no voice/provider/third-party rights. */
export function toneWav(durationMs = 2000, frequency = 440): Buffer {
  const bytes = wavBytes({ sampleRate: 16000, durationMs });
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let index = 0; index < (bytes.length - 44) / 2; index++) {
    view.setInt16(44 + index * 2, Math.round(6000 * Math.sin(2 * Math.PI * frequency * index / 16000)), true);
  }
  return Buffer.from(bytes);
}

/** Encode a real local tone using the already-installed Remotion FFmpeg. */
export async function toneMp3(directory: string): Promise<Buffer> {
  const input = join(directory, 'test-tone.wav');
  const output = join(directory, 'test-tone.mp3');
  await writeFile(input, toneWav());
  await promisify(execFile)(resolve('node_modules/.bin/remotion'), ['ffmpeg', '-y', '-i', input, '-codec:a', 'libmp3lame', '-b:a', '128k', output]);
  return readFile(output);
}
