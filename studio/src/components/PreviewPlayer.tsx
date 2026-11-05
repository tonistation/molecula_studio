import { Player, type PlayerRef } from '@remotion/player';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Project } from '../../../src/shared/schema/types.ts';
import { VerticalVideo } from '../../../src/video/VerticalVideo.tsx';
import { draftVideoProps } from '../preview-model.ts';
import { loadPreviewAssets } from '../preview-assets.ts';

export function PreviewPlayer({ draft, seek, missingAssets }: {
  draft: Project;
  seek: { sceneId: string; sequence: number } | null;
  missingAssets: string[];
}) {
  const player = useRef<PlayerRef>(null);
  const [assets, setAssets] = useState<{ key: string; urls: Record<string, string>; failed: string[] } | null>(null);
  const assetIds = [...new Set(draft.scenes.flatMap(scene => scene.audio ? [scene.audio.assetId] : []))]
    .filter(id => !missingAssets.includes(id) && draft.assets.some(asset => asset.assetId === id));
  // Text edits do not refetch media. A changed saved revision/manifest does.
  const assetKey = JSON.stringify([draft.projectId, draft.revision, draft.assets, assetIds, missingAssets]);
  useEffect(() => {
    return loadPreviewAssets(draft.projectId, assetIds, (urls, failed) => setAssets({ key: assetKey, urls, failed }));
  }, [assetKey]);
  const currentAssets = assets?.key === assetKey ? assets : null;
  const prepared = useMemo(() => {
    try { return { props: draftVideoProps(draft, currentAssets?.urls ?? {}), error: null }; }
    catch { return { props: null, error: 'No se puede mostrar este borrador. Revise el estilo y el texto de las escenas.' }; }
  }, [draft, currentAssets]);
  const props = prepared.props;
  const seekFrame = props?.scenes.find(scene => scene.sceneId === seek?.sceneId)?.fromFrame;
  useEffect(() => {
    if (seekFrame !== undefined) {
      player.current?.seekTo(seekFrame);
    } else if (props && player.current && player.current.getCurrentFrame() >= props.durationInFrames) {
      player.current.seekTo(Math.max(0, props.durationInFrames - 1));
    }
  }, [seek, seekFrame, props?.durationInFrames]);

  return <section className="panel preview-panel" aria-label="Vista previa del borrador">
    <h2>Vista previa</h2>
    <p className="muted small">Borrador en vivo · 9:16 · {draft.output.voiceMode === 'silent' ? 'sin voz' : 'con voz · tiempos estimados para audio manual'}</p>
    {prepared.error ? <p role="status">{prepared.error}</p> : !props || props.durationInFrames === 0 ?
      <p className="muted">Añada una escena para ver la vista previa.</p> :
      <Player ref={player} className="preview-transport" component={VerticalVideo} inputProps={props}
        durationInFrames={props.durationInFrames} fps={props.fps}
        compositionWidth={props.width} compositionHeight={props.height}
        style={{ width: '100%', aspectRatio: '9 / 16' }}
        controls alwaysShowControls showVolumeControls={false} numberOfSharedAudioTags={2}
        errorFallback={() => <p role="status" style={{ fontSize: 54, padding: 80, background: '#FFF0E8', color: '#772211' }}>
          No se pudo mostrar la escena. Vuelva a abrir el proyecto para reintentar.
        </p>}
      />}
    {currentAssets && currentAssets.failed.length > 0 && <p role="status" className="muted small">
      No se pudieron cargar recursos: {currentAssets.failed.join(', ')}. Revise el manifest.
    </p>}
  </section>;
}
