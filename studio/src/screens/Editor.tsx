import { useEffect, useRef, useState } from 'react';

import type { Asset, Project, ProjectMode, Scene } from '../../../src/shared/schema/types.ts';
import { serializeProject } from '../../../src/shared/schema/serialize.ts';
import { AssetManifest } from './AssetManifest.tsx';
import { PreviewPlayer } from '../components/PreviewPlayer.tsx';
import { ExportPanel } from '../components/ExportPanel.tsx';
import { ScriptStep } from '../components/ScriptStep.tsx';
import { DrawingStep } from '../components/DrawingStep.tsx';
import { VoiceStep } from '../components/VoiceStep.tsx';
import { useCodexCapability } from '../components/GenerationMode.tsx';
import { ApiError, api, describeError, type ReadResult, type SaveResult } from '../api.ts';
import {
  createScene,
  downloadJson,
  downloadSnapshot,
  parseSceneSeconds,
  sceneHasContent,
  sceneSeconds,
  snapshotTimestamp,
  titleOrFallback,
  withScenes,
} from '../model.ts';

interface EditorProps {
  opened: ReadResult;
  importNotice?: string | undefined;
  onBack: () => void;
  onOpenProject: (projectId: string, importNotice?: string) => Promise<void>;
}

/**
 * P2/P3 · Idea, estilo y guion mínimo.
 *
 * Saving is explicit. «Guardado» appears only after the companion confirms the
 * persisted revision; edits made while saving keep the draft dirty.
 */
