/** Fit the complete text inside a world-sized label without splitting words or clipping glyphs. */
export function labelLayout(width: number, height: number, text: string) {
  return { width, height, fontSize: Math.min(height * 0.6, width / (Array.from(text).length * 0.7 + 2)) };
}

/** Conservative envelope: no DOM measurements or frame/seek-dependent sizing. */
export function anchoredLabelLayout(x: number, y: number, viewportWidth: number, viewportHeight: number, text: string) {
  const margin = Math.min(32, viewportWidth / 8, viewportHeight / 8);
  const width = Math.min(360, viewportWidth - margin * 2);
  const height = Math.min(160, viewportHeight - margin * 2);
  const paddingX = Math.min(28, width / 8);
  const paddingY = Math.min(15, height / 8);
  const count = Math.max(1, Array.from(text).length);
  // Allow a full wide glyph per code point (plus slack), even for unbroken Unicode.
  let fontSize = Math.min(34, (width - paddingX * 2) / 1.1, (height - paddingY * 2) / 1.2);
  const lines = (size: number) => Math.ceil(count / Math.max(1, Math.floor((width - paddingX * 2) / (size * 1.1))));
  while (lines(fontSize) * fontSize * 1.2 + paddingY * 2 > height) fontSize *= 0.95;
  const textHeight = lines(fontSize) * fontSize * 1.2 + paddingY * 2;
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
  return { left: clamp(x - width / 2, margin, viewportWidth - margin - width),
    top: clamp(y - textHeight * 1.4, margin, viewportHeight - margin - height),
    width, height, fontSize, paddingX, paddingY, margin };
}
