import assert from 'node:assert/strict';
import net from 'node:net';
import dns from 'node:dns';
import { syncBuiltinESMExports } from 'node:module';

// Test-child network boundary, not a product sandbox. Reject before DNS/connect.
const allowed = (host: unknown) => host === undefined || host === 'localhost' || host === '127.0.0.1' || host === '::1';
const originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (this: net.Socket, ...args: unknown[]) {
  const normalized = Array.isArray(args[0]) ? args[0] : args;
  const first = normalized[0];
  const host = typeof first === 'object' && first !== null
    ? (first as { host?: string }).host
    : typeof normalized[1] === 'string' ? normalized[1] : undefined;
  if (!allowed(host)) throw new Error('Non-loopback connection blocked by F08');
  return Reflect.apply(originalConnect, this, args);
} as typeof originalConnect;
const originalLookup = dns.lookup;
dns.lookup = ((host: string, ...args: unknown[]) => {
  if (!allowed(host)) throw new Error('Non-loopback DNS blocked by F08');
  return Reflect.apply(originalLookup, dns, [host, ...args]);
}) as typeof originalLookup;
const originalPromiseLookup = dns.promises.lookup;
dns.promises.lookup = (async (host: string, ...args: unknown[]) => {
  if (!allowed(host)) throw new Error('Non-loopback DNS blocked by F08');
  return Reflect.apply(originalPromiseLookup, dns.promises, [host, ...args]);
}) as typeof originalPromiseLookup;
syncBuiltinESMExports();
assert.throws(() => net.connect({ host: '198.51.100.1', port: 443 }), /Non-loopback/);
assert.throws(() => dns.lookup('f08.invalid', () => undefined), /Non-loopback/);
await assert.rejects(dns.promises.lookup('f08.invalid'), /Non-loopback/);
console.error('LOOPBACK_GUARD_VERIFIED');
