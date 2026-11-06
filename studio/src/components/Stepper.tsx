import { useEffect, useState } from 'react';
import type { Project } from '../../../src/shared/schema/types.ts';
import { workflowStates, type WorkflowStates } from '../workflow-model.ts';

const steps = [
  ['idea', 'Idea y estilo'], ['script', 'Guion'], ['voice', 'Voz'], ['preview', 'Vista previa y exportar'],
] as const;
const labels = { pending: 'Pendiente', ready: 'Listo', outdated: 'Desactualizado' };

export function Stepper({ draft, missingAssets, dirty }: {
  draft: Project; missingAssets: string[]; dirty: boolean;
}) {
  const [result, setResult] = useState<{ project: Project; missing: string[]; states: WorkflowStates } | null>(null);
  const [active, setActive] = useState('idea');
  useEffect(() => {
    let cancelled = false;
    void workflowStates(draft, missingAssets).then(states => {
      if (!cancelled) setResult({ project: draft, missing: missingAssets, states });
    }).catch(() => { if (!cancelled) setResult(null); });
    return () => { cancelled = true; };
  }, [draft, missingAssets]);
  const states = result?.project === draft && result.missing === missingAssets ? result.states : null;
  return <nav className="workflow" aria-label="Flujo de creación">
    <ol className="workflow-steps">
      {steps.map(([id, title], index) => <li key={id}>
        <button type="button" className="workflow-step" aria-current={active === id ? 'step' : undefined}
          onClick={() => {
            setActive(id);
            const target = document.getElementById(`workflow-${id}`);
            target?.focus({ preventScroll: true });
            target?.scrollIntoView({ block: 'start' });
          }}>
          <strong>{index + 1}. {title}</strong>
          <span className={`workflow-state ${states?.[index] ?? ''}`}>
            {states ? labels[states[index]!] : 'Comprobando…'}
            {id === 'voice' && draft.output.voiceMode === 'silent' ? ' · Opcional en modo silencioso' : ''}
          </span>
        </button>
      </li>)}
    </ol>
    <p className="muted small" aria-live="polite">{dirty ? 'Estado del borrador sin guardar.' : 'Estado del proyecto guardado.'} Los pasos no bloquean la navegación. «Listo» indica contenido preparado, no una exportación completada.</p>
  </nav>;
}
