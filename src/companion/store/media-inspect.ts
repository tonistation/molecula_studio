import type { AssetMimeType } from '../../shared/schema/types.ts';
import { LIMITS } from '../../shared/schema/limits.ts';

/**
 * Header-level media inspection for ingested assets.
 *
 * The companion never trusts the manifest: before accepting bytes it checks
 * the real container signature and bounded container metadata (audio duration,
 * image dimensions). This does not certify playable/decodable media. Decoding pixels or
 * resampling audio stays out of M1; a file that cannot be inspected is
 * rejected instead of being accepted with invented metadata.
 *
 * Limits come from the schema (`LIMITS`), not from the uploaded document.
 */
export type InspectionFailure =
  | 'mime-mismatch'
  | 'unreadable'
  | 'unsupported-audio'
  | 'audio-too-long'
  | 'image-dimensions'
  | 'decoded-too-large'
  | 'inspection-timeout'
  | 'inspection-busy'
  | 'too-large';

export interface Inspection {
  mimeType: AssetMimeType;
  /** Required for audio assets, always null for images. */
  durationMs: number | null;
  width: number | null;
  height: number | null;
}

export class InspectionError extends Error {
  readonly reason: InspectionFailure;

  constructor(reason: InspectionFailure, message: string) {
    super(message);
    this.name = 'InspectionError';
    this.reason = reason;
  }
}

const MAX_IMAGE_EDGE_PX = 4096;
const MAX_IMAGE_PIXELS = 16_000_000;
const MAX_AUDIO_CHANNELS = 2;
const MAX_AUDIO_SAMPLE_RATE = 48_000;
export const MAX_DECODED_BYTES = 100 * 1024 * 1024;

function assertDecodedSize(byteLength: number): void {
  if (!Number.isSafeInteger(byteLength) || byteLength > MAX_DECODED_BYTES) {
    throw new InspectionError('decoded-too-large', `decoded media header bound exceeds ${MAX_DECODED_BYTES} bytes`);
  }
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

/**
 * Sniffs the real container from magic bytes. Returns null for anything that
 * is not one of the four schema-1 formats.
 */
export function sniffMimeType(bytes: Uint8Array): AssetMimeType | null {
  if (startsWith(bytes, PNG_SIGNATURE)) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (isWav(bytes)) return 'audio/wav';
  if (isMp3(bytes)) return 'audio/mpeg';
  return null;
}

/**
 * Inspects bytes declared as `declaredMimeType` and returns the trusted
 * metadata. Throws `InspectionError` with a stable reason when the content is
 * not the declared type, cannot be parsed or exceeds the schema limits.
 */
export function inspectMedia(bytes: Uint8Array, declaredMimeType: AssetMimeType): Inspection {
  if (bytes.byteLength === 0) {
    throw new InspectionError('unreadable', 'asset file is empty');
  }
  if (bytes.byteLength > LIMITS.maxAssetBytes) {
    throw new InspectionError('too-large', `asset exceeds ${LIMITS.maxAssetBytes} bytes`);
  }

  const detected = sniffMimeType(bytes);
  if (detected !== declaredMimeType) {
    throw new InspectionError(
      'mime-mismatch',
      detected === null
        ? 'content is not a supported wav, mp3, png or jpeg file'
        : `content is ${detected}, not ${declaredMimeType}`,
    );
  }

  switch (detected) {
    case 'audio/wav': {
      const durationMs = wavDurationMs(bytes);
      return { mimeType: detected, durationMs: boundedDuration(durationMs), width: null, height: null };
    }
    case 'audio/mpeg': {
      const durationMs = mp3DurationMs(bytes);
      return { mimeType: detected, durationMs: boundedDuration(durationMs), width: null, height: null };
    }
    case 'image/png': {
      const size = pngSize(bytes);
      assertImageSize(size);
      return { mimeType: detected, durationMs: null, width: size.width, height: size.height };
    }
    case 'image/jpeg': {
      const size = jpegSize(bytes);
      assertImageSize(size);
      return { mimeType: detected, durationMs: null, width: size.width, height: size.height };
    }
  }
}

function boundedDuration(durationMs: number): number {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new InspectionError('unreadable', 'audio duration could not be determined');
  }
  const rounded = Math.round(durationMs);
  if (rounded > LIMITS.maxAudioDurationMs) {
    throw new InspectionError('audio-too-long', `audio exceeds ${LIMITS.maxAudioDurationMs}ms`);
  }
  return Math.max(1, rounded);
}

