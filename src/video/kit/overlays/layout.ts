/** Fit the complete text inside a world-sized label without splitting words or clipping glyphs. */
export function labelLayout(width: number, height: number, text: string) {
  return { width, height, fontSize: Math.min(height * 0.6, width / (Array.from(text).length * 0.7 + 2)) };
}

/** Clamp the whole envelope; text dimensions come from the loaded browser fonts. */
export function anchoredLabelLayout(x: number, y: number, viewportWidth: number, viewportHeight: number, pillHeight = 160) {
  const margin = Math.min(32, viewportWidth / 8, viewportHeight / 8);
  const width = Math.min(360, viewportWidth - margin * 2);
  const height = Math.min(160, viewportHeight - margin * 2);
  const paddingX = Math.min(28, width / 8);
  const paddingY = Math.min(15, height / 8);
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
  return { left: clamp(x - width / 2, margin, viewportWidth - margin - width),
    top: clamp(y - pillHeight * 1.4, margin, viewportHeight - margin - height),
    width, height, paddingX, paddingY, margin };
}
