import { resolve } from 'node:path';

import { startCompanionServer } from './server/http.ts';

/**
 * Companion entrypoint.
 *
 * Environment:
 * - `MOLECULA_WORKSPACE`  authorized workspace directory (default `./workspace`)
 * - `MOLECULA_PORT`       loopback port (default 4787)
 * - `MOLECULA_STUDIO_DIR` built studio directory (default `./dist/studio`)
 *
 * The ephemeral session token is never printed, persisted or placed in a URL:
 * the studio page receives it through a meta tag injected by the companion.
 */
const workspaceRoot = resolve(process.env.MOLECULA_WORKSPACE ?? 'workspace');
const studioDir = resolve(process.env.MOLECULA_STUDIO_DIR ?? 'dist/studio');
const port = Number(process.env.MOLECULA_PORT ?? '4787');
if (!Number.isSafeInteger(port) || port < 0 || port > 65535) {
  console.error('MOLECULA_PORT must be a valid TCP port');
  process.exit(1);
}

const handle = await startCompanionServer({
  workspaceRoot,
  studioDir,
  port,
  forceUnlock: process.env.MOLECULA_FORCE_UNLOCK === '1',
});

console.error(`Molecula companion ready at ${handle.origin} (workspace: ${workspaceRoot})`);

let closing = false;
async function shutdown(): Promise<void> {
  if (closing) return;
  closing = true;
  await handle.close();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