function assertImageSize(size: { width: number; height: number }): void {
  if (size.width < 1 || size.height < 1) {
    throw new InspectionError('unreadable', 'image dimensions could not be determined');
  }
  if (size.width > MAX_IMAGE_EDGE_PX || size.height > MAX_IMAGE_EDGE_PX) {
    throw new InspectionError('image-dimensions', `image exceeds ${MAX_IMAGE_EDGE_PX}px on an axis`);
  }
  if (size.width * size.height > MAX_IMAGE_PIXELS) {
    throw new InspectionError('image-dimensions', `image exceeds ${MAX_IMAGE_PIXELS} pixels`);
  }
}

//#region wav

function isWav(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 12 &&
    ascii(bytes, 0, 4) === 'RIFF' &&
    ascii(bytes, 8, 4) === 'WAVE'
  );
}

function wavDurationMs(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(4, true) + 8 !== bytes.length) {
    throw new InspectionError('unreadable', 'wav RIFF size does not match the file');
  }
  let offset = 12;
  let byteRate: number | null = null;
  let channels: number | null = null;
  let sampleRate: number | null = null;
  let format: number | null = null;
  let dataSize: number | null = null;
  let bits = 0;
  let blockAlign = 0;

  while (offset + 8 <= bytes.byteLength) {
    const id = ascii(bytes, offset, 4);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (body + size > bytes.byteLength) {
      throw new InspectionError('unreadable', `wav chunk "${id}" overruns the file`);
    }
    if (id === 'fmt ') {
      if (format !== null) throw new InspectionError('unreadable', 'duplicate wav fmt chunk');
      if (size < 16) throw new InspectionError('unreadable', 'wav fmt chunk is too short');
      format = view.getUint16(body, true);
      channels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      byteRate = view.getUint32(body + 8, true);
      blockAlign = view.getUint16(body + 12, true);
      bits = view.getUint16(body + 14, true);
    } else if (id === 'data') {
      if (dataSize !== null) throw new InspectionError('unreadable', 'duplicate wav data chunk');
      dataSize = size;
    }
    offset = body + size + (size % 2);
  }

  if (format === null || channels === null || sampleRate === null || byteRate === null || dataSize === null) {
    throw new InspectionError('unreadable', 'wav is missing fmt or data chunks');
  }
  if (format !== 1 && format !== 3) {
    throw new InspectionError('unsupported-audio', `wav format ${format} is not PCM or IEEE float`);
  }
  if (channels < 1 || channels > MAX_AUDIO_CHANNELS) {
    throw new InspectionError('unsupported-audio', `wav has ${channels} channels (max ${MAX_AUDIO_CHANNELS})`);
  }
  if (sampleRate < 1 || sampleRate > MAX_AUDIO_SAMPLE_RATE) {
    throw new InspectionError('unsupported-audio', `wav sample rate ${sampleRate}Hz exceeds ${MAX_AUDIO_SAMPLE_RATE}Hz`);
  }
  if (offset !== bytes.length || ![8, 16, 24, 32].includes(bits) || (format === 3 && bits !== 32) ||
      blockAlign !== channels * bits / 8 || byteRate !== sampleRate * blockAlign || dataSize % blockAlign !== 0) {
    throw new InspectionError('unreadable', 'wav sample format, alignment or byte rate is inconsistent');
  }
  // Conservatively allow float64 samples even for narrower source PCM.
  assertDecodedSize((dataSize / blockAlign) * channels * 8);

  return (dataSize / byteRate) * 1000;
}

