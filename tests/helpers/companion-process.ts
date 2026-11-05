import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

export const studioDir = fileURLToPath(new URL('../../dist/studio', import.meta.url));
const main = fileURLToPath(new URL('../../src/companion/main.ts', import.meta.url));

export async function freeLoopbackPort(requested = 0): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(requested, '127.0.0.1', () => {
      const address = server.address();
      assert.ok(address && typeof address !== 'string');
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

/** Only instances spawned by this fixture can be stopped; always reap before removing roots. */
export class OwnedChild {
  readonly child: ChildProcess;
  readonly exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  output = '';

  constructor(command: string, args: string[], env: NodeJS.ProcessEnv) {
    this.child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    this.child.stdout!.on('data', (bytes: Buffer) => { this.output += bytes.toString(); });
    this.child.stderr!.on('data', (bytes: Buffer) => { this.output += bytes.toString(); });
    this.exited = new Promise((resolve, reject) => {
      this.child.once('error', reject);
      this.child.once('exit', (code, signal) => resolve({ code, signal }));
    });
    // Avoid an unhandled rejection before readiness observes a spawn error.
    void this.exited.catch(() => undefined);
  }

  async stop(signal: NodeJS.Signals = 'SIGTERM'): Promise<void> {
    if (this.child.exitCode !== null || this.child.signalCode !== null) { await this.exited; return; }
    this.child.kill(signal);
    const timer = setTimeout(() => this.child.kill('SIGKILL'), 3000);
    try { await this.exited; } finally { clearTimeout(timer); }
  }
}

export async function waitReady(child: OwnedChild, probe: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.child.exitCode !== null || child.child.signalCode !== null) {
      throw new Error(`Owned child exited before readiness: ${child.output}`);
    }
    try { if (await probe()) return; } catch { /* bounded startup readiness retry */ }
    await delay(25);
  }
  throw new Error(`Owned child readiness deadline: ${child.output}`);
}

export class CompanionProcess extends OwnedChild {
  readonly origin: string;
  token = '';

  constructor(root: string, port: number, options: { forceUnlock?: boolean; fault?: 'write' | 'pause'; studioDir?: string } = {}) {
    // These persistence tests exercise unavailable provider capability, never the host's Codex installation.
    super(process.execPath, [
      '--import', fileURLToPath(new URL('./loopback-only.ts', import.meta.url)),
      options.fault ? fileURLToPath(new URL('./fault-companion.ts', import.meta.url)) : main,
    ], { ...process.env, PATH: '', MOLECULA_WORKSPACE: root, MOLECULA_PORT: String(port),
      MOLECULA_STUDIO_DIR: options.studioDir ?? studioDir, MOLECULA_FORCE_UNLOCK: options.forceUnlock ? '1' : '0',
      MOLECULA_TEST_FAULT: options.fault ?? '' });
    this.origin = `http://127.0.0.1:${port}`;
  }

  async ready(): Promise<this> {
    await waitReady(this, async () => {
      const response = await fetch(this.origin, { signal: AbortSignal.timeout(500) });
      if (!response.ok) return false;
      const html = await response.text();
      const token = /name="companion-token" content="([^"]+)"/.exec(html)?.[1];
      if (!token) return false;
      this.token = token;
      return true;
    });
    assert.match(this.output, /LOOPBACK_GUARD_VERIFIED/);
    return this;
  }

  request(path: string, method = 'GET', body?: unknown, token = this.token): Promise<Response> {
    return fetch(`${this.origin}${path}`, { method, headers: {
      authorization: `Bearer ${token}`, origin: this.origin, 'content-type': 'application/json',
    }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(5000) });
  }
}

export async function withProcessWorkspace(run: (args: {
  root: string;
  start: (options?: { forceUnlock?: boolean; fault?: 'write' | 'pause'; port?: number; studioDir?: string }) => Promise<CompanionProcess>;
  spawn: (options?: { forceUnlock?: boolean }) => Promise<CompanionProcess>;
}) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'molecula-f08-'));
  const children: CompanionProcess[] = [];
  // Integration tests do not depend on an ignored Vite build. E2Es explicitly
  // select the real studioDir instead of this inert token-injection shell.
  const shell = join(root, '.test-studio');
  await mkdir(shell);
  await writeFile(join(shell, 'index.html'), '<!doctype html><html><head></head><body></body></html>');
  const spawnChild = async (options: { forceUnlock?: boolean; fault?: 'write' | 'pause'; port?: number; studioDir?: string } = {}) => {
    const child = new CompanionProcess(root, await freeLoopbackPort(options.port), { studioDir: shell, ...options });
    children.push(child);
    return child;
  };
  try {
    await run({ root, spawn: spawnChild, start: async (options) => (await spawnChild(options)).ready() });
  } finally {
    await Promise.all(children.map((child) => child.stop()));
    await rm(root, { recursive: true, force: true });
  }
}
