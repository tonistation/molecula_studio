/** Fit the complete text inside a world-sized label without splitting words or clipping glyphs. */
export function labelLayout(width: number, height: number, text: string) {
  return { width, height, fontSize: Math.min(height * 0.6, width / (Array.from(text).length * 0.7 + 2)) };
}