export function Editor({ opened, importNotice, onBack, onOpenProject }: EditorProps) {
  const codexCapability = useCodexCapability();
  const [draft, setDraft] = useState<Project>(opened.project);
  const [previewSeek, setPreviewSeek] = useState<{ sceneId: string; sequence: number } | null>(null);
  const [mode, setMode] = useState<ProjectMode>(opened.mode);
  const [readOnlyRaw, setReadOnlyRaw] = useState(opened.raw);
  const [confirmedRevision, setConfirmedRevision] = useState(opened.revision);
  const [digest, setDigest] = useState(opened.digest);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copyNotice, setCopyNotice] = useState<string | null>(null);
  const [transition, setTransition] = useState<'back' | 'reload' | 'copy' | null>(null);
  const [needsVerification, setNeedsVerification] = useState(false);
  const operationLock = useRef(false);
  const pendingSave = useRef<{
    project: Project; expectedRevision: number; expectedDigest: string; operationId: string; sequence: number;
    ambiguous?: boolean; result?: SaveResult;
  } | null>(null);
  const pendingCopy = useRef<{ id: string; text: string; operationId: string } | null>(null);
  const [missingAssets, setMissingAssets] = useState(opened.missingAssets);
  const [relinking, setRelinking] = useState(false);
  const relinkLock = useRef(false);
  const live = useRef({ draft, dirty, saving, confirmedRevision, digest });
  useEffect(() => { live.current = { draft, dirty, saving, confirmedRevision, digest }; });
  const editSequence = useRef(0);
  const readOnly = mode === 'read-only';

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!live.current.dirty && !operationLock.current && !relinkLock.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  const edit = (mutate: (project: Project) => Project) => {
    if (readOnly || relinkLock.current) return;
    const next = mutate(structuredClone(live.current.draft));
    live.current.draft = next;
    setDraft(next);
    editSequence.current += 1;
    live.current.dirty = true;
    setDirty(true);
    setNotice(null);
  };

  const acceptSave = (result: SaveResult, sent: NonNullable<typeof pendingSave.current>) => {
    setConfirmedRevision(result.revision);
    setDigest(result.digest);
    live.current.confirmedRevision = result.revision;
    live.current.digest = result.digest;
    const clean = editSequence.current === sent.sequence;
    const next = clean ? sent.project : { ...live.current.draft, revision: result.revision, updatedAt: sent.project.updatedAt };
    setDraft(next);
    live.current.draft = next;
    setDirty(!clean);
    live.current.dirty = !clean;
    pendingSave.current = null;
    setNeedsVerification(false);
    setNotice(`Guardado · rev. ${result.revision}${clean ? '' : '. La instantánea enviada se guardó; hay cambios posteriores sin guardar.'}`);
    return clean;
  };

  const verifyCanonicalSave = async (projectId: string, result: SaveResult) => {
    const fresh = await api.read(projectId);
    if (fresh.digest !== result.digest || fresh.revision !== result.revision) {
      throw new ApiError(409, 'conflict', 'El disco no coincide con la instantánea enviada.');
    }
  };

  const save = async (): Promise<boolean> => {
    if (readOnly || operationLock.current || relinkLock.current || pendingSave.current?.result !== undefined) return false;
    operationLock.current = true;
    setSaving(true);
    live.current.saving = true;
    setError(null);
    setNotice(null);
    setConflict(false);
    const current = live.current;
    const sent: NonNullable<typeof pendingSave.current> = pendingSave.current ?? {
      project: { ...current.draft, title: titleOrFallback(current.draft.title),
        revision: current.confirmedRevision + 1, updatedAt: snapshotTimestamp(current.draft) },
      expectedRevision: current.confirmedRevision, expectedDigest: current.digest, operationId: crypto.randomUUID(), sequence: editSequence.current,
    };
    pendingSave.current = sent;
    try {
      const result = await api.save(sent.project.projectId, {
        project: sent.project,
        expectedRevision: sent.expectedRevision,
        expectedDigest: sent.expectedDigest,
        operationId: sent.operationId,
      });
      if (result.receipt.sync === 'uncertain') {
        sent.result = result;
        setNeedsVerification(true);
        return false;
      }
      // A replay proves a historical commit, not the current canonical file.
      if (sent.ambiguous) await verifyCanonicalSave(sent.project.projectId, result);
      return acceptSave(result, sent);
    } catch (caught) {
      const isConflict = caught instanceof ApiError && caught.code === 'conflict';
      const rejected = caught instanceof ApiError && caught.status >= 400 && caught.status < 500;
      if (rejected) pendingSave.current = null;
      else sent.ambiguous = true;
      setError(`${describeError(caught)} Sus cambios siguen abiertos.${rejected ? '' : ' Reintentar enviará la misma instantánea, sin duplicar la operación.'}`);
      setConflict(isConflict);
      return false;
    } finally {
      operationLock.current = false;
      live.current.saving = false;
      setSaving(false);
    }
  };

  const verifySave = async () => {
    const sent = pendingSave.current;
    if (!sent?.result || operationLock.current || relinkLock.current) return;
    operationLock.current = true;
    setSaving(true);
    setError(null);
    try {
      await verifyCanonicalSave(sent.project.projectId, sent.result);
      acceptSave(sent.result, sent);
    } catch (caught) {
      setError(describeError(caught));
      setConflict(caught instanceof ApiError && caught.code === 'conflict');
    } finally { operationLock.current = false; setSaving(false); }
  };

  const reload = async () => {
    if (operationLock.current || relinkLock.current) return;
    setRelinking(true);
    relinkLock.current = true;
    try {
      const fresh = await api.read(live.current.draft.projectId);
      setDraft(fresh.project);
      setMode(fresh.mode);
      setReadOnlyRaw(fresh.raw);
      setConfirmedRevision(fresh.revision);
      setDigest(fresh.digest);
      setMissingAssets(fresh.missingAssets);
      setDirty(false);
      live.current = { draft: fresh.project, dirty: false, saving: false, confirmedRevision: fresh.revision, digest: fresh.digest };
      pendingSave.current = null;
      setNeedsVerification(false);
      setError(null);
      setConflict(false);
      setNotice(`Recargado desde disco · rev. ${fresh.revision}`);
    } catch (caught) {
      setError(describeError(caught));
    } finally { relinkLock.current = false; setRelinking(false); }
  };

  const relink = async (asset: Asset, bytes: Uint8Array, replace: boolean) => {
    const current = live.current;
    if (current.dirty || operationLock.current || current.saving || readOnly || relinkLock.current) throw new Error('Guarde los cambios antes de revincular.');
    relinkLock.current = true;
    setRelinking(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.relink(current.draft.projectId, asset.assetId, bytes, asset.mimeType, replace, current.confirmedRevision, current.digest);
      const fresh = await api.read(current.draft.projectId);
      setDraft(fresh.project);
      setConfirmedRevision(fresh.revision);
      setDigest(fresh.digest);
      setMissingAssets(fresh.missingAssets);
      setNotice(`Recurso revinculado${result.replaced ? ' con identificador nuevo' : ''}. Los vínculos editoriales no se renuevan.${result.receipt?.sync === 'uncertain' ? ' Persistencia incierta: verifique el disco.' : ''}`);
    } finally { relinkLock.current = false; setRelinking(false); }
  };

  const attachAudio = async (sceneId: string, bytes: Uint8Array, mimeType: 'audio/wav' | 'audio/mpeg', license: string, alignVibi = false, generationSignal?: AbortSignal) => {
    const current = live.current;
    if (current.dirty || operationLock.current || current.saving || readOnly || relinkLock.current || pendingSave.current) {
      throw new Error('Guarde o verifique los cambios antes de subir audio.');
    }
    // The same synchronous lock protects edits, saves, navigation and asset writes.
    relinkLock.current = true;
    setRelinking(true); setError(null); setNotice(null);
    try {
      const result = generationSignal
        ? await api.generateVoice(current.draft.projectId, sceneId, current.confirmedRevision, current.digest, generationSignal)
        : await api.attachAudio(current.draft.projectId, sceneId, bytes, mimeType, license, current.confirmedRevision, current.digest, alignVibi);
      generationSignal?.throwIfAborted();
      if (result.receipt.sync === 'uncertain') {
        throw new ApiError(409, 'audio-unconfirmed', 'La persistencia del audio es incierta; los bytes pueden estar publicados. Verifique el disco antes de continuar.');
      }
      const fresh = result.opened;
      setDraft(fresh.project); setMode(fresh.mode); setReadOnlyRaw(fresh.raw);
      setConfirmedRevision(fresh.revision); setDigest(fresh.digest); setMissingAssets(fresh.missingAssets);
      live.current = { draft: fresh.project, dirty: false, saving: false, confirmedRevision: fresh.revision, digest: fresh.digest };
      setDirty(false); setConflict(false);
      setNotice(`Audio guardado · rev. ${fresh.revision}`);
      return { alignment: result.alignment, warnings: result.warnings };
    } catch (caught) {
      setConflict(Boolean(generationSignal?.aborted) || (caught instanceof ApiError && (caught.code === 'conflict' || caught.code === 'audio-unconfirmed' || caught.status === 0 || caught.status >= 500)));
      setError(`${describeError(caught)} El borrador se conserva. Recargue desde disco para comprobar si el audio llegó a guardarse antes de reintentar.`);
      throw caught;
    } finally { relinkLock.current = false; setRelinking(false); }
  };

  const copyPortable = async () => {
    if (operationLock.current || relinkLock.current) return;
    operationLock.current = true;
    setSaving(true);
    setError(null);
    setNotice(null);
    const request = pendingCopy.current ?? {
      id: `p-${crypto.randomUUID().replaceAll('-', '')}`,
      operationId: crypto.randomUUID(),
      text: serializeProject({ ...live.current.draft, title: titleOrFallback(live.current.draft.title) }),
    };
    pendingCopy.current = request;
    try {
      const result = await api.copy(live.current.draft.projectId, request.id, request.text, request.operationId);
      setCopiedId(result.projectId);
      const missing = result.missingAssets.length > 0
        ? ` Faltan activos: ${result.missingAssets.join(', ')}; la copia queda como borrador, no «completa».`
        : '';
      setCopyNotice(`${result.receipt.sync === 'uncertain' ? 'Persistencia de copia incierta; revise el destino' : 'Copia portable creada'}: ${result.projectId}. Sin aprobación: se requiere nueva revisión editorial.${missing} Corresponde a la instantánea enviada; el estado del proyecto de origen no cambia.`);
      pendingCopy.current = null;
    } catch (caught) {
      const rejected = caught instanceof ApiError && caught.status >= 400 && caught.status < 500 && caught.code !== 'project-exists' && caught.code !== 'conflict';
      if (rejected) {
        pendingCopy.current = null;
        setCopiedId(null);
        setCopyNotice(null);
      } else {
        setCopiedId(request.id);
        setCopyNotice(`Destino reservado: ${request.id}. No se confirma la copia. Puede abrirlo para revisar si fue publicado. El reintento conserva el mismo destino y la misma instantánea.`);
      }
      setError(describeError(caught));
    } finally {
      operationLock.current = false;
      setSaving(false);
    }
  };

  const download = () => {
    try {
      const current = live.current;
      downloadJson(readOnly ? current.draft : downloadSnapshot(current.draft, current.dirty), readOnly ? readOnlyRaw : undefined);
      setNotice(`Descarga solicitada${current.dirty ? ' con cambios no guardados' : ''}: solo configuración; recursos no incluidos. No confirma escritura del navegador ni guardado canónico y no limpia «sin guardar». ${readOnly ? 'Original de solo lectura sin modificar; la importación exige nueva aprobación.' : 'Sin aprobación en la descarga: requiere nueva revisión editorial.'}`);
    } catch (caught) { setError(describeError(caught)); }
  };

  const continueTransition = async (target: NonNullable<typeof transition>) => {
    if (operationLock.current || relinkLock.current) return;
    if (target === 'back') { onBack(); return; }
    if (target === 'reload') { await reload(); setTransition(null); return; }
    if (copiedId === null) return;
    relinkLock.current = true;
    setRelinking(true);
    try {
      await onOpenProject(copiedId, 'Sin aprobación: la copia requiere una nueva revisión editorial. Los medios y vínculos históricos no se renuevan.');
    } catch (caught) { setError(describeError(caught)); }
    finally { relinkLock.current = false; setRelinking(false); setTransition(null); }
  };

  const requestTransition = (target: NonNullable<typeof transition>) => {
    if (operationLock.current || relinkLock.current) return;
    if (live.current.dirty) setTransition(target);
    else void continueTransition(target);
  };

  const updateScene = (index: number, mutate: (scene: Scene) => void) => {
    edit((project) => {
      const scenes = project.scenes.map((scene, position) => {
        if (position !== index) return scene;
        const next = structuredClone(scene);
        mutate(next);
        next.revision += 1;
        return next;
      });
      return withScenes(project, scenes);
    });
  };

  const moveScene = (index: number, delta: number) => {
    edit((project) => {
      const target = index + delta;
      if (target < 0 || target >= project.scenes.length) return project;
      const scenes = [...project.scenes];
      const [moved] = scenes.splice(index, 1);
      if (moved === undefined) return project;
      scenes.splice(target, 0, moved);
      return withScenes(project, scenes);
    });
  };

  const removeScene = (index: number) => {
    const scene = draft.scenes[index];
    if (scene === undefined) return;
    if (sceneHasContent(scene) && !window.confirm(`«${scene.title}» tiene contenido. ¿Eliminar la escena?`)) {
      return;
    }
    edit((project) => withScenes(project, project.scenes.filter((_, position) => position !== index)));
  };

  const addScene = () => {
    edit((project) => withScenes(project, [...project.scenes, createScene(project.scenes.length)]));
  };

  return (
    <main className="screen screen-editor">
      <div id="voice-cancel-controls" aria-live="polite" />
      <fieldset className="editor-fields" disabled={relinking}>
      <header className="editor-header">
        <div className="editor-title">
          <label className="field">
            <span className="sr-only">Nombre del proyecto</span>
            <input
              className="title-input"
              value={draft.title}
              maxLength={120}
              disabled={readOnly}
              onChange={(event) => edit((project) => ({ ...project, title: event.target.value }))}
            />
          </label>
          <p className="muted small">
            rev. {confirmedRevision} · {digest.slice(0, 12)}… ·{' '}
            {dirty ? <strong className="dirty">Cambios sin guardar</strong> : 'Sin cambios pendientes'}
          </p>
        </div>
        <div className="editor-actions">
          <button type="button" className="ghost" onClick={() => requestTransition('back')} disabled={saving}>
            Proyectos
          </button>
          <button type="button" className="ghost" onClick={download}>
            Descargar copia JSON
          </button>
          <button type="button" className="ghost" onClick={() => void copyPortable()} disabled={saving}>
            Copia portable
          </button>
          <button type="button" className="primary" onClick={() => void save()} disabled={readOnly || saving || !dirty || needsVerification}>
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </header>

      {transition !== null && (
        <section className="banner banner-warn" aria-label="Salida con cambios sin guardar">
          <p>Hay cambios sin guardar. Guardar y continuar solo avanza si se confirma el borrador actual. Descartar abandona cambios solo cuando se abre el destino válido.</p>
          <button type="button" disabled={saving || needsVerification} onClick={() => {
            const target = transition;
            void save().then((clean) => { if (clean) void continueTransition(target); });
          }}>Guardar y continuar</button>
          <button type="button" disabled={saving} onClick={() => void continueTransition(transition)}>Descartar cambios y continuar</button>
          <button type="button" disabled={saving} onClick={() => setTransition(null)}>Seguir editando</button>
        </section>
      )}

      {needsVerification && <div className="banner banner-warn" role="status">
        <span>Persistencia incierta: los bytes pueden estar publicados. Verifique el guardado antes de continuar; el borrador sigue sin confirmar.</span>
        <button type="button" disabled={saving} onClick={() => void verifySave()}>Verificar guardado</button>
      </div>}
      {copyNotice !== null && <div className="banner banner-info" role="status">
        <span>{copyNotice}</span>
        {copiedId !== null && <button type="button" className="ghost" disabled={saving}
          onClick={() => requestTransition('copy')}>Abrir copia</button>}
      </div>}

      {importNotice !== undefined && <div className="banner banner-warn" role="status">{importNotice}</div>}
      {draft.approval === null && <p className="muted small" role="status">
        Sin aprobación: la exportación no confirma revisión editorial.
      </p>}
      {relinking && <p role="status">Operación en curso…</p>}

      {readOnly && (
        <div className="banner banner-warn" role="status">
          Solo lectura: el estilo <code>{draft.styleId}</code> no está instalado en este runtime. Se conserva el
          contenido sin reescribirlo.
        </div>
      )}
      {error !== null && (
        <div className="banner banner-error" role="alert">
          <span>{error}</span>
          {conflict && (
            <button type="button" className="ghost" onClick={() => requestTransition('reload')}>
              Recargar desde disco
            </button>
          )}
        </div>
      )}
      {notice !== null && (
        <div className="banner banner-info" role="status">
          <span>{notice}</span>
        </div>
      )}
      {missingAssets.length > 0 && (
        <div className="banner banner-warn" role="status">
          Faltan recursos: {missingAssets.join(', ')}. Puede editar y guardar; no se pueden consumir medios faltantes.
        </div>
      )}

      <AssetManifest assets={draft.assets} missingAssets={missingAssets} disabled={readOnly || dirty || saving || relinking} onRelink={relink} />
      <div className="editor-grid">
        <div>
        <PreviewPlayer draft={draft} seek={previewSeek} missingAssets={missingAssets} />
        <ExportPanel projectId={draft.projectId} revision={confirmedRevision} dirty={dirty}
          disabled={readOnly || saving || needsVerification || relinking} />
        <section className="panel">
          <h2>Idea y estilo</h2>
          <label className="field">
            <span>Idea</span>
            <textarea
              rows={4}
              value={draft.idea}
              disabled={readOnly}
              placeholder="Explicar cómo llega la sal a nuestra mesa…"
              onChange={(event) => edit((project) => ({ ...project, idea: event.target.value }))}
            />
          </label>

          <div className="row">
            <label className="field">
              <span>Idioma</span>
              <select
                value={draft.locale}
                disabled={readOnly}
                onChange={(event) =>
                  edit((project) => ({ ...project, locale: event.target.value === 'en' ? 'en' : 'es' }))
                }
              >
                <option value="es">Español</option>
                <option value="en">English</option>
              </select>
            </label>
            <div className="field">
              <span>Formato</span>
              <p className="static-value">9:16 · 1080 × 1920 · 30 fps</p>
            </div>
          </div>

          <fieldset className="style-cards" disabled={readOnly}>
            <legend>Estilo</legend>
            <label className="style-card selected">
              <input type="radio" name="style" checked readOnly />
              <span>
                <strong>3D estilizado</strong>
                <small className="muted">Seleccionado · paisaje/personaje de catálogo procedural</small>
              </span>
            </label>
            <label className="style-card disabled">
              <input type="radio" name="style" disabled />
              <span>
                <strong>2D vectorial</strong>
                <small className="muted">Futuro, deshabilitado</small>
              </span>
            </label>
            <label className="style-card disabled">
              <input type="radio" name="style" disabled />
              <span>
                <strong>Motion</strong>
                <small className="muted">Futuro, deshabilitado</small>
              </span>
            </label>
          </fieldset>

          <fieldset className="captions" disabled={readOnly}>
            <legend>Subtítulos</legend>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={draft.captionStyle.enabled}
                onChange={(event) =>
                  edit((project) => ({
                    ...project,
                    captionStyle: { ...project.captionStyle, enabled: event.target.checked },
                  }))
                }
              />
              <span>Incluir subtítulos</span>
            </label>
            <label className="field">
              <span>Ancla</span>
              <select
                value={draft.captionStyle.anchor}
                onChange={(event) => {
                  const anchor = event.target.value === 'center' || event.target.value === 'lower' ? event.target.value : 'upper';
                  edit((project) => ({ ...project, captionStyle: { ...project.captionStyle, anchor } }));
                }}
              >
                <option value="upper">upper (inicial)</option>
                <option value="center">center</option>
                <option value="lower">lower</option>
              </select>
            </label>
          </fieldset>
        </section>
        <ScriptStep draft={draft} disabled={readOnly || relinking} onEdit={edit} codexCapability={codexCapability} />
        <VoiceStep draft={draft} dirty={dirty} disabled={readOnly || saving || needsVerification || relinking}
           missingAssets={missingAssets} onUpload={attachAudio}
           onGenerate={(sceneId, signal) => attachAudio(sceneId, new Uint8Array(), 'audio/mpeg', '', false, signal)} />
        </div>

        <section className="panel">
          <div className="panel-heading">
            <h2>Guion y storyboard</h2>
            <button type="button" className="ghost" onClick={addScene} disabled={readOnly}>
              Añadir escena
            </button>
          </div>

          {draft.scenes.length === 0 ? (
            <p className="muted">Guion vacío. Añadí una escena manual; no hace falta aprobar nada en M1.</p>
          ) : (
            <ol className="scene-list">
              {draft.scenes.map((scene, index) => (
                <li key={scene.sceneId} className="scene-card">
                  <div className="scene-heading">
                    <button type="button" className="scene-index" aria-label={`Ver escena ${index + 1}`}
                      onClick={() => setPreviewSeek(previous => ({ sceneId: scene.sceneId, sequence: (previous?.sequence ?? 0) + 1 }))}>
                      {index + 1}
                    </button>
                    <label className="field grow">
                      <span className="sr-only">Título de la escena</span>
                      <input
                        value={scene.title}
                        maxLength={120}
                        disabled={readOnly}
                        onChange={(event) => updateScene(index, (next) => { next.title = event.target.value; })}
                      />
                    </label>
                    <label className="field duration">
                      <span className="sr-only">Duración en segundos</span>
                      <input
                        type="number"
                        min={1}
                        max={15}
                        step={0.1}
                        value={sceneSeconds(scene.durationMs)}
                        disabled={readOnly}
                        onChange={(event) => {
                          const ms = parseSceneSeconds(event.target.value);
                          if (ms !== null) updateScene(index, (next) => { next.durationMs = ms; });
                        }}
                      />
                      <span className="muted small">s</span>
                    </label>
                  </div>
                  <label className="field">
                    <span>Texto</span>
                    <textarea
                      rows={3}
                      value={scene.text}
                      maxLength={2000}
                      disabled={readOnly}
                      placeholder="El agua se evapora…"
                      onChange={(event) => updateScene(index, (next) => { next.text = event.target.value; })}
                    />
                  </label>
                  <label className="field">
                    <span>Intención visual</span>
                    <input
                      value={scene.visualIntent}
                      maxLength={2000}
                      disabled={readOnly}
                      placeholder="Paisaje / salinas"
                      onChange={(event) => updateScene(index, (next) => { next.visualIntent = event.target.value; })}
                    />
                  </label>
                  <div className="scene-actions">
                    <span className="muted small">
                      Inicia en {(scene.startMs / 1000).toFixed(1)} s · {scene.audio ? 'audio adjunto' : 'sin voz'}
                    </span>
                    <button type="button" className="ghost" disabled={readOnly || index === 0} onClick={() => moveScene(index, -1)}>
                      Subir
                    </button>
                    <button
                      type="button"
                      className="ghost"
                      disabled={readOnly || index === draft.scenes.length - 1}
                      onClick={() => moveScene(index, 1)}
                    >
                      Bajar
                    </button>
                    <button type="button" className="ghost danger" disabled={readOnly} onClick={() => removeScene(index)}>
                      Eliminar
                    </button>
                  </div>
                  <DrawingStep draft={draft} sceneId={scene.sceneId} disabled={readOnly || relinking} onEdit={edit} codexCapability={codexCapability} />
                </li>
              ))}
            </ol>
          )}

          <p className="muted small">
            Duración total: {(draft.output.durationMs / 1000).toFixed(1)} s. El documento exige escenas contiguas y que
            la suma coincida con la duración del proyecto.
          </p>
        </section>
      </div>
      </fieldset>
    </main>
  );
}
