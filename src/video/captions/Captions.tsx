import { useMemo } from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import type { CaptionStyle, Word } from '../../shared/schema/types.ts';
import { estimateWords } from '../../shared/voice/estimate.ts';
import { CAPTION_FONT } from '../fonts.ts';
import { captionFontSize, captionPhrases, phraseAt } from './phrases.ts';

export const Captions = ({ text, words, durationInFrames, style }: {
  text: string; words: readonly Word[]; durationInFrames: number; style: CaptionStyle;
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const pages = useMemo(() => captionPhrases(words.length ? words : estimateWords(text, Math.round(durationInFrames / fps * 1000))),
    [text, words, durationInFrames, fps]);
  const ms = frame / fps * 1000;
  const page = phraseAt(pages, ms);
  if (!style.enabled || !page) return null;
  const safe = style.safeMarginPx;
  const blockHeight = Math.min(height - 2 * safe, height * 0.28);
  const fontSize = captionFontSize(page.words, style.fontSizePx, width - 2 * safe - 24, blockHeight - 24);
  const top = style.anchor === 'upper' ? Math.max(safe, height * 0.17)
    : style.anchor === 'center' ? (height - blockHeight) / 2 : height - safe - blockHeight;
  return <div data-captions={style.anchor} style={{
    position: 'absolute', left: safe, right: safe, top, height: blockHeight,
    display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none',
    fontFamily: CAPTION_FONT, fontSize, fontWeight: 800, lineHeight: 1.35,
    textAlign: 'center', textTransform: 'uppercase',
  }}>
    <div style={{ width: '100%', padding: 12, boxSizing: 'border-box', overflowWrap: 'anywhere' }}>
      {page.words.map((word, index) => {
        const active = ms >= word.startMs && ms < word.endMs;
        return <span key={index}>
          {index > 0 ? ' ' : ''}<span data-caption-word={word.text} data-active={active} style={{
            color: active ? style.highlightColor : style.color,
            opacity: active ? 1 : 0.55,
            textShadow: '0 2px 5px #14202FCC, 0 0 2px #14202F',
            backgroundColor: word.emphasis ? '#172D45CC' : 'transparent',
            border: `2px solid ${word.emphasis ? style.highlightColor : 'transparent'}`,
            borderRadius: 6, padding: '0 0.06em',
            boxDecorationBreak: 'clone', WebkitBoxDecorationBreak: 'clone',
          }}>{word.text}</span>
        </span>;
      })}
    </div>
  </div>;
};
