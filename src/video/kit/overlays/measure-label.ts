export interface MeasuredLabel {
  fontSize: number;
  width: number;
  height: number;
  minX: number;
  minY: number;
  scale: number;
}

/** Called after fonts load. Isolated from Player transforms; never estimates glyph widths. */
export function measureAnchoredLabel({ text, cssText, width, height, maxFontSize = 34 }: {
  text: string; cssText: string; width: number; height: number; maxFontSize?: number;
}): MeasuredLabel {
  const probe = document.createElement('div');
  probe.dataset.labelMeasure = '';
  probe.style.cssText = cssText;
  Object.assign(probe.style, { position: 'fixed', left: '0', top: '0', visibility: 'hidden',
    transform: 'none', maxWidth: `${width}px` });
  probe.textContent = text;
  document.body.append(probe);
  try {
    const measure = (fontSize: number) => {
      probe.style.fontSize = `${fontSize}px`;
      const box = probe.getBoundingClientRect();
      const range = document.createRange(); range.selectNodeContents(probe);
      const lines = Array.from(range.getClientRects());
      const minX = Math.min(0, ...lines.map(line => line.left - box.left));
      const minY = Math.min(0, ...lines.map(line => line.top - box.top));
      // Include fallback-font text extents, not just the CSS line box. Round outward.
      const measuredWidth = Math.ceil((Math.max(box.width, ...lines.map(line => line.right - box.left)) - minX) * 64) / 64;
      const measuredHeight = Math.ceil((Math.max(box.height, ...lines.map(line => line.bottom - box.top)) - minY) * 64) / 64;
      if (!(measuredWidth > 0 && measuredHeight > 0)) throw new Error('No se pudo medir el rótulo.');
      return { fontSize, width: measuredWidth, height: measuredHeight, minX, minY };
    };
    const fits = (box: ReturnType<typeof measure>) => box.width <= width && box.height <= height;
    let result = measure(Math.max(1, maxFontSize));
    if (!fits(result)) {
      let low = 1; let high = Math.max(1, maxFontSize);
      result = measure(low);
      if (fits(result)) {
        for (let i = 0; i < 18; i++) {
          const candidate = measure((low + high) / 2);
          if (fits(candidate)) { low = candidate.fontSize; result = candidate; }
          else high = candidate.fontSize;
        }
      }
    }
    // A browser minimum font size or tiny viewport must not defeat the measured bounds.
    const scale = Math.min(1, maxFontSize / result.fontSize, width / result.width, height / result.height);
    return { ...result, scale, width: result.width * scale, height: result.height * scale };
  } finally { probe.remove(); }
}
