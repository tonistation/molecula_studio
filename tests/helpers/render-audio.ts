import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import type { Project } from '../../src/shared/schema/types.ts';
import { toneWav } from './playable-audio.ts';

/** Four source quarters identify source trimming and scene boundaries independently. */
export function voicedFixture(project: Project): Buffer {
  const bytes = toneWav(2000);
  for (let sample = 0; sample < 32000; sample++) {
    const frequency = [220, 440, 660, 880][Math.floor(sample / 8000)]!;
    bytes.writeInt16LE(Math.round(6000 * Math.sin(2 * Math.PI * frequency * sample / 16000)), 44 + sample * 2);
  }
  project.output.durationMs = 2000;
  project.output.voiceMode = 'withVoice';
  project.assets = [{ assetId: 'voice', kind: 'audio', path: 'assets/voice.wav', mimeType: 'audio/wav',
    byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), durationMs: 2000,
    source: { origin: 'fixture', license: 'Locally generated synthetic tone', attribution: '' } }];
  const scene = project.scenes[0]!;
  project.scenes = [0, 1].map(index => ({ ...structuredClone(scene), sceneId: `scene_${index}`, startMs: index * 1000,
    durationMs: 1000, text: index === 0 ? 'Primera escena' : 'Segunda escena', words: [], visual: null,
    audio: { assetId: 'voice', offsetMs: index === 0 ? 500 : 1500, gainDb: index === 0 ? -6 : 0 },
    mediaBindings: { audio: null, words: null } }));
  return bytes;
}

export async function assertRenderedAudio(path: string) {
  const exec = promisify(execFile);
  const { stdout } = await exec(resolve('node_modules/.bin/remotion'), ['ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', path]);
  const data = JSON.parse(stdout);
  const audio = data.streams.find((entry: { codec_type: string }) => entry.codec_type === 'audio');
  const video = data.streams.find((entry: { codec_type: string }) => entry.codec_type === 'video');
  assert.equal(audio?.codec_name, 'aac');
  assert.equal(video.width, 1080); assert.equal(video.height, 1920);
  assert.equal(video.avg_frame_rate, '30/1'); assert.equal(Number(video.nb_frames), 60);
  assert.ok(Math.abs(Number(data.format.duration) - 2) <= 1 / 30);
  const decoded = await exec(resolve('node_modules/.bin/remotion'), ['ffmpeg', '-v', 'error', '-i', path,
    '-vn', '-ac', '1', '-ar', '16000', '-codec:a', 'pcm_s16le', '-f', 'wav', 'pipe:1'], { encoding: 'buffer', maxBuffer: 1024 * 1024 });
  const wav = decoded.stdout;
  let position = 12;
  while (wav.toString('ascii', position, position + 4) !== 'data') {
    assert.ok(position + 8 < wav.length, 'decoded WAV has data chunk');
    const size = wav.readUInt32LE(position + 4);
    position += 8 + size + size % 2;
  }
  const pcm = wav.subarray(position + 8);
  const signal = (start: number, end: number) => {
    let squares = 0; let crossings = 0;
    for (let index = start; index < end; index++) {
      const sample = pcm.readInt16LE(index * 2);
      squares += sample * sample;
      if (index > start && sample >= 0 && pcm.readInt16LE((index - 1) * 2) < 0) crossings++;
    }
    return { rms: Math.sqrt(squares / (end - start)), hz: crossings * 16000 / (end - start) };
  };
  const first = signal(3200, 6400); // output .2-.4s = source .7-.9s, 440Hz
  const second = signal(19200, 22400); // output 1.2-1.4s = source 1.7-1.9s, 880Hz
  assert.ok(Math.abs(first.hz - 440) < 10, JSON.stringify(first));
  assert.ok(Math.abs(second.hz - 880) < 10, JSON.stringify(second));
  assert.ok(first.rms > 1000 && second.rms > 2000, `decoded non-silent samples in both scenes: ${JSON.stringify({ first, second })}`);
  assert.ok(Math.abs(first.rms / second.rms - 10 ** (-6 / 20)) < 0.06, 'gain survives AAC encoding');
  assert.ok(pcm.length / 2 >= 32000 - 16000 / 30, 'audio covers the complete video');
}
