import { useEffect, useRef, useState } from 'react';

import type { Asset } from '../../../src/shared/schema/types.ts';
import { LIMITS } from '../../../src/shared/schema/limits.ts';
import { ApiError, describeError } from '../api.ts';

interface Props {
  assets: Asset[];
  missingAssets: string[];
  disabled: boolean;
  onRelink: (asset: Asset, bytes: Uint8Array, replace: boolean) => Promise<void>;
}

export function AssetManifest({ assets, missingAssets, disabled, onRelink }: Props) {
  const [replacement, setReplacement] = useState<{ asset: Asset; bytes: Uint8Array } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);

  const submit = async (asset: Asset, bytes: Uint8Array, replace = false) => {
    setError(null);
    try {
      await onRelink(asset, bytes, replace);
      setReplacement(null);
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'conflict' && caught.details.reason === 'asset-content') {
        setReplacement({ asset, bytes });
      } else { setReplacement(null); setError(describeError(caught)); }
    }
  };

  const choose = async (asset: Asset, file: File) => {
    setReading(true);
    setReplacement(null);
    setError(null);
    try {
      if (file.size > LIMITS.maxAssetBytes) throw new Error('El recurso supera el máximo de 50 MiB.');
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (active.current) await submit(asset, bytes);
    } catch (caught) { setError(describeError(caught)); }
    finally { setReading(false); }
  };

  return <section className="panel">
    <h2>Manifest de recursos</h2>
    <p className="muted small">Guarde los cambios antes de revincular. Se inspecciona el contenedor, no se certifica la decodificación ni la vigencia editorial de los medios.</p>
    {error !== null && <p role="alert" className="banner banner-error">{error}</p>}
    {assets.length === 0 && <p className="muted">No hay recursos declarados.</p>}
    <ul className="project-list">{assets.map((asset) => <li key={asset.assetId}>
      <div className="project-meta">
        <strong>{asset.assetId} · {missingAssets.includes(asset.assetId) ? 'Faltante' : 'Archivo presente (sin certificación de decodificación)'}</strong>
        <span className="muted small">{asset.mimeType} · {asset.byteLength} bytes · {asset.durationMs === null ? 'Imagen' : `${asset.durationMs} ms`}</span>
        <span className="muted small">SHA-256: {asset.sha256 ?? 'Pendiente'} · Licencia: {asset.source.license}</span>
        <label className="field"><span>Revincular {asset.assetId}</span>
          <input type="file" accept={asset.mimeType} disabled={disabled || reading || replacement !== null}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = '';
              if (file !== undefined) void choose(asset, file);
            }} />
        </label>
      </div>
    </li>)}</ul>
    {replacement !== null && <div role="status" className="banner banner-warn">
      <p>Contenido distinto para {replacement.asset.assetId}. Sustituir crea un identificador nuevo y conserva los vínculos históricos; requiere revisión editorial.</p>
      <button type="button" disabled={disabled || reading} onClick={() => void submit(replacement.asset, replacement.bytes, true)}>Confirmar sustitución</button>
      <button type="button" disabled={reading} onClick={() => setReplacement(null)}>Cancelar sustitución</button>
    </div>}
  </section>;
}
