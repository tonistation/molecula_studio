import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiError, describeError } from '../api.ts';
import { SCRIPT_TIMEOUT_MS } from '../../../src/shared/generation-timeouts.ts';
import { useElapsed } from './useElapsed.ts';

interface ManualResponseProps<T> {
  label: string;
  copyLabel: string;
  buildPrompt: () => string;
  parse: (text: string) => { ok: true; value: T } | { ok: false; errors: string[] };
  review: (value: T) => ReactNode;
  apply: (value: T) => boolean;
  applyLabel?: string;
  generate?: (signal: AbortSignal) => Promise<string>;
  timeoutMs?: number;
}

/** Review is invalidated on paste/edit; only explicit application changes the draft. */
export function ManualResponse<T>({ label, copyLabel, buildPrompt, parse, review, apply,
  applyLabel = 'Aplicar al borrador', generate, timeoutMs = SCRIPT_TIMEOUT_MS }: ManualResponseProps<T>) {
  const [response, setResponse] = useState('');
  const [proposal, setProposal] = useState<T | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState('');
  const [fallback, setFallback] = useState('');
  const [generating, setGenerating] = useState(false);
  const elapsed = useElapsed(generating);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);

  const generateResponse = async () => {
    if (!generate || pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setGenerating(true); setErrors([]); setProposal(null); setResponse(''); setNotice('');
    try {
      const text = await generate(controller.signal);
      if (controller.signal.aborted) return;
      setResponse(text);
      const result = parse(text);
      setProposal(result.ok ? result.value : null);
      setErrors(result.ok ? [] : result.errors);
    } catch (error) {
      if (controller.signal.aborted) return;
      setErrors([describeError(error)]);
      if (error instanceof ApiError && typeof error.details.responseText === 'string') setResponse(error.details.responseText);
    } finally {
      pending.current = null;
      setGenerating(false);
    }
  };

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
    {generate ? <button type="button" disabled={generating} onClick={() => void generateResponse()}>
      {generating ? 'Generando con Codex…' : 'Generar con Codex'}
    </button> : <button type="button" className="ghost" onClick={() => void copyPrompt()}>{copyLabel}</button>}
    {generating && <><p role="status">Esperando respuesta de Codex. Puede tardar varios minutos. Transcurrido: {elapsed} s; límite: {timeoutMs / 1000} s.</p>
      <button type="button" onClick={() => { pending.current?.abort(); setNotice('Generación cancelada.'); }}>Cancelar generación</button></>}
    {fallback && <label className="field"><span>Prompt para copiar</span>
      <textarea aria-label="Prompt para copiar" rows={5} readOnly value={fallback} onFocus={event => event.target.select()} />
    </label>}
    <label className="field"><span>{label}</span>
      <textarea aria-label={label} rows={5} value={response} disabled={generating} spellCheck={false} onChange={event => {
        setResponse(event.target.value); setProposal(null); setErrors([]); setNotice('');
      }} />
    </label>
    <button type="button" className="ghost" disabled={generating || !response.trim()} onClick={() => {
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
