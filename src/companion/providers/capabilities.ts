import { runCodex, type CodexOptions } from './codex-cli.ts';

export async function capabilities(options: CodexOptions = {}, signal?: AbortSignal): Promise<{ codex: boolean; vibi: boolean }> {
  let codex = false;
  try { await runCodex(['--version'], { ...options, timeoutMs: options.timeoutMs ?? 5000, signal }); codex = true; }
  catch { /* Capability is availability only, not a claim of login or credits. */ }
  return { codex, vibi: Boolean((options.env ?? process.env).VIBI_API_KEY) };
}
