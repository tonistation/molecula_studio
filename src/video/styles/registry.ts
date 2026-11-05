/** Renderer names keep the registry importable in pure Node tests (no JSX). */
const styles: Readonly<Record<string, { version: number; renderer: 'kit' }>> = {
  'stylized-3d': { version: 1, renderer: 'kit' },
};

export function resolveStyle(styleId: string, version: number) {
  const style = styles[styleId];
  if (!style || style.version !== version) return { ok: false as const, message: `Estilo no implementado: ${styleId} (versión ${version}).` };
  return { ok: true as const, renderer: style.renderer };
}
