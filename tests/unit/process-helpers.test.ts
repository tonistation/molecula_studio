import test from 'node:test';
import assert from 'node:assert/strict';
import { OwnedChild } from '../helpers/companion-process.ts';
import { closeOwnedBrowser } from '../helpers/process-browser.ts';

test('F08 guard rejects callback and promise DNS before recording stubs can resolve external hosts', { timeout: 10_000 }, async () => {
  const guard = new URL('../helpers/loopback-only.ts', import.meta.url).href;
  // Stubs are installed BEFORE guard import, so a regression never performs
  // DNS or connects externally. Loopback forwarding proves they remain usable.
  const child = new OwnedChild(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import dns from 'node:dns';
    import { lookup } from 'node:dns/promises';
    const calls = [];
    dns.lookup = (host, callback) => {
      calls.push(['callback', host]); callback(null, '127.0.0.1', 4);
    };
    dns.promises.lookup = async (host) => {
      calls.push(['promise', host]); return { address: '127.0.0.1', family: 4 };
    };
    await import(${JSON.stringify(guard)});
    assert.throws(() => dns.lookup('f08.invalid', () => {}), /Non-loopback DNS/);
    await assert.rejects(dns.promises.lookup('f08.invalid'), /Non-loopback DNS/);
    await assert.rejects(lookup('f08.invalid'), /Non-loopback DNS/);
    assert.deepEqual(calls, [], 'external lookups must never reach the recording stubs');
    dns.lookup('127.0.0.1', () => {});
    await dns.promises.lookup('::1');
    await lookup('localhost');
    assert.deepEqual(calls, [['callback', '127.0.0.1'], ['promise', '::1'], ['promise', 'localhost']]);
  `], process.env);
  try { assert.equal((await child.exited).code, 0, child.output); }
  finally { await child.stop(); }
});

test('F08 rejected browser close still stops and reaps its owned child', { timeout: 10_000 }, async () => {
  const child = new OwnedChild(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], process.env);
  const failure = new Error('injected browser close rejection');
  let stopped = false;
  try {
    await assert.rejects(closeOwnedBrowser({ close: async () => { throw failure; } }, {
      stop: async () => { await child.stop(); stopped = true; },
    }), (error) => error === failure);
    assert.equal(stopped, true, 'child cleanup completes even when browser.close rejects');
    assert.ok(child.child.exitCode !== null || child.child.signalCode !== null);
    await child.exited;
  } finally { await child.stop(); }
});
