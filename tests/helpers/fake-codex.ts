import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';

/** Real executable in a private PATH; no provider/network or production injection. */
export async function fakeCodex(mode = 'success') {
  const root = await mkdtemp(join(tmpdir(), 'molecula-fake-codex-'));
  const executable = join(root, 'codex');
  const source = await readFile(fileURLToPath(new URL('./fake-codex.mjs', import.meta.url)), 'utf8');
  await writeFile(executable, `#!${process.execPath}\n${source}`);
  await chmod(executable, 0o700);
  const env: NodeJS.ProcessEnv & { FAKE_CODEX_RECORD: string; FAKE_CODEX_CHILD: string } = { ...process.env, PATH: root, FAKE_CODEX_MODE: mode,
    FAKE_CODEX_RECORD: join(root, 'calls.jsonl'), FAKE_CODEX_CHILD: join(root, 'child.pid') };
  return { root, env, cleanup: () => rm(root, { recursive: true, force: true }) };
}
