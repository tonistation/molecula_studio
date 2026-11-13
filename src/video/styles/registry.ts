/** Renderer names keep the registry importable in pure Node tests (no JSX). */
const styles: Readonly<Record<string, { version: number; renderer: 'kit' | 'vector' | 'motion' }>> = {
  'stylized-3d': { version: 1, renderer: 'kit' },
  'vector-2d': { version: 1, renderer: 'vector' },
  'motion-graphics': { version: 1, renderer: 'motion' },
};

export function resolveStyle(styleId: string, version: number) {
  const style = styles[styleId];
  if (!style || style.version !== version) return { ok: false as const, message: `Estilo no implementado: ${styleId} (versión ${version}).` };
  return { ok: true as const, renderer: style.renderer };
}