//#endregion wav

//#region mp3

/** MPEG audio Layer III bitrate tables in kbps (index 1..14). */
const MP3_BITRATES_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0] as const;
const MP3_BITRATES_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0] as const;
const MP3_SAMPLE_RATES: Record<number, readonly number[]> = {
  3: [44100, 48000, 32000], // MPEG 1
  2: [22050, 24000, 16000], // MPEG 2
  0: [11025, 12000, 8000], // MPEG 2.5
};

function isMp3(bytes: Uint8Array): boolean {
  if (bytes.length >= 3 && ascii(bytes, 0, 3) === 'ID3') return true;
  return bytes.length >= 2 && bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0;
}

function mp3DurationMs(bytes: Uint8Array): number {
  let offset = 0;
  if (bytes.length >= 10 && ascii(bytes, 0, 3) === 'ID3') {
    const tagSize =
      ((bytes[6]! & 0x7f) << 21) | ((bytes[7]! & 0x7f) << 14) | ((bytes[8]! & 0x7f) << 7) | (bytes[9]! & 0x7f);
    offset = 10 + tagSize;
  }

  let sampleRate: number | null = null;
  let totalSamples = 0;
  let frames = 0;

  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff || (bytes[offset + 1]! & 0xe0) !== 0xe0) break;
    const header = parseMp3FrameHeader(bytes, offset);
    if (header === null) break;
    // A truncated trailing frame carries no samples: stop instead of guessing.
    if (offset + header.frameLength > bytes.length) break;
    if (sampleRate !== null && sampleRate !== header.sampleRate) {
      throw new InspectionError('unreadable', 'mp3 sample rate changes between frames');
    }
    sampleRate ??= header.sampleRate;
    totalSamples += header.samplesPerFrame;
    frames += 1;
    offset += header.frameLength;
  }

  if (frames === 0 || sampleRate === null) {
    throw new InspectionError('unreadable', 'mp3 has no complete Layer III frames');
  }
  if (offset !== bytes.length) throw new InspectionError('unreadable', 'mp3 contains a truncated frame or unsupported trailing bytes');
  if (sampleRate > MAX_AUDIO_SAMPLE_RATE) {
    throw new InspectionError('unsupported-audio', `mp3 sample rate ${sampleRate}Hz exceeds ${MAX_AUDIO_SAMPLE_RATE}Hz`);
  }
  assertDecodedSize(totalSamples * MAX_AUDIO_CHANNELS * 8);
  return (totalSamples / sampleRate) * 1000;
}

function parseMp3FrameHeader(
  bytes: Uint8Array,
  offset: number,
): { frameLength: number; sampleRate: number; samplesPerFrame: number } | null {
  const b1 = bytes[offset + 1]!;
  const b2 = bytes[offset + 2]!;
  const version = (b1 >> 3) & 0x03;
  const layer = (b1 >> 1) & 0x03;
  const bitrateIndex = (b2 >> 4) & 0x0f;
  const sampleRateIndex = (b2 >> 2) & 0x03;
  const padding = (b2 >> 1) & 0x01;

  // Only Layer III is supported; reserved version/layer values are invalid.
  if (layer !== 0x01 || version === 0x01) return null;
  if (bitrateIndex === 0 || bitrateIndex === 0x0f) return null;
  if (sampleRateIndex === 0x03) return null;

  const sampleRate = MP3_SAMPLE_RATES[version]?.[sampleRateIndex];
  if (sampleRate === undefined) return null;

  const bitrate = (version === 0x03 ? MP3_BITRATES_V1 : MP3_BITRATES_V2)[bitrateIndex];
  if (bitrate === undefined || bitrate === 0) return null;

  const samplesPerFrame = version === 0x03 ? 1152 : 576;
  const frameLength = Math.floor((samplesPerFrame / 8) * ((bitrate * 1000) / sampleRate)) + padding;
  if (frameLength < 4) return null;

  return { frameLength, sampleRate, samplesPerFrame };
}

