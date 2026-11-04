/**
 * Synthetic media builders for tests.
 *
 * They produce the smallest structurally valid files for the header-level
 * inspector (RIFF/WAVE, MPEG-1 Layer III frames, PNG IHDR, JPEG SOF0). They are
 * not playable media and are never used as product fixtures.
 */

export function wavBytes(
  args: { sampleRate?: number; channels?: number; durationMs?: number; bits?: number } = {},
): Uint8Array {
  const sampleRate = args.sampleRate ?? 16_000;
  const channels = args.channels ?? 1;
  const bits = args.bits ?? 16;
  const durationMs = args.durationMs ?? 1000;
  const byteRate = (sampleRate * channels * bits) / 8;
  const dataSize = Math.round((byteRate * durationMs) / 1000);
  const total = 44 + dataSize;
  const bytes = new Uint8Array(total);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index += 1) bytes[offset + index] = text.charCodeAt(index);
  };

  ascii(0, 'RIFF');
  view.setUint32(4, total - 8, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, (channels * bits) / 8, true);
  view.setUint16(34, bits, true);
  ascii(36, 'data');
  view.setUint32(40, dataSize, true);
  return bytes;
}

/** MPEG-1 Layer III stream: 128 kbps, 44.1 kHz, no padding. */
export function mp3Bytes(frames = 10): Uint8Array {
  const frameLength = 417;
  const bytes = new Uint8Array(frameLength * frames);
  for (let frame = 0; frame < frames; frame += 1) {
    const offset = frame * frameLength;
    bytes[offset] = 0xff;
    bytes[offset + 1] = 0xfb;
    bytes[offset + 2] = 0x90;
    bytes[offset + 3] = 0x00;
  }
  return bytes;
}

export function pngBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(58);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13, false);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  bytes[24] = 8;
  bytes[25] = 6;
  view.setUint32(33, 1, false);
  bytes.set([0x49, 0x44, 0x41, 0x54], 37);
  bytes.set([0x49, 0x45, 0x4e, 0x44], 50);
  return bytes;
}

export function jpegBytes(width: number, height: number): Uint8Array {
  const bytes: number[] = [0xff, 0xd8];
  bytes.push(
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
  );
  bytes.push(0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03);
  bytes.push(0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01);
  bytes.push(0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x01, 0xff, 0xd9);
  return new Uint8Array(bytes);
}
