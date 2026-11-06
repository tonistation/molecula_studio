import { useEffect, useId, useState } from 'react';
import type { KitCamera, KitScene } from '../../../src/shared/kit/types.ts';
import type { Vec3 } from '../../../src/shared/schema/types.ts';
import { KIT_LIMITS } from '../../../src/shared/kit/schema.ts';
import { adjustKitScene, type SceneAdjustment } from '../../../src/shared/kit/adjust.ts';
import type { DraftStepProps } from './ScriptStep.tsx';

/** Invalid intermediate text stays editable without entering the project draft. */
function TextSetting({ label, value, change }: { label: string; value: string; change: (value: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return <label className="field"><span>{label}</span><input value={text}
    onChange={event => { setText(event.target.value); change(event.target.value); }} /></label>;
}

function CameraSettings({ kit, apply }: { kit: KitScene; apply: (change: SceneAdjustment) => void }) {
  const [camera, setCamera] = useState(kit.camera);
  const [convert, setConvert] = useState(false);
  const legacy = kit.camera.keyframes !== undefined;
  const moves = { static: 'Fija', 'dolly-in': 'Acercamiento', pan: 'Desplazamiento', orbit: 'Órbita', follow: 'Seguir objeto' };
  const vector = (field: 'from' | 'to', axis: number, value: string) => {
    const next = [...camera[field]] as Vec3;
    next[axis] = value.trim() === '' ? NaN : Number(value);
    setCamera({ ...camera, [field]: next });
  };
  return <fieldset className="manual-fields"><legend>Cámara</legend>
    {legacy && <><p className="muted small">Pista histórica: conserva posiciones, objetivos y FOV. Paleta y rótulos no la cambian.</p>
      <label className="checkbox"><input type="checkbox" checked={convert} onChange={event => setConvert(event.target.checked)} />
        <span>Sustituir pista histórica por movimiento simple (FOV 45°) al aplicar cámara</span></label></>}
    <fieldset className="manual-fields" disabled={legacy && !convert}>
      <label className="field"><span>Movimiento de cámara</span><select aria-label="Movimiento de cámara" value={camera.move}
        onChange={event => setCamera({ ...camera, move: event.target.value as KitCamera['move'] })}>
        {Object.entries(moves).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <label className="field"><span>Objeto de cámara</span><select aria-label="Objeto de cámara" value={camera.targetObjectId ?? ''} onChange={event => {
        const { targetObjectId: _object, target: _target, ...base } = camera;
        setCamera(event.target.value ? { ...base, targetObjectId: event.target.value }
          : { ...base, target: kit.camera.target ?? [0, 0, 0] });
      }}><option value="">Objetivo fijo{kit.camera.target ? ` (${kit.camera.target.join(', ')})` : ' (0, 0, 0)'}</option>
        {kit.objects.map(object => <option key={object.id} value={object.id}>{object.id} · {object.type}</option>)}
      </select></label>
      <p className="muted small">Seguir objeto requiere elegir un objeto. En ese modo las posiciones son distancias al sujeto; en los demás, posiciones absolutas. La cámara fija usa solo el inicio. Se conservan los extremos existentes hasta que los cambies.</p>
      {(['from', 'to'] as const).map(field => <fieldset className="camera-vector" key={field}><legend>{field === 'from' ? 'Inicio de cámara' : 'Final de cámara'}</legend>
        {['X', 'Y', 'Z'].map((axis, index) => <label className="field" key={axis}><span>{axis}</span><input
          aria-label={`${field === 'from' ? 'Inicio' : 'Final'} de cámara ${axis}`} type="number" min={-100} max={100} step="0.1"
          value={Number.isNaN(camera[field][index]) ? '' : camera[field][index]}
          onChange={event => vector(field, index, event.target.value)} /></label>)}
      </fieldset>)}
      {camera.move !== 'static' && camera.from.every((value, index) => value === camera.to[index]) &&
        <p className="muted small">Los extremos coinciden: cambia la posición final para obtener un desplazamiento visible.</p>}
      <button type="button" onClick={() => {
        const next = structuredClone(camera);
        if (convert) delete next.keyframes;
        apply({ type: 'camera', camera: next, convertKeyframes: convert });
      }}>Aplicar cámara</button>
    </fieldset>
  </fieldset>;
}

export function SceneAdjustments({ draft, sceneId, disabled, onEdit }: DraftStepProps & { sceneId: string }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [objectId, setObjectId] = useState('');
  const [labelText, setLabelText] = useState('');
  const id = useId();
  const scene = draft.scenes.find(item => item.sceneId === sceneId);
  if (!scene?.visual || !('kind' in scene.visual) || scene.visual.kind !== 'kit') return null;
  const kit = scene.visual;
  const apply = (change: SceneAdjustment) => {
    try { onEdit(project => adjustKitScene(project, sceneId, change)); setError(null); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'No se pudo aplicar el ajuste. El borrador se conserva.'); }
  };
  const color = (field: Extract<SceneAdjustment, { type: 'color' }>['field'], label: string, value: string) =>
    <TextSetting key={field} label={label} value={value} change={value => apply({ type: 'color', field, value })} />;
  return <section className="scene-adjustments">
    <button type="button" className="ghost" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>Ajustes de escena</button>
    {open && <fieldset id={id} className="manual-fields" disabled={disabled}>
      <legend>Paleta, cámara y rótulos</legend>
      <p className="muted small">Los ajustes válidos actualizan la vista previa sin guardar. La cámara requiere «Aplicar cámara». Guarda el proyecto para conservarlos. Colores: #RRGGBB.</p>
      {error && <p role="alert" className="banner banner-error">{error}</p>}
      <fieldset className="manual-fields"><legend>Paleta</legend>
        {color('background', 'Color de fondo', kit.palette.background)}
        {color('skyTop', 'Cielo superior', kit.sky.top)}
        {color('skyBottom', 'Cielo inferior', kit.sky.bottom)}
        {kit.environment.terrain && color('terrain', 'Color del terreno', kit.environment.terrain.color)}
        {kit.environment.water && color('water', 'Color del agua', kit.environment.water.color)}
      </fieldset>
      <CameraSettings key={JSON.stringify(kit.camera)} kit={kit} apply={apply} />
      <fieldset className="manual-fields"><legend>Rótulos ({kit.labels.length}/{KIT_LIMITS.labels})</legend>
        {kit.labels.map((label, index) => {
          const update = (next: typeof label) => apply({ type: 'labels', labels: kit.labels.map((item, position) => position === index ? next : item) });
          return <fieldset key={`${index}:${label.objectId}`} className="manual-fields"><legend>Rótulo {index + 1}</legend>
            <TextSetting label={`Texto del rótulo ${index + 1}`} value={label.text} change={text => update({ ...label, text })} />
            <label className="field"><span>Objeto del rótulo {index + 1}</span><select aria-label={`Objeto del rótulo ${index + 1}`} value={label.objectId} onChange={event => update({ ...label, objectId: event.target.value })}>
              {kit.objects.map(object => <option key={object.id} value={object.id}>{object.id} · {object.type}</option>)}
            </select></label>
            <TextSetting label={`Fondo del rótulo ${index + 1}`} value={label.color} change={color => update({ ...label, color })} />
            <button type="button" className="ghost" onClick={() => apply({ type: 'labels', labels: kit.labels.filter((_, position) => position !== index) })}>Quitar rótulo {index + 1}</button>
          </fieldset>;
        })}
        <label className="field"><span>Objeto del nuevo rótulo</span><select aria-label="Objeto del nuevo rótulo" value={objectId} onChange={event => setObjectId(event.target.value)}>
          <option value="">Selecciona un objeto</option>{kit.objects.map(object => <option key={object.id} value={object.id}>{object.id} · {object.type}</option>)}
        </select></label>
        <label className="field"><span>Texto del nuevo rótulo</span><input value={labelText} onChange={event => setLabelText(event.target.value)} /></label>
        <button type="button" disabled={kit.labels.length >= KIT_LIMITS.labels || !objectId || !labelText.trim()}
          onClick={() => apply({ type: 'labels', labels: [...kit.labels, { objectId, text: labelText, color: '#172D45' }] })}>Añadir rótulo</button>
        {kit.objects.length === 0 && <p className="muted small">Redibuja la escena con objetos para poder anclar rótulos.</p>}
      </fieldset>
      <p className="muted small">Para reemplazar el dibujo, usa «Redibujar esta escena» a continuación, en modo manual o automático.</p>
    </fieldset>}
  </section>;
}
