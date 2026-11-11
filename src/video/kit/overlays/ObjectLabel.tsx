import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { useDelayRender } from 'remotion';
import { labelLayout } from './layout.ts';
import { measureAnchoredLabel, type MeasuredLabel } from './measure-label.ts';

export function ObjectLabel({ text, color, opacity, x, y, width, height, rotation, viewportWidth, viewportHeight, pill }: {
  text: string; color: string; opacity: number; x: number; y: number; width: number; height: number;
  rotation: number; viewportWidth: number; viewportHeight: number; pill: CSSProperties;
}) {
  const element = useRef<HTMLSpanElement>(null);
  const pending = useRef<number | null>(null);
  const [fit, setFit] = useState<MeasuredLabel | null>(null);
  const { delayRender, continueRender, cancelRender } = useDelayRender();
  const maxFontSize = labelLayout(width, height, text).fontSize;
  const cos = Math.abs(Math.cos(rotation)); const sin = Math.abs(Math.sin(rotation));
  const boxWidth = width * cos + height * sin; const boxHeight = height * cos + width * sin;
  const margin = Math.min(32, viewportWidth / 8, viewportHeight / 8);
  const scale = Math.min(1, (viewportWidth - margin * 2) / boxWidth, (viewportHeight - margin * 2) / boxHeight);
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
  const centerX = clamp(x, margin + boxWidth * scale / 2, viewportWidth - margin - boxWidth * scale / 2);
  const centerY = clamp(y, margin + boxHeight * scale / 2, viewportHeight - margin - boxHeight * scale / 2);
  useLayoutEffect(() => {
    let active = true;
    const handle = delayRender('Ajustar texto del objeto'); pending.current = handle;
    void document.fonts.load('700 34px sans-serif', text).then(() => document.fonts.ready).then(() => {
      if (!active || !element.current) return;
      setFit(measureAnchoredLabel({ text, cssText: element.current.style.cssText, width, height, maxFontSize }));
    }).catch(() => { if (active) cancelRender(new Error('No se pudo ajustar el texto del objeto.')); });
    return () => { active = false; continueRender(handle); pending.current = null; };
  }, [text, width, height, maxFontSize, delayRender, continueRender, cancelRender]);
  useLayoutEffect(() => {
    if (fit && pending.current !== null) { continueRender(pending.current); pending.current = null; }
  }, [fit, continueRender]);
  return <div data-object-label data-label-fitted={fit !== null} style={{ ...pill, left: centerX, top: centerY,
    width, height, translate: '-50% -50%', rotate: `${rotation}rad`, scale, padding: 0,
    background: color, opacity, whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center',
  }}><span ref={element} style={{ position: 'absolute', display: 'block', width: 'max-content', maxWidth: width, whiteSpace: 'nowrap', textAlign: 'left',
    left: fit ? (width - fit.width) / 2 - fit.minX * fit.scale : 0,
    top: fit ? (height - fit.height) / 2 - fit.minY * fit.scale : 0,
    fontFamily: 'sans-serif', fontWeight: 700, fontSize: fit?.fontSize ?? maxFontSize,
    transform: `scale(${fit?.scale ?? 1})`, transformOrigin: 'top left',
  }}>{text}</span></div>;
}
