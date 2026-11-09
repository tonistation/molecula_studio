import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { useDelayRender } from 'remotion';
import { anchoredLabelLayout } from './layout.ts';
import { measureAnchoredLabel, type MeasuredLabel } from './measure-label.ts';

export function AnchoredLabel({ text, color, opacity, x, y, width, height, pill }: {
  text: string; color: string; opacity: number; x: number; y: number; width: number; height: number; pill: CSSProperties;
}) {
  const element = useRef<HTMLDivElement>(null);
  const pending = useRef<number | null>(null);
  const [fit, setFit] = useState<MeasuredLabel | null>(null);
  const { delayRender, continueRender, cancelRender } = useDelayRender();
  const layout = anchoredLabelLayout(x, y, width, height, fit?.height);
  useLayoutEffect(() => {
    let active = true;
    const handle = delayRender('Ajustar rótulo con las fuentes cargadas');
    pending.current = handle;
    void document.fonts.load('700 34px sans-serif', text).then(() => document.fonts.ready).then(() => {
      if (!active || !element.current) return;
      setFit(measureAnchoredLabel({ text, cssText: element.current.style.cssText, width: layout.width, height: layout.height }));
    }).catch(() => { if (active) cancelRender(new Error('No se pudo ajustar el rótulo con las fuentes cargadas.')); });
    return () => { active = false; continueRender(handle); pending.current = null; };
  }, [text, layout.width, layout.height, delayRender, continueRender, cancelRender]);
  // Release only after React has committed the fitted styles, including during a render.
  useLayoutEffect(() => {
    if (fit && pending.current !== null) { continueRender(pending.current); pending.current = null; }
  }, [fit, continueRender]);
  return <div data-anchored-label data-label-fitted={fit !== null} style={{
    position: 'absolute', left: layout.left, top: layout.top, width: layout.width, height: layout.height, opacity,
  }}><div ref={element} style={{
    ...pill, fontFamily: 'sans-serif', background: color, maxWidth: layout.width, width: 'max-content',
    left: fit ? (layout.width - fit.width) / 2 - fit.minX * fit.scale : 0, top: fit ? -fit.minY * fit.scale : 0,
    boxSizing: 'border-box', fontSize: fit?.fontSize ?? 34, lineHeight: 1.2,
    padding: `${layout.paddingY}px ${layout.paddingX}px`, whiteSpace: 'normal', overflowWrap: 'anywhere', wordBreak: 'break-all', textAlign: 'center',
    transform: `scale(${fit?.scale ?? 1})`, transformOrigin: 'top left',
  }}>{text}</div></div>;
}
