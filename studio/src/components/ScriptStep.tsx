import { useState } from 'react';
import type { Project } from '../../../src/shared/schema/types.ts';
import { buildScriptPrompt } from '../../../src/shared/script/prompt.ts';
import { parseScriptResponse } from '../../../src/shared/script/parse.ts';
import { applyScriptProposal } from '../../../src/shared/script/apply.ts';
import { newSceneId } from '../model.ts';
import { ManualResponse } from './ManualResponse.tsx';

export interface DraftStepProps {
  draft: Project;
  disabled: boolean;
  onEdit: (mutate: (project: Project) => Project) => void;
}

export function ScriptStep({ draft, disabled, onEdit }: DraftStepProps) {
  const [targetSeconds, setTargetSeconds] = useState(30);
  return <section className="panel" aria-label="Guion manual">
    <h2>Guion manual</h2>
    <p className="muted small">Copia el prompt en ChatGPT u otra herramienta. Revisa su respuesta antes de reemplazar las escenas. No se conecta ningún proveedor.</p>
    <fieldset className="manual-fields" disabled={disabled}>
      <label className="field"><span>Duración objetivo</span>
        <select value={targetSeconds} onChange={event => setTargetSeconds(Number(event.target.value))}>
          {[15, 30, 45, 60].map(seconds => <option key={seconds} value={seconds}>{seconds} s</option>)}
        </select>
      </label>
      <ManualResponse label="Pegar respuesta" copyLabel="Copiar prompt"
        buildPrompt={() => buildScriptPrompt({ idea: draft.idea, styleId: draft.styleId, locale: draft.locale, targetSeconds })}
        parse={text => {
          const result = parseScriptResponse(text);
          return result.ok ? { ok: true, value: result.proposal } : result;
        }}
        review={proposal => <section aria-label="Revisión del guion">
          <h3>{proposal.title}</h3>
          <ol>{proposal.scenes.map((scene, index) => <li key={index}>
            <strong>{scene.title} · {scene.seconds} s</strong>
            <p>{scene.narration}</p><p className="muted">{scene.visualIntent}</p>
          </li>)}</ol>
          <p>Portada: {proposal.cover.headline}</p><p>{proposal.postText}</p>
          <p className="small">Fuentes: {proposal.sources.length}. Verifica las afirmaciones antes de publicar.</p>
          <ul>{proposal.sources.map((source, index) => <li key={index}>{source.title}: {source.url}</li>)}</ul>
        </section>}
        apply={proposal => {
          if (draft.scenes.length > 0 && !window.confirm(`Reemplazar ${draft.scenes.length} escenas. Se eliminarán sus dibujos y vínculos de voz del borrador. ¿Continuar?`)) return false;
          const ids = proposal.scenes.map(() => newSceneId());
          onEdit(project => applyScriptProposal(project, proposal, ids));
          return true;
        }} />
    </fieldset>
  </section>;
}
