import { useState, type ReactNode } from 'react';

interface ManualResponseProps<T> {
  label: string;
  copyLabel: string;
  buildPrompt: () => string;
  parse: (text: string) => { ok: true; value: T } | { ok: false; errors: string[] };
  review: (value: T) => ReactNode;
  apply: (value: T) => boolean;
  applyLabel?: string;
}

/** Review is invalidated on paste/edit; only explicit application changes the draft. */
export function ManualResponse<T>({ label, copyLabel, buildPrompt, parse, review, apply,
  applyLabel = 'Aplicar al borrador' }: ManualResponseProps<T>) {
  const [response, setResponse] = useState('');
  const [proposal, setProposal] = useState<T | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState('');
  const [fallback, setFallback] = useState('');

  const copyPrompt = async () => {
    setErrors([]);
    setNotice('');
    let prompt: string;
    try { prompt = buildPrompt(); }
    catch (error) { setErrors([error instanceof Error ? error.message : 'No se pudo crear el prompt.']); return; }
    try {
      await navigator.clipboard.writeText(prompt);
      setFallback('');
      setNotice('Prompt copiado. Pégalo en tu herramienta externa y trae la respuesta JSON.');
    } catch {
      setFallback(prompt);
      setNotice('No se pudo acceder al portapapeles. Selecciona y copia el prompt de abajo.');
    }
  };

  return <div className="manual-response">
    <button type="button" className="ghost" onClick={() => void copyPrompt()}>{copyLabel}</button>
    {fallback && <label className="field"><span>Prompt para copiar</span>
      <textarea aria-label="Prompt para copiar" rows={5} readOnly value={fallback} onFocus={event => event.target.select()} />
    </label>}
    <label className="field"><span>{label}</span>
      <textarea aria-label={label} rows={5} value={response} spellCheck={false} onChange={event => {
        setResponse(event.target.value); setProposal(null); setErrors([]); setNotice('');
      }} />
    </label>
    <button type="button" className="ghost" disabled={!response.trim()} onClick={() => {
      const result = parse(response);
      setProposal(result.ok ? result.value : null);
      setErrors(result.ok ? [] : result.errors);
      setNotice('');
    }}>Revisar</button>
    {errors.length > 0 && <div className="banner banner-error" role="alert"><ul>
      {errors.map((error, index) => <li key={index}>{error}</li>)}
    </ul></div>}
    {proposal !== null && <div className="manual-review">
      {review(proposal)}
      <button type="button" className="primary" onClick={() => {
        try {
          if (apply(proposal)) {
            setProposal(null);
            setErrors([]);
            setNotice('Aplicado al borrador. Los cambios no se han guardado.');
          }
        } catch (error) {
          setErrors([error instanceof Error ? error.message : 'No se pudo aplicar al borrador.']);
        }
      }}>{applyLabel}</button>
    </div>}
    {notice && <p role="status">{notice}</p>}
  </div>;
}
