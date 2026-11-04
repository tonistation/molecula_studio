import { useRef, useState } from 'react';

import type { Project, ProjectMode, Scene } from '../../../src/shared/schema/types.ts';
import { ApiError, api, describeError, type ReadResult } from '../api.ts';
import {
  createScene,
  downloadJson,
  parseSceneSeconds,
  sceneHasContent,
  sceneSeconds,
  titleOrFallback,
  withScenes,
} from '../model.ts';

interface EditorProps {
  opened: ReadResult;
  onBack: () => void;
  onOpenProject: (projectId: string) => Promise<void>;
}

/**
 * P2/P3 · Idea, estilo y guion mínimo.
 *
 * Saving is explicit. «Guardado» appears only after the companion confirms the
 * persisted revision; edits made while saving keep the draft dirty.
 */
export function Editor({ opened, onBack, onOpenProject }: EditorProps) {
  const [draft, setDraft] = useState<Project>(opened.project);
  const [confirmedRevision, setConfirmedRevision] = useState(opened.revision);
  const [digest, setDigest] = useState(opened.digest);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const editSequence = useRef(0);
  const mode: ProjectMode = opened.mode;
  const readOnly = mode === 'read-only';

  const edit = (mutate: (project: Project) => Project) => {
    if (readOnly) return;
    setDraft((previous) => mutate(structuredClone(previous)));
    editSequence.current += 1;
    setDirty(true);
    setNotice(null);
    setConflict(false);
  };

  const save = async () => {
    if (readOnly || saving) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    setConflict(false);
    const sentSequence = editSequence.current;
    const payload: Project = {
      ...draft,
      title: titleOrFallback(draft.title),
      revision: confirmedRevision + 1,
      updatedAt: new Date().toISOString(),
    };
    try {
      const result = await api.save(draft.projectId, {
        project: payload,
        expectedRevision: confirmedRevision,
        operationId: crypto.randomUUID(),
      });
      setConfirmedRevision(result.revision);
      setDigest(result.digest);
      if (editSequence.current === sentSequence) {
        setDraft(payload);
        setDirty(false);
      }
      setNotice(
        result.receipt.sync === 'uncertain'
          ? `Guardado · rev. ${result.revision} (verificación de disco pendiente)`
          : `Guardado · rev. ${result.revision}`,
      );
    } catch (caught) {
      setError(describeError(caught));
      setConflict(caught instanceof ApiError && caught.code === 'conflict');
    } finally {
      setSaving(false);
    }
  };

  const reload = async () => {
    try {
      const fresh = await api.read(draft.projectId);
      setDraft(fresh.project);
      setConfirmedRevision(fresh.revision);
      setDigest(fresh.digest);
      setDirty(false);
      setError(null);
      setConflict(false);
      setNotice(`Recargado desde disco · rev. ${fresh.revision}`);
    } catch (caught) {
      setError(describeError(caught));
    }
  };

  const copyPortable = async () => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.copy(draft.projectId);
      setCopiedId(result.projectId);
      const missing = result.missingAssets.length > 0
        ? ` Faltan activos: ${result.missingAssets.join(', ')}; la copia queda como borrador, no «completa».`
        : '';
      setNotice(`Copia portable creada: ${result.projectId}.${missing}`);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setSaving(false);
    }
  };

  const download = () => {
    downloadJson(draft);
    setNotice('Copia JSON descargada: no incluye activos, no confirma guardado y no limpia «sin guardar».');
  };

  const back = () => {
    if (dirty && !window.confirm('Hay cambios sin guardar. ¿Salir igual? Se perderán los cambios no guardados.')) {
      return;
    }
    onBack();
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
          <button type="button" className="ghost" onClick={back}>
            Proyectos
          </button>
          <button type="button" className="ghost" onClick={download}>
            Descargar copia JSON
          </button>
          <button type="button" className="ghost" onClick={() => void copyPortable()} disabled={saving}>
            Copia portable
          </button>
          <button type="button" className="primary" onClick={() => void save()} disabled={readOnly || saving || !dirty}>
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </header>

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
            <button type="button" className="ghost" onClick={() => void reload()}>
              Recargar desde disco
            </button>
          )}
        </div>
      )}
      {notice !== null && (
        <div className="banner banner-info" role="status">
          <span>{notice}</span>
          {copiedId !== null && (
            <button
              type="button"
              className="ghost"
              onClick={() => {
                void onOpenProject(copiedId).catch((caught: unknown) => setError(describeError(caught)));
              }}
            >
              Abrir copia
            </button>
          )}
        </div>
      )}
      {opened.missingAssets.length > 0 && (
        <div className="banner banner-warn" role="status">
          Faltan recursos: {opened.missingAssets.join(', ')}. Podés editar y guardar; reproducir/exportar quedará
          bloqueado hasta revincular (F05).
        </div>
      )}

      <div className="editor-grid">
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
                    <span className="scene-index">{index + 1}</span>
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
                      Inicia en {(scene.startMs / 1000).toFixed(1)} s · sin voz (M1)
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
    </main>
  );
}
