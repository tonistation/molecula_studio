import type { CSSProperties } from 'react';
import { AbsoluteFill } from 'remotion';
import type { KitScene } from '../../../shared/kit/types.ts';
import { animateObject, ease, mix, progress } from '../animate.ts';
import { projectPoint } from '../camera.ts';
import type { CameraState } from '../camera.ts';
import { AnchoredLabel } from './AnchoredLabel.tsx';
import { ObjectLabel } from './ObjectLabel.tsx';

const pill: CSSProperties = {
  position: 'absolute', borderRadius: 40, padding: '15px 28px', background: '#172D45',
  color: '#FFFFFF', fontSize: 34, fontWeight: 700, whiteSpace: 'nowrap', boxShadow: '0 5px 0 #10203230',
};

export function Overlays({ spec, ms, camera, width, height }: { spec: KitScene; ms: number; camera: CameraState; width: number; height: number }) {
  const labels = spec.labels;
  return <AbsoluteFill style={{ pointerEvents: 'none', fontFamily: 'sans-serif' }}>
    {labels.map((label, i) => {
      const object = spec.objects.find(o => o.id === label.objectId)!;
      const state = animateObject(object, ms);
      const point = projectPoint(state.position, camera, width, height);
      if (!point.visible || state.opacity <= 0) return null;
      return <AnchoredLabel key={JSON.stringify([i, label.text, width, height])} pill={pill}
        text={label.text} color={label.color} opacity={state.opacity} x={point.x} y={point.y} width={width} height={height} />;
    })}
    {spec.objects.map(object => {
      if (object.type !== 'label') return null;
      const state = animateObject(object, ms);
      if (!Number.isFinite(state.scale) || state.scale <= 0) return null;
      const point = projectPoint(state.position, camera, width, height);
      if (!point.visible || state.opacity <= 0) return null;
      const distance = Math.hypot(...state.position.map((v, i) => v - camera.position[i]!));
      const pixelsPerUnit = height / (2 * Math.tan(camera.fov * Math.PI / 360) * Math.max(0.01, distance));
      const labelWidth = object.params.proportions.width * state.scale * pixelsPerUnit;
      const labelHeight = object.params.proportions.height * state.scale * pixelsPerUnit;
      if (!Number.isFinite(labelWidth) || !Number.isFinite(labelHeight) || labelWidth <= 0 || labelHeight <= 0) return null;
      return <ObjectLabel key={JSON.stringify([object.id, object.params.text, labelWidth, labelHeight])} pill={pill} text={object.params.text} color={object.params.color} opacity={state.opacity}
        x={point.x} y={point.y} width={labelWidth}
        height={labelHeight} rotation={state.rotation[2]}
        viewportWidth={width} viewportHeight={height} />;
    })}
    {spec.overlays.map((overlay, i) => {
      if (overlay.type === 'counter') {
        const t = ease(progress(ms, overlay.startMs, overlay.endMs), 'linear');
        return <div key={i} style={{ ...pill, top: 130 + i * 100, right: 80, background: overlay.color }}>
          {Math.ceil(mix(overlay.from, overlay.to, t))} s
        </div>;
      }
      const rotation = { right: 0, down: 90, left: 180, up: 270 }[overlay.direction];
      return <div key={i} style={{
        position: 'absolute', left: 90, bottom: 180 + i * 90, fontSize: 74, fontWeight: 900,
        color: overlay.color, opacity: 0.5 + Math.sin(ms / 200) * 0.3,
        rotate: `${rotation}deg`, translate: `${Math.sin(ms / 300) * 10}px 0`,
      }}>{'›'.repeat(overlay.count)}</div>;
    })}
  </AbsoluteFill>;
}
