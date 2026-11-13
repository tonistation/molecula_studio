import { useCurrentFrame, useVideoConfig } from 'remotion';
import type { VectorVisual } from '../../shared/vector/types.ts';
import type { MotionVisual } from '../../shared/motion/types.ts';
import { CAPTION_FONT } from '../fonts.ts';
import { counterTextAtFrame, layerAt } from './animation.ts';

function textBox(position: [number, number], scale: number, rotation: number, text: string, fontSize: number) {
  const width = Math.min(960, 960 / scale);
  const height = Math.min(1600, 1600 / scale);
  const axis = (point: number, length: number, canvas: number) => point >= 0 && point <= canvas && rotation === 0
    ? Math.max(-point / scale, Math.min(-length / 2, (canvas - point) / scale - length)) : -length / 2;
  const lines = text.split('\n').length;
  const size = Math.min(fontSize, height / (lines * 1.2), Math.sqrt(width * height / (Math.max(1, [...text].length) * 4)));
  return { x: axis(position[0], width, 1080), y: axis(position[1], height, 1920), width, height, size };
}

export function VectorScene({ visual, durationInFrames }: { visual: VectorVisual | MotionVisual; durationInFrames?: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const ms = frame / fps * 1000;
  return <svg viewBox="0 0 1080 1920" preserveAspectRatio="none" style={{ width: '100%', height: '100%', background: visual.background }}>
    {visual.layers.map(layer => {
      const state = layerAt(layer, ms);
      if (!state.visible) return null;
      const transform = `translate(${state.position[0]} ${state.position[1]}) rotate(${layer.rotation}) scale(${state.scale})`;
      // Keep wrapping geometry stable while the layer animates, including off-canvas entrances.
      const box = layer.type === 'text' ? textBox(layer.position, layer.scale, layer.rotation, layer.text, layer.fontSize) : null;
      const counter = layer.type === 'counter' ? counterTextAtFrame(layer, frame, fps, durationInFrames) : null;
      return <g key={layer.id} transform={transform} opacity={state.opacity} fill={layer.fill}>
        {layer.type === 'rect' && <rect x={-layer.width / 2} y={-layer.height / 2} width={layer.width} height={layer.height} />}
        {layer.type === 'ellipse' && <ellipse rx={layer.width / 2} ry={layer.height / 2} />}
        {layer.type === 'polygon' && <polygon points={layer.points.map(point => point.join(',')).join(' ')} />}
        {layer.type === 'text' && box && <foreignObject x={box.x} y={box.y} width={box.width} height={box.height}>
          <div data-vector-text="" style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
            textAlign: 'center', color: layer.fill, fontFamily: CAPTION_FONT, fontWeight: 800, fontSize: box.size, lineHeight: 1.2,
            whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', wordBreak: 'break-word' }}><span>{layer.text}</span></div>
        </foreignObject>}
        {layer.type === 'counter' && counter !== null && <text textAnchor="middle" dominantBaseline="central" fontFamily={CAPTION_FONT} fontWeight={800} fontSize={Math.min(layer.fontSize, 960 / (Math.max(1, counter.length) * 1.5 * Math.max(1, layer.scale)))}>{counter}</text>}
      </g>;
    })}
  </svg>;
}
