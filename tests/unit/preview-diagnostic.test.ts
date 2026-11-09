import test from 'node:test';
import assert from 'node:assert/strict';
import { previewFailureMessage, safePreviewMime } from '../../src/shared/voice/preview-diagnostic.ts';

test('preview feedback accepts only stable reasons, numeric HTTP status and allowlisted normalized MIME', () => {
  assert.equal(safePreviewMime(' Text/HTML; charset=UTF-8 '), 'text/html');
  assert.equal(safePreviewMime('private/SECRET'), 'unknown');
  for (const [diagnostic, expected] of [
    [{ reason: 'http-rejection', status: 404 }, /HTTP 404/],
    [{ reason: 'mime-rejection', mimeType: 'TEXT/HTML; charset=utf-8' }, /text\/html/],
    [{ reason: 'mime-rejection', mimeType: 'PRIVATE' }, /formato no compatible\./],
    [{ reason: 'signature-rejection' }, /contenido no corresponde/],
    [{ reason: 'size-limit' }, /5 MiB/], [{ reason: 'network' }, /conexión/], [{ reason: 'timeout' }, /plazo/],
  ] as const) {
    const message = previewFailureMessage(diagnostic);
    assert.match(message, expected); assert.match(message, /No se generó audio nuevo/);
    assert.doesNotMatch(message, /PRIVATE/);
  }
  for (const diagnostic of [null, 'PRIVATE', { reason: 'PRIVATE', body: 'PRIVATE' },
    { reason: 'http-rejection', status: 'https://PRIVATE?key=PRIVATE' }, { reason: 'http-rejection', status: 999 },
    { reason: 'mime-rejection', mimeType: 'https://PRIVATE?key=PRIVATE' }]) {
    assert.doesNotMatch(previewFailureMessage(diagnostic), /PRIVATE|https?:|key=/);
  }
});