//#endregion mp3

//#region png

function pngSize(bytes: Uint8Array): { width: number; height: number } {
  if (bytes.length < 33 || ascii(bytes, 12, 4) !== 'IHDR') {
    throw new InspectionError('unreadable', 'png is missing an IHDR header');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(8, false) !== 13) throw new InspectionError('unreadable', 'invalid PNG IHDR size');
  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);
  const depth = bytes[24]!;
  const color = bytes[25]!;
  const depths: Record<number, readonly number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
  if (!depths[color]?.includes(depth) || bytes[26] !== 0 || bytes[27] !== 0 || (bytes[28] !== 0 && bytes[28] !== 1)) {
    throw new InspectionError('unreadable', 'unsupported PNG sample format');
  }
  assertImageSize({ width, height });
  // Bound a normalized RGBA raster without trusting compressed byte length.
  // Palette/grayscale/transparency can expand to RGBA; retain 16-bit depth.
  assertDecodedSize(width * height * (depth === 16 ? 8 : 4));
  let offset = 8;
  let data = false;
  let ended = false;
  while (offset + 12 <= bytes.length) {
    const size = view.getUint32(offset, false);
    const type = ascii(bytes, offset + 4, 4);
    if ((type === 'IHDR' && offset !== 8) || ['acTL', 'fcTL', 'fdAT'].includes(type)) {
      throw new InspectionError('unreadable', 'duplicate or animated PNG image headers are not supported');
    }
    if (offset + size + 12 > bytes.length) throw new InspectionError('unreadable', 'truncated PNG chunk');
    if (type === 'IDAT' && size > 0) data = true;
    offset += size + 12;
    if (type === 'IEND') { ended = size === 0; break; }
  }
  if (!data || !ended || offset !== bytes.length) throw new InspectionError('unreadable', 'PNG is missing complete image data or IEND');
  return { width, height };
}

//#endregion png

//#region jpeg

function jpegSize(bytes: Uint8Array): { width: number; height: number } {
  let offset = 2;
  let size: { width: number; height: number } | null = null;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) {
      throw new InspectionError('unreadable', 'jpeg marker stream is corrupt');
    }
    let marker = bytes[offset + 1]!;
    // Fill bytes (0xFF padding) are legal between segments.
    while (marker === 0xff && offset + 2 < bytes.length) {
      offset += 1;
      marker = bytes[offset + 1]!;
    }
    offset += 2;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (marker === 0xd9) break;
    if (offset + 2 > bytes.length) break;
    const length = (bytes[offset]! << 8) | bytes[offset + 1]!;
    if (length < 2 || offset + length > bytes.length) throw new InspectionError('unreadable', 'jpeg segment length is invalid');
    if (marker === 0xda) {
      if (size !== null && offset + length < bytes.length - 2 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9) return size;
      break;
    }
    const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isStartOfFrame) {
      if (length < 8) break;
      const precision = bytes[offset + 2]!;
      const components = bytes[offset + 7]!;
      if (size !== null || ![8, 12, 16].includes(precision) || components < 1 || components > 4 || length !== 8 + 3 * components) {
        throw new InspectionError('unreadable', 'unsupported JPEG sample format or multiple image frames');
      }
      const height = (bytes[offset + 3]! << 8) | bytes[offset + 4]!;
      const width = (bytes[offset + 5]! << 8) | bytes[offset + 6]!;
      size = { width, height };
      assertImageSize(size);
      assertDecodedSize(width * height * (precision > 8 ? 8 : 4));
    }
    offset += length;
  }
  throw new InspectionError('unreadable', 'jpeg is missing a start-of-frame header');
}

//#endregion jpeg

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((byte, index) => bytes[index] === byte);
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let out = '';
  for (let index = 0; index < length; index += 1) {
    out += String.fromCharCode(bytes[offset + index] ?? 0);
  }
  return out;
}
