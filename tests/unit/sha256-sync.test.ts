import test from 'node:test';
import assert from 'node:assert/strict';
import { sha256Sync } from '../../src/shared/models/sha256-sync.ts';
import { sha256Hex } from '../../src/shared/digests.ts';

test('SHA-256 standard vectors and UTF-8 agree with WebCrypto across block boundaries', async () => {
  assert.equal(sha256Sync(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(sha256Sync('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(sha256Sync('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'), '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  for (const text of ['á🍃日本語\ud800', ...[55,56,63,64,65,127,128,1000].map(n => 'x'.repeat(n)), 'a'.repeat(1_000_000)]) {
    assert.equal(sha256Sync(text), await sha256Hex(text));
  }
});
