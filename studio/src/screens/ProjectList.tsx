import { useCallback, useEffect, useState } from 'react';

import { api, describeError, type ProjectSummary } from '../api.ts';

interface ProjectListProps {
  onOpen: (projectId: string) => Promise<void>;
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
