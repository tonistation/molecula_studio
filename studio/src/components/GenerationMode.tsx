import { useEffect, useState } from 'react';
import { api } from '../api.ts';

export type CodexCapability = 'checking' | 'available' | 'unavailable';

export function useCodexCapability(): CodexCapability {
  const [capability, setCapability] = useState<CodexCapability>('checking');
  useEffect(() => {
    const controller = new AbortController();
    void api.capabilities(controller.signal).then(result => {
      if (!controller.signal.aborted) setCapability(result.codex ? 'available' : 'unavailable');
    }).catch(() => { if (!controller.signal.aborted) setCapability('unavailable'); });
    return () => controller.abort();
  }, []);
  return capability;
}

export function GenerationMode({ mode, onChange, capability, label }: {
  mode: 'auto' | 'manual'; onChange: (mode: 'auto' | 'manual') => void; capability: CodexCapability; label: string;
}) {
  return <div>
    <label className="field"><span>{label}</span>
      <select aria-label={label} value={mode} onChange={event => onChange(event.target.value as 'auto' | 'manual')}>
        <option value="manual">Manual</option>
        <option value="auto" disabled={capability !== 'available'}>Auto · Codex</option>
      </select>
    </label>
    {capability !== 'available' && <p className="muted small">{capability === 'checking'
      ? 'Comprobando Codex CLI…' : 'Auto no disponible. Instala Codex CLI y ejecuta codex login. Puedes continuar en modo manual.'}</p>}
    {mode === 'auto' && <p className="muted small">Usa la sesión y los límites de uso de Codex CLI. Se enviará el contenido a Codex; no se ha comprobado el inicio de sesión.</p>}
  </div>;
}
