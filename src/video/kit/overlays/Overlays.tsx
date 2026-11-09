import type { CSSProperties } from 'react';
import { AbsoluteFill } from 'remotion';
import type { KitScene } from '../../../shared/kit/types.ts';
import { animateObject, ease, mix, progress } from '../animate.ts';
import { projectPoint } from '../camera.ts';
import type { CameraState } from '../camera.ts';
import { labelLayout, anchoredLabelLayout } from './layout.ts';

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
      const layout = anchoredLabelLayout(point.x, point.y, width, height, label.text);
      return <div key={i} data-anchored-label style={{
        position: 'absolute', left: layout.left, top: layout.top, width: layout.width, height: layout.height,
        display: 'flex', justifyContent: 'center', alignItems: 'flex-start', opacity: state.opacity,
      }}><div style={{
        ...pill, position: 'relative', background: label.color, maxWidth: '100%', width: 'max-content',
        boxSizing: 'border-box', fontSize: layout.fontSize, lineHeight: 1.2,
        padding: `${layout.paddingY}px ${layout.paddingX}px`, whiteSpace: 'normal', overflowWrap: 'anywhere', wordBreak: 'break-all', textAlign: 'center',
      }}>{label.text}</div></div>;
    })}
    {spec.objects.map(object => {
      if (object.type !== 'label') return null;
      const state = animateObject(object, ms);
      const point = projectPoint(state.position, camera, width, height);
      if (!point.visible || state.opacity <= 0) return null;
      const distance = Math.hypot(...state.position.map((v, i) => v - camera.position[i]!));
      const pixelsPerUnit = height / (2 * Math.tan(camera.fov * Math.PI / 360) * Math.max(0.01, distance));
      const labelHeight = object.params.proportions.height * state.scale * pixelsPerUnit;
      const layout = labelLayout(object.params.proportions.width * state.scale * pixelsPerUnit, labelHeight, object.params.text);
      return <div key={object.id} style={{
        ...pill, left: point.x, top: point.y, translate: '-50% -50%', padding: 0,
        background: object.params.color, opacity: state.opacity,
        ...layout, whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', justifyContent: 'center',
        textAlign: 'center', rotate: `${state.rotation[2]}rad`,
      }}>{object.params.text}</div>;
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
