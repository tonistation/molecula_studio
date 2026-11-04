import test from 'node:test';
import assert from 'node:assert/strict';

import { InspectionError, inspectMedia, sniffMimeType } from '../../src/companion/store/media-inspect.ts';
import { LIMITS } from '../../src/shared/schema/limits.ts';
import { jpegBytes, mp3Bytes, pngBytes, wavBytes } from '../helpers/media.ts';

test('sniffMimeType recognizes the four schema formats and nothing else', () => {
  assert.equal(sniffMimeType(wavBytes()), 'audio/wav');
  assert.equal(sniffMimeType(mp3Bytes(2)), 'audio/mpeg');
  assert.equal(sniffMimeType(pngBytes(10, 10)), 'image/png');
  assert.equal(sniffMimeType(jpegBytes(10, 10)), 'image/jpeg');
  assert.equal(sniffMimeType(new TextEncoder().encode('#!/bin/sh\nrm -rf /')), null);
  assert.equal(sniffMimeType(new Uint8Array(0)), null);
});

test('inspectMedia reads real wav duration from headers, not from the manifest', () => {
  const inspection = inspectMedia(wavBytes({ sampleRate: 16_000, channels: 1, durationMs: 1500 }), 'audio/wav');
  assert.equal(inspection.mimeType, 'audio/wav');
  assert.equal(inspection.durationMs, 1500);
  assert.equal(inspection.width, null);
  assert.equal(inspection.height, null);
});

test('inspectMedia sums mp3 Layer III frames to derive duration', () => {
  // 10 frames * 1152 samples / 44100 Hz = 261.22ms
  const inspection = inspectMedia(mp3Bytes(10), 'audio/mpeg');
  assert.equal(inspection.durationMs, 261);

  const longer = inspectMedia(mp3Bytes(200), 'audio/mpeg');
  assert.equal(longer.durationMs, 5224);
});

test('inspectMedia reads png and jpeg dimensions', () => {
  assert.deepEqual(
    inspectMedia(pngBytes(1080, 1920), 'image/png'),
    { mimeType: 'image/png', durationMs: null, width: 1080, height: 1920 },
  );
  assert.deepEqual(
    inspectMedia(jpegBytes(800, 600), 'image/jpeg'),
    { mimeType: 'image/jpeg', durationMs: null, width: 800, height: 600 },
  );
});

test('declared type must match the real container', () => {
  assert.throws(
    () => inspectMedia(pngBytes(10, 10), 'audio/wav'),
    (error: unknown) => error instanceof InspectionError && error.reason === 'mime-mismatch',
  );
  assert.throws(
    () => inspectMedia(new TextEncoder().encode('not media'), 'image/png'),
    (error: unknown) => error instanceof InspectionError && error.reason === 'mime-mismatch',
  );
});

test('corrupt or truncated headers are rejected instead of guessed', () => {
  const truncatedWav = wavBytes().slice(0, 20);
  assert.throws(
    () => inspectMedia(truncatedWav, 'audio/wav'),
    (error: unknown) => error instanceof InspectionError && error.reason === 'unreadable',
  );

  const noFrames = new Uint8Array([0xff, 0xfb, 0x90, 0x00]);
  assert.throws(
    () => inspectMedia(noFrames, 'audio/mpeg'),
    (error: unknown) => error instanceof InspectionError && error.reason === 'unreadable',
  );

  const pngWithoutIhdr = new Uint8Array(24);
  pngWithoutIhdr.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  assert.throws(
    () => inspectMedia(pngWithoutIhdr, 'image/png'),
    (error: unknown) => error instanceof InspectionError && error.reason === 'unreadable',
  );

  const jpegWithoutSof = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  assert.throws(
    () => inspectMedia(jpegWithoutSof, 'image/jpeg'),
    (error: unknown) => error instanceof InspectionError && error.reason === 'unreadable',
  );
});

test('audio limits are enforced from headers before accepting bytes', () => {
  assert.throws(
    () => inspectMedia(wavBytes({ channels: 6 }), 'audio/wav'),
    (error: unknown) => error instanceof InspectionError && error.reason === 'unsupported-audio',
  );
  assert.throws(
    () => inspectMedia(wavBytes({ sampleRate: 96_000 }), 'audio/wav'),
    (error: unknown) => error instanceof InspectionError && error.reason === 'unsupported-audio',
  );
  assert.throws(
    () => inspectMedia(wavBytes({ durationMs: LIMITS.maxAudioDurationMs + 1000 }), 'audio/wav'),
    (error: unknown) => error instanceof InspectionError && error.reason === 'audio-too-long',
  );
});

test('image dimension limits are enforced from headers', () => {
  assert.throws(
    () => inspectMedia(pngBytes(5000, 100), 'image/png'),
    (error: unknown) => error instanceof InspectionError && error.reason === 'image-dimensions',
  );
  assert.throws(
    () => inspectMedia(jpegBytes(4000, 5000), 'image/jpeg'),
    (error: unknown) => error instanceof InspectionError && error.reason === 'image-dimensions',
  );
});

test('oversized files are rejected before parsing', () => {
  const oversized = new Uint8Array(LIMITS.maxAssetBytes + 1);
  assert.throws(
    () => inspectMedia(oversized, 'image/png'),
    (error: unknown) => error instanceof InspectionError && error.reason === 'too-large',
  );
});

test('forged wav rate, partial mp3 tail and image header-only files fail closed', () => {
  const forged = wavBytes();
  new DataView(forged.buffer).setUint32(28, 1_000_000, true);
  assert.throws(() => inspectMedia(forged, 'audio/wav'), InspectionError);
  assert.throws(() => inspectMedia(mp3Bytes(2).slice(0, -1), 'audio/mpeg'), InspectionError);
  assert.throws(() => inspectMedia(pngBytes(10, 10).slice(0, 24), 'image/png'), InspectionError);
  assert.throws(() => inspectMedia(jpegBytes(10, 10).slice(0, 30), 'image/jpeg'), InspectionError);
});

test('decoded image header bounds reject RGBA16 above 100 MiB even below pixel and edge caps', () => {
  const oversized = pngBytes(4000, 4000);
  oversized[24] = 16;
  assert.throws(() => inspectMedia(oversized, 'image/png'),
    (error: unknown) => error instanceof InspectionError && error.reason === 'decoded-too-large');
  const exact = pngBytes(4096, 3200);
  exact[24] = 16;
  assert.equal(inspectMedia(exact, 'image/png').width, 4096);
  const over = pngBytes(4096, 3201);
  over[24] = 16;
  assert.throws(() => inspectMedia(over, 'image/png'), InspectionError);
  const jpeg16 = jpegBytes(4000, 4000);
  jpeg16[24] = 16; // SOF precision
  assert.throws(() => inspectMedia(jpeg16, 'image/jpeg'), InspectionError);
});

test('unknown PNG sample formats fail closed instead of guessing their decoded size', () => {
  for (const [depth, color] of [[32, 6], [16, 3], [8, 7]]) {
    const bytes = pngBytes(10, 10);
    bytes[24] = depth!;
    bytes[25] = color!;
    assert.throws(() => inspectMedia(bytes, 'image/png'), InspectionError);
  }
});
