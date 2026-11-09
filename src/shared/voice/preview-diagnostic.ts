/** Ephemeral preview-only diagnostics. Never include provider text, URLs or credentials. */
export type PreviewDiagnostic =
  | { reason: 'http-rejection'; status: number }
  | { reason: 'mime-rejection'; mimeType: string }
  | { reason: 'signature-rejection' | 'size-limit' | 'network' | 'timeout' };

const safeMimeTypes = ['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/mp4', 'text/html', 'application/json', 'application/octet-stream'];

export function safePreviewMime(value: string | null): string {
  const normalized = value?.split(';')[0]?.trim().toLowerCase() ?? '';
  return safeMimeTypes.includes(normalized) ? normalized : 'unknown';
}

/** Revalidate API data before interpolating anything into UI feedback. */
export function previewFailureMessage(value: unknown): string {
  const diagnostic = value as Partial<PreviewDiagnostic> | null;
  let detail = 'no se pudo descargar o reproducir el audio';
  if (diagnostic?.reason === 'http-rejection' && 'status' in diagnostic && Number.isInteger(diagnostic.status)
    && diagnostic.status! >= 100 && diagnostic.status! <= 599) detail = `el proveedor respondió HTTP ${diagnostic.status}`;
  if (diagnostic?.reason === 'mime-rejection' && 'mimeType' in diagnostic) {
    const mime = safePreviewMime(typeof diagnostic.mimeType === 'string' ? diagnostic.mimeType : null);
    detail = mime === 'unknown' ? 'formato no compatible' : `formato no compatible (${mime})`;
  }
  if (diagnostic?.reason === 'signature-rejection') detail = 'el contenido no corresponde al formato de audio anunciado';
  if (diagnostic?.reason === 'size-limit') detail = 'el audio supera el límite de 5 MiB';
  if (diagnostic?.reason === 'network') detail = 'falló la conexión al descargar el audio';
  if (diagnostic?.reason === 'timeout') detail = 'se agotó el plazo de descarga';
  return `Muestra no disponible: ${detail}. No se generó audio nuevo. Puede continuar con esta voz o volver a intentar la muestra.`;
}
