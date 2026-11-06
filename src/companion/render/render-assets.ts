import { createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import type { Project } from '../../shared/schema/types.ts';

/** Read-only CLI capability; never opens a writer store or exposes filesystem paths. */
export async function serveRenderAssets(project: Project, projectFile: string) {
  const token = randomBytes(32).toString('hex');
  const directory = dirname(resolve(projectFile));
  const referenced = new Set(project.scenes.flatMap(scene => scene.audio ? [scene.audio.assetId] : []));
  const manifest = new Map(project.assets.filter(asset => referenced.has(asset.assetId)).map(asset => [asset.assetId, asset]));
  let active = true;
  let host = '';
  const server = createServer(async (req, res) => {
    res.setHeader('cache-control', 'no-store');
    res.setHeader('x-content-type-options', 'nosniff');
    if (req.headers.host !== host) { res.writeHead(403).end(); return; }
    if (req.method !== 'GET') { res.writeHead(405, { allow: 'GET' }).end(); return; }
    const match = /^\/render-assets\/([a-f0-9]{64})\/([a-z][a-z0-9_-]{0,63})$/.exec(req.url ?? '');
    const asset = active && match?.[1] === token ? manifest.get(match[2]!) : undefined;
    if (!asset) { res.writeHead(404).end(); return; }
    try {
      const path = join(directory, asset.path);
      // The validated schema restricts paths; reject symlinks at every directory level too.
      if (await realpath(directory) !== directory || await realpath(join(directory, 'assets')) !== join(directory, 'assets')) throw new Error();
      const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      let bytes: Buffer;
      try {
        const info = await handle.stat();
        if (!info.isFile() || info.size !== asset.byteLength || info.size > 50 * 1024 * 1024) throw new Error();
        // Bound allocation and reads even if another writer grows the file concurrently.
        const buffer = Buffer.alloc(info.size + 1);
        let length = 0;
        while (length < buffer.length) {
          const read = await handle.read(buffer, length, buffer.length - length);
          if (!read.bytesRead) break;
          length += read.bytesRead;
        }
        bytes = buffer.subarray(0, length);
      } finally { await handle.close(); }
      if (!active || bytes.length !== asset.byteLength || (asset.sha256 !== null && createHash('sha256').update(bytes).digest('hex') !== asset.sha256)) throw new Error();
      res.writeHead(200, { 'content-type': asset.mimeType, 'content-length': bytes.length, 'access-control-allow-origin': '*' }).end(bytes);
    } catch { res.writeHead(409).end(); }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  host = `127.0.0.1:${(server.address() as { port: number }).port}`;
  return {
    assetUrls: Object.fromEntries([...manifest.keys()].map(id => [id, `http://${host}/render-assets/${token}/${id}`])),
    async close() {
      active = false;
      server.closeIdleConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    },
  };
}
