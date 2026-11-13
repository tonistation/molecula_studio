import { buildKitModelPrompt } from '../../../src/shared/kit/prompt.ts';
import { parseKitResponse, parseKitModelBundle } from '../../../src/shared/kit/parse.ts';
import { applyKitScene, applyKitSceneWithModels } from '../../../src/shared/kit/apply.ts';
import type { KitScene } from '../../../src/shared/kit/types.ts';
import type { ModelSnapshot } from '../../../src/shared/models/model.ts';
import { selectModelCatalog } from '../../../src/shared/models/catalog.ts';
import { parseResponseObject } from '../../../src/shared/response-json.ts';
import { ManualResponse } from './ManualResponse.tsx';
import type { DraftStepProps } from './ScriptStep.tsx';
import { useRef, useState } from 'react';
import { api, ApiError } from '../api.ts';
import { GenerationMode } from './GenerationMode.tsx';
import { DRAWING_TIMEOUT_MS } from '../../../src/shared/generation-timeouts.ts';
import { FlatDrawingStep } from './FlatDrawingStep.tsx';

export function DrawingStep({ draft, sceneId, disabled, onEdit, codexCapability = 'unavailable' }: DraftStepProps & { sceneId: string }) {
  const [mode, setMode] = useState<'auto' | 'manual'>('manual');
  const [generatedFrom, setGeneratedFrom] = useState<string | null>(null);
  const promptSelection = useRef<{ draft: string; sceneId: string; catalog: ModelSnapshot[] } | 'invalid' | null>(null);
  const currentDraft = useRef('');
  currentDraft.current = JSON.stringify(draft);
  const index = draft.scenes.findIndex(scene => scene.sceneId === sceneId);
  const scene = draft.scenes[index];
  if (!scene) return null;
  if (draft.schemaVersion === 3 && draft.styleVersion === 1 && (draft.styleId === 'vector-2d' || draft.styleId === 'motion-graphics')) {
    return <FlatDrawingStep key={`${draft.styleId}:${sceneId}`} draft={draft} sceneId={sceneId} disabled={disabled} onEdit={onEdit} codexCapability={codexCapability} />;
  }
  if ((draft.styleId !== 'stylized-3d' || draft.styleVersion !== 1) && !disabled) return null;
  const catalogForDraft = async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const models: ModelSnapshot[] = [];
      let revision: string | undefined;
      try {
        for (let offset = 0; offset < 1024; offset += 64) {
          const page = await api.models(offset, revision);
          if (!/^[0-9a-f]{64}$/.test(page.revision) || (revision && revision !== page.revision)) throw new Error('No se pudo leer la biblioteca completa.');
          revision = page.revision;
          models.push(...page.models);
          if (!page.hasMore) return selectModelCatalog(draft.models ?? [], models, `${scene.title} ${scene.text} ${scene.visualIntent}`);
          if (page.models.length !== 64) throw new Error('No se pudo leer la biblioteca completa.');
        }
        throw new Error('No se pudo leer la biblioteca completa.');
      } catch (error) {
        if (!(error instanceof ApiError && error.code === 'model-catalog-changed')) throw error;
        if (attempt === 1) throw new Error('La biblioteca de modelos cambió varias veces. Vuelve a intentarlo.');
      }
    }
    throw new Error('No se pudo leer la biblioteca completa.');
  };
  return <details className="drawing-step">
    <summary>{scene.visual ? 'Redibujar esta escena' : 'Dibujar esta escena'} · {mode === 'manual' ? 'manual' : 'auto'}</summary>
    <fieldset className="manual-fields" disabled={disabled}>
      <p className="muted small">Una respuesta por escena. Dibuja en orden para reutilizar los objetos anteriores. Aplicar solo cambia este dibujo, sin guardar.</p>
      <GenerationMode label="Modo de dibujo" mode={mode} onChange={value => { setMode(value); setGeneratedFrom(null); }} capability={codexCapability} />
      <ManualResponse<{ scene: KitScene; models: ModelSnapshot[] | null; reviewedFrom: string }> key={`${mode}:${sceneId}:${scene.durationMs}`} label="Pegar escena" copyLabel="Copiar prompt de dibujo" timeoutMs={DRAWING_TIMEOUT_MS}
        generate={mode === 'auto' ? async signal => {
          setGeneratedFrom(JSON.stringify(draft));
          try {
            return JSON.stringify(await api.generateModelDrawing(draft, sceneId, signal), null, 2);
          } catch (error) {
            if (error instanceof ApiError && error.code === 'internal-error') {
              throw new Error('No se pudo generar el dibujo. Verifica que la biblioteca de modelos esté disponible y vuelve a intentarlo.');
            }
            throw error;
          }
        } : undefined}
        buildPrompt={async () => {
          promptSelection.current = 'invalid';
          const source = JSON.stringify(draft);
          const catalog = await catalogForDraft();
          if (currentDraft.current !== source) throw new Error('El borrador cambió. Vuelve a copiar el prompt.');
          const prompt = buildKitModelPrompt({
          scene: { title: scene.title, text: scene.text, visualIntent: scene.visualIntent, durationMs: scene.durationMs },
          previousScenes: draft.scenes.slice(0, index), references: draft.sources ?? [], targetVisual: scene.visual,
          catalog,
          });
          promptSelection.current = { draft: source, sceneId, catalog: structuredClone(catalog) };
          return prompt;
        }}
        parse={async text => {
          const reviewedFrom = JSON.stringify(draft);
          if (mode === 'auto') {
            try {
              const decoded = parseResponseObject(text);
              if (!decoded.ok) return decoded;
              const value = decoded.value;
              if (value && typeof value === 'object' && !Array.isArray(value) && 'scene' in value && 'models' in value) {
                if (Object.keys(value).sort().join() !== 'models,scene') throw new Error();
                const bundle = value as { scene: unknown; models: unknown };
                const checked = applyKitSceneWithModels(draft, sceneId, bundle.scene, bundle.models);
                return { ok: true, value: { scene: checked.scenes[index]!.visual as KitScene, models: bundle.models as ModelSnapshot[], reviewedFrom } };
              }
            } catch { return { ok: false, errors: ['La escena o los modelos no son válidos.'] }; }
          }
          const selection = promptSelection.current;
          if (mode === 'manual' && selection === 'invalid') return { ok: false, errors: ['No hay un prompt válido. Vuelve a copiarlo.'] };
          if (mode === 'manual' && selection && selection !== 'invalid' && (selection.draft !== reviewedFrom || selection.sceneId !== sceneId)) return { ok: false, errors: ['El borrador cambió desde que copiaste el prompt. Vuelve a copiarlo.'] };
          const decoded = parseResponseObject(text);
          if (decoded.ok && decoded.value && typeof decoded.value === 'object' && !Array.isArray(decoded.value)
            && ('scene' in decoded.value || 'models' in decoded.value)) {
            const catalog = selection && selection !== 'invalid' ? selection.catalog : await catalogForDraft();
            if (currentDraft.current !== reviewedFrom) return { ok: false, errors: ['El borrador cambió. Vuelve a revisar la respuesta.'] };
            const result = parseKitModelBundle(text, { durationMs: scene.durationMs,
              entities: new Map(draft.entities.map(entity => [entity.entityId, entity])) }, catalog);
            if (!result.ok) return result;
            try { applyKitSceneWithModels(draft, sceneId, result.scene, result.models); }
            catch { return { ok: false, errors: ['La escena o los modelos no son válidos para este borrador.'] }; }
            return { ok: true, value: { scene: result.scene, models: result.models, reviewedFrom } };
          }
          const result = parseKitResponse(text, { durationMs: scene.durationMs,
            entities: new Map(draft.entities.map(entity => [entity.entityId, entity])) });
          return result.ok ? { ok: true, value: { scene: result.scene, models: null, reviewedFrom } } : result;
        }}
        review={({ scene: kit, models }) => <section aria-label="Revisión del dibujo">
          <p>{kit.objects.length} objetos · {kit.labels.length} rótulos · {kit.particles.length} sistemas de partículas</p>
          <p>Cámara: {kit.camera.move}</p>
          <ul>{kit.objects.map(object => <li key={object.id}>{object.id} · {object.type}</li>)}</ul>
          {models && <><p>Modelos: {models.length}. Al aplicar, se publicarán en la biblioteca de este workspace.</p><ul>{models.map(({ id, model }) => <li key={id}>{model.name} · {model.semanticId}</li>)}</ul></>}
          <p>Se reemplazará únicamente el dibujo de «{scene.title}».</p>
        </section>}
        apply={async ({ scene: kit, models, reviewedFrom }, signal) => {
          if (mode === 'manual' && models) await api.publishModels(models, signal);
          signal.throwIfAborted();
          onEdit(project => {
          if (mode === 'auto' && generatedFrom !== JSON.stringify(project)) throw new Error('El borrador cambió durante la generación. Genera el dibujo de nuevo o usa el modo manual.');
          if (mode === 'manual' && reviewedFrom !== JSON.stringify(project)) throw new Error(models
            ? 'El borrador cambió desde la revisión. No se aplicó el dibujo; los modelos publicados permanecen en la biblioteca.'
            : 'El borrador cambió desde la revisión. No se aplicó el dibujo.');
          return models ? applyKitSceneWithModels(project, sceneId, kit, models) : applyKitScene(project, sceneId, kit);
        }); return true; }} />
    </fieldset>
  </details>;
}
