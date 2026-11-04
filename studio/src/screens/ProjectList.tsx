import { useCallback, useEffect, useState } from 'react';

import { ApiError, api, describeError, type ProjectSummary } from '../api.ts';
import { LIMITS } from '../../../src/shared/schema/limits.ts';

interface ProjectListProps {
  onOpen: (projectId: string, notice?: string) => Promise<void>;
}

/**
 * P1 · Proyectos y apertura.
 *
 * Local list, no cloud library: every entry is re-validated by the companion
 * when opened. A recent entry is not authority over the document.
 */
export function ProjectList({ onOpen }: ProjectListProps) {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [collision, setCollision] = useState<{ text: string; projectId: string } | null>(null);

  const importText = async (text: string, asCopy = false) => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.importProject(text, asCopy ? 'copy' : 'reject');
      setCollision(null);
      await load();
      const notice = [
        result.approvalCleared ? 'La aprobación importada se eliminó; se requiere una nueva revisión editorial.' : 'JSON importado en el workspace local.',
        result.receipt.sync === 'uncertain' ? 'Persistencia incierta: verificación de disco pendiente.' : '',
      ].filter(Boolean).join(' ');
      await onOpen(result.projectId, notice);
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'project-exists' && typeof caught.details.projectId === 'string') {
        setCollision({ text, projectId: caught.details.projectId });
      } else setError(describeError(caught));
    } finally { setBusy(false); }
  };

  const importFile = async (file: File) => {
    setCollision(null);
    setError(null);
    setBusy(true);
    try {
      if (file.size > LIMITS.maxJsonBytes) throw new Error('El JSON supera el máximo de 2 MiB.');
      const text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
      await importText(text);
    } catch (caught) { setError(describeError(caught)); }
    finally { setBusy(false); }
  };

  const load = useCallback(async () => {
    try {
      const result = await api.list();
      setProjects(result.projects);
      setError(null);
    } catch (caught) {
      setError(describeError(caught));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const created = await api.create(title.trim().length === 0 ? undefined : title.trim());
      setTitle('');
      await load();
      await onOpen(created.projectId);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  const open = async (projectId: string) => {
    setBusy(true);
    setError(null);
    try {
      await onOpen(projectId);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="screen screen-list">
      <header className="screen-header">
        <div>
          <h1>Molecula Studio</h1>
          <p className="muted">Espacio local · companion conectado</p>
        </div>
        <button type="button" className="ghost" onClick={() => void load()} disabled={busy}>
          Actualizar
        </button>
      </header>

      {error !== null && (
        <div className="banner banner-error" role="alert">
          {error}
        </div>
      )}

      <section className="panel">
        <h2>Importar JSON externo</h2>
        <label className="field">
          <span>JSON externo</span>
          <input type="file" accept=".json,application/json" disabled={busy}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = '';
              if (file !== undefined) void importFile(file);
            }} />
        </label>
        <p className="muted small">El original no se modifica. Los recursos se seleccionan por separado; no se buscan rutas ni URLs del documento.</p>
        {collision !== null && <div className="banner banner-warn" role="status">
          <p>Ya existe {collision.projectId}. No se sobrescribirá.</p>
          <button type="button" disabled={busy} onClick={() => void open(collision.projectId)}>Abrir existente</button>
          <button type="button" disabled={busy} onClick={() => void importText(collision.text, true)}>Crear copia importada</button>
          <button type="button" disabled={busy} onClick={() => setCollision(null)}>Cancelar importación</button>
        </div>}
      </section>

      <section className="panel">
        <h2>Nuevo proyecto</h2>
        <form
          className="inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <label className="field">
            <span>Nombre</span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Proyecto sin título"
              maxLength={120}
            />
          </label>
          <button type="submit" className="primary" disabled={busy}>
            {busy ? 'Creando…' : 'Nuevo proyecto'}
          </button>
        </form>
        <p className="muted small">
          Crear no exige proveedor, red ni recursos. Podés guardar con la idea a medias.
        </p>
      </section>

      <section className="panel">
        <h2>Proyectos recientes</h2>
        {projects === null ? (
          <p className="muted">Leyendo el workspace…</p>
        ) : projects.length === 0 ? (
          <p className="muted">Sin proyectos: «Comience con una idea».</p>
        ) : (
          <ul className="project-list">
            {projects.map((project) => (
              <li key={project.projectId}>
                <div className="project-meta">
                  <strong>{project.title.length > 0 ? project.title : 'Documento inválido'}</strong>
                  <span className="muted small">
                    {project.projectId} · {project.mode === 'read-only' ? 'Solo lectura' : 'Borrador'} · rev.{' '}
                    {project.revision}
                  </span>
                  {project.missingAssets.length > 0 && (
                    <span className="badge badge-warn">Faltan recursos: {project.missingAssets.join(', ')}</span>
                  )}
                  {project.orphanTemps.length > 0 && (
                    <span className="badge badge-warn">
                      {project.orphanTemps.length} temporal(es) sin confirmar (no se promueven solos)
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  className="primary"
                  onClick={() => void open(project.projectId)}
                  disabled={busy}
                >
                  Abrir
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="muted small">
        <p>
          Importar JSON externo limpia la aprobación con aviso; la copia portable incluye{' '}
          <code>project.json</code> y <code>assets/</code>. «Descargar copia JSON» no es portable por sí sola.
        </p>
      </footer>
    </main>
  );
}
