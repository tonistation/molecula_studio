# Ruta al primer video — plan activo

Guía para terminar Molecula Studio con OpenCode, paso a paso, hasta exportar el **primer video vertical de punta a punta**: idea → guion → voz → vista previa → MP4. Sustituye a [`docs/plan/implementation-tasks.md`](docs/plan/implementation-tasks.md) como plan activo; ese backlog queda congelado como endurecimiento posterior ([mapeo](#qué-pasa-con-el-plan-anterior)).

Base: commit `ad26d62`. Uso local, una persona. Servidor: [más adelante](#camino-a-servidor-no-ahora).

> **Regla de oro:** cada paso termina con algo que se puede **ver o escuchar**. Si un paso no acerca el primer video, no va antes del primer video.

## Cómo usar esta guía

1. Una sesión de OpenCode = un paso (por ejemplo `1.3`), en su propia rama `feat/<paso>-<slug>`.
2. Pegar el [prompt de ejecución](#prompt-de-ejecución) con el ID del paso.
3. OpenCode implementa, ejecuta `npm run typecheck` y los tests del paso, y explica cómo verificar a mano.
4. OpenCode hace commit en la rama del paso y lo marca en [Progreso](#progreso). Verificar el criterio de aceptación (ver/escuchar); si se cumple, fusionar la rama en `main` (o pedírselo a OpenCode).
5. Al cerrar cada fase: sesión nueva con el [prompt de revisión](#prompt-de-revisión).

## Dónde estamos

| Pieza | Estado | En esta ruta |
|---|---|---|
| Schema `project.json` v1, validación, digests | ✅ | Se reutiliza tal cual |
| Companion local: HTTP loopback, token, `ProjectStore` atómico | ✅ | Se extiende con rutas nuevas |
| Estudio React: proyectos, escenas (texto/duración), guardar/reabrir, importar, relink | ✅ | Se extiende |
| Reloj por frame (`src/shared/timeline.ts`) | ✅ | Se reutiliza para calcular frames |
| Composición visual 3D + subtítulos | ❌ | Fase 1 |
| Exportar MP4 | ❌ | Fase 1 (CLI) y Fase 2 (UI) |
| Vista previa en el estudio | ❌ | Fase 2 |
| Guion automático / manual | ❌ | Fase 3 |
| Voz automática / manual | ❌ | Fase 4 |

Del plan anterior están completas 9 de 27 unidades (≈33 %), pero son la **base de persistencia**. Ninguna de las cuatro piezas que producen un video existe todavía. Esta ruta las pone primero.

## Decisiones

| ID | Decisión | Por qué | Descartado |
|---|---|---|---|
| ADR-01 | **Remotion** para composición, vista previa (`@remotion/player`) y render MP4 (`@remotion/renderer`). Three.js vía `@remotion/three`. | Resuelve reloj por frame, sincronía de audio, captura en Chromium y codificación (trae su propio FFmpeg). Elimina V03c, V05 y casi todo V06. Tiene skills oficiales para agentes. Licencia gratuita para personas y empresas de hasta 3 personas. | Pipeline propio Chromium + FFmpeg. El motivo anterior («licencia comercial obligatoria») no aplica a uso individual. |
| ADR-02 | **Modo dual por paso generativo**: `auto` (proveedor) y `manual` (copiar prompt/texto, importar resultado). Ambos modos producen el mismo tipo y pasan por la **misma** función `apply`. | Es la metodología central del producto; garantiza costo cero cuando se quiera. | Proveedor real como opcional al final (E05). |
| ADR-03 | Guion `auto` con **Codex CLI** (`codex exec --output-schema`) usando la sesión ChatGPT local. | Costo marginal cero; salida JSON validada por schema. | API de pago desde el inicio. |
| ADR-04 | Voz `auto` con **Vibi** (`api.vibi.pro`, voces ElevenLabs/MiniMax/CapCut), una tarea por escena. Tiempos por palabra con el **speech-to-text de Vibi** (`timestamps_granularity: word`), que sirve igual para audio subido a mano. Clave en variable de entorno del companion. | Proveedor que ya se usa. El TTS de Vibi no devuelve tiempos por palabra (solo SRT opcional); su STT sí, y unifica la alineación de ambos modos. | ElevenLabs directo con `/with-timestamps`. |
| ADR-05 | `builtin-sans-heavy-v1` = archivo de fuente **OFL** local (p. ej. Montserrat ExtraBold) dentro del repo. | Cierra D01 para la fuente; sin red en runtime. | Google Fonts en runtime. |
| ADR-06 | Exportar usa la **revisión guardada** en disco. `approval` no bloquea exportar en v1. | Lo exportado = lo guardado; sin preflight ni snapshots. | V04b/V06a. |
| ADR-07 | **Un render a la vez**, estado en memoria del companion, sin journal ni recuperación tras reinicio. | Uso local de una persona. | Cola recuperable (V06b–c). |
| ADR-09 | Escenas **declarativas sobre un kit** (`visual.kind: 'kit'`): la IA devuelve JSON validado que combina piezas del kit (cielo, terreno, agua, objetos, personaje, partículas, rótulos, cámara). Se reserva `visual.kind: 'code'` (componente generado por IA) como salida de emergencia **posterior y solo local**. Requiere `schemaVersion: 2` con migración desde v1. | Seguro (datos, no código), determinista, vista previa instantánea, modo manual pegando JSON y apto para un servicio futuro sin sandbox. Las [referencias](docs/ux/references/README.md) piden objetos específicos del tema: el catálogo fijo de 5 entidades no alcanza. | Solo código generado (exige compilar en preview y render, y sandbox en servidor). |
| ADR-08 | `implementation-tasks.md` **congelado**. Se retoma una tarjeta solo si aparece el problema que resuelve. | Las 37 tarjetas anteponen robustez a producto. | Ejecutarlas en orden. |

## Arquitectura objetivo

```text
idea + estilo
   │
   ├─ Guion ── auto: companion → codex exec ──┐
   │           manual: copiar prompt / pegar ─┴→ ScriptProposal → applyScriptProposal() → borrador → Guardar
   │
   ├─ Voz ──── auto: companion → Vibi TTS ────┐
   │           manual: subir audio por escena ┴→ audio → words (Vibi STT o estimadas) → ProjectStore.attachSceneAudio() (guarda)
   │
   ├─ Vista previa: <Player> + src/video  (mismo código que el render)
   │
   └─ Exportar: companion → @remotion/renderer → <workspace>/.renders/<projectId>/<rev>-<fecha>.mp4
```

### Carpetas nuevas

| Ruta | Contenido | Reglas |
|---|---|---|
| `src/video/` | Composición Remotion: `index.ts`, `Root.tsx`, `VerticalVideo.tsx`, `styles/`, `captions/`, `fonts.ts`, `assets/fonts/` | React puro, sin APIs Node. Todo movimiento deriva de `useCurrentFrame()`. |
| `src/shared/video-props.ts` | `projectToVideoProps(project, assetUrls)` | Puro, `.ts` sin JSX (Node lo importa). |
| `src/shared/script/` | `schema.ts`, `prompt.ts`, `parse.ts`, `apply.ts` | Puro; lo usan estudio (manual) y companion (auto). |
| `src/shared/kit/` | Contrato `KitScene`, validador, prompt y parseo de dibujo | Puro; datos, nunca código. |
| `src/video/kit/` | Renderer del kit: entorno, objetos, partículas, overlays, cámara | Determinista. |
| `src/shared/voice/` | `estimate.ts`, `alignment.ts` | Puro. |
| `src/companion/render/` | `render-service.ts`, `render-assets.ts` | Un render a la vez. |
| `src/companion/providers/` | `capabilities.ts`, `codex-cli.ts`, `vibi.ts` | Únicos módulos con red o procesos externos. |
| `studio/src/components/` | `PreviewPlayer.tsx`, `ExportPanel.tsx`, `ScriptStep.tsx`, `VoiceStep.tsx`, `Stepper.tsx` | Reutilizan `api.ts` y `model.ts`. |

### Rutas HTTP nuevas

Todas bajo la frontera actual (token + Origin/Host), salvo `render-assets`.

| Método y ruta | Uso | Paso |
|---|---|---|
| `GET /api/projects/:id/assets/:assetId` | Bytes de un activo del manifest; el estudio crea un blob URL | 2.1 |
| `POST /api/projects/:id/renders` | `{ expectedRevision }` → `{ renderId }`; 409 si la revisión no coincide o ya hay un render | 2.3 |
| `GET /api/projects/:id/renders/:renderId` | `{ status, progress, outputPath?, error? }` | 2.3 |
| `GET /api/projects/:id/renders/:renderId/file` | Descarga del MP4 | 2.3 |
| `GET /render-assets/:token/:assetId` | Solo durante un render; token aleatorio de un render; fuera de `/api` porque Remotion no envía cabeceras | 2.3 |
| `GET /api/capabilities` | `{ codex: boolean, vibi: boolean }` | 3.5 |
| `POST /api/script/generate` | `{ idea, styleId, locale, targetSeconds }` → `ScriptProposal` (no guarda) | 3.5 |
| `PUT /api/projects/:id/scenes/:sceneId/audio` | Modo manual: bytes de audio (+ `?align=vibi` opcional) → ingesta y guarda | 4.2 |
| `POST /api/projects/:id/scenes/:sceneId/voice` | Modo auto: `{ expectedRevision, voiceId?, provider? }` → Vibi TTS + STT → ingesta y guarda | 4.4 |

## Mapa de fases

| Fase | Resultado visible | Pasos |
|---|---|---|
| 0 | Documentos alineados, referencias visuales y dependencias instaladas | 0.1 – 0.4 |
| 1 | Primer MP4 **silencioso** desde un JSON de ejemplo, por línea de comandos | 1.1 – 1.5 (1.3 en a y b) |
| 2 | Vista previa y botón Exportar dentro del estudio | 2.1 – 2.3 |
| 3 | Idea → guion (auto o manual) → video silencioso | 3.1 – 3.5 |
| 4 | Voz (auto o manual) + subtítulos sincronizados → **primer video completo** 🎯 | 4.1 – 4.5 |
| 5 | Flujo guiado y pulido para uso diario | 5.1 – 5.4 |
| 6 | Después del primer video | [backlog](#fase-6--después-del-primer-video) |

---

## Fase 0 — Alinear y preparar

### 0.1 Registrar decisiones (solo documentación)

- **Hacer:** en `docs/plan/architecture.md`, reemplazar las filas «Chromium/Playwright + FFmpeg» y «Sin Remotion…» por ADR-01. Actualizar stack y límites de `PROJECT_CONTEXT.md`, estado y enlaces de `README.md`, y poner al inicio de `docs/plan/implementation-tasks.md`: «Congelado. Plan activo: ROADMAP.md». Crear `docs/dev/licenses.md` con tabla: componente, versión, licencia, condición (Remotion free license; fuente OFL; Vibi según plan contratado).
- **No hacer:** reescribir PRD ni API completa. No tocar `docs/reference/original-specification.md`.
- **Aceptación:**
  - [ ] Ningún documento índice contradice este ROADMAP.
  - [ ] Enlaces locales válidos.

### 0.2 Instalar dependencias

Ejecutar este paso es la autorización explícita de instalación.

- **Paquetes:** `remotion`, `@remotion/cli`, `@remotion/player`, `@remotion/renderer`, `@remotion/bundler`, `@remotion/three`, `@remotion/fonts`, `@remotion/captions`, `three`, `@react-three/fiber` (v9, compatible con React 19), `@types/three`.
- **Versión exacta idéntica** en todos los `@remotion/*` (sin `^`). Comprobar con `npx remotion versions`.
- **Navegador:** la primera vez Remotion descarga Chrome Headless Shell (`npx remotion browser ensure`). FFmpeg viene incluido; no hace falta `brew install ffmpeg`.
- **Skills para el agente:** `npx skills add remotion-dev/skills`. Confirmar que OpenCode las detecta; si no, enlazar la carpeta generada a la ruta de skills de OpenCode.
- **TypeScript:** incluir `src/video/` en `npm run typecheck` (tsconfig propio con `jsx: react-jsx`, o ajustar la raíz). `src/shared/` y `src/companion/` siguen siendo TS «strip-only» (sin JSX, sin `enum`), porque Node los ejecuta directo.
- **Aceptación:**
  - [x] `npm run typecheck` y `npm test` siguen en verde.
  - [x] Una sola versión de Remotion instalada.

### 0.3 Fuente

- Colocar el archivo OFL elegido en `src/video/assets/fonts/` con su `OFL.txt`. Registrar SHA-256 y licencia en `docs/dev/licenses.md`.
- **Aceptación:** [x] archivo, licencia y hash presentes.

### 0.4 Referencias visuales

- **Estado:** criterios iniciales ya escritos en [`docs/ux/references/README.md`](docs/ux/references/README.md) a partir de dos ejemplos. Ampliar con más ejemplos si hace falta.
- **Uso:** los pasos 1.3a, 1.3b, 1.4, 3.1 y 3.3 deben leer ese README antes de implementar.
- **ADR-09 decidido:** escenas declarativas sobre un kit (ver «Decisiones»).
- **Aceptación:** [x] criterios escritos · [x] ADR-09 registrado.

---

## Fase 1 — Primer MP4 silencioso (sin UI)

### 1.1 `projectToVideoProps` — TDD

- **Archivos:** `src/shared/video-props.ts`, `tests/unit/video-props.test.ts`.
- **Hacer:** `Project` + `assetUrls: Record<string, string>` → `{ fps, width, height, durationInFrames, captionStyle, voiceMode, scenes: [{ sceneId, fromFrame, durationInFrames, visual, words, audioUrl | null, gainDb }] }`. Usar `totalFrames` de `timeline.ts`. Estilo desconocido o visual inerte → error explícito. `visual: null` → escena provisional con fondo y `visualIntent` (no es error).
- **Aceptación:**
  - [ ] Con `docs/plan/examples/storyboard-project.json`: frames y fronteras de escena correctos y contiguos.
  - [ ] Función pura: misma entrada, misma salida.

### 1.2 Composición base y Remotion Studio

- **Archivos:** `src/video/index.ts` (`registerRoot`), `src/video/Root.tsx`, `src/video/VerticalVideo.tsx`; script `npm run video:studio` → `remotion studio src/video/index.ts`.
- **Hacer:** `<Composition id="Vertical">` 1080×1920, 30 fps, `calculateMetadata` desde las props, `defaultProps` desde el JSON de ejemplo. Un `<Sequence>` por escena con fondo y título provisional.
- **Aceptación:** [ ] Remotion Studio muestra 12 s con 2 escenas y el scrub funciona.

### 1.3a Contrato `KitScene` y schema 2 — TDD

Cambio de contrato autorizado por ADR-09. Leer antes [referencias visuales](docs/ux/references/README.md).

- **Archivos:** `src/shared/kit/{types,schema,validate}.ts`, `src/shared/schema/` (versión 2 y migración), tests unitarios.
- **Contrato** (`visual.kind: 'kit'`, `kitVersion: 1`), todo en datos, sin código ni URLs:
  - `palette`, `sky` (degradado, sol, nubes), `environment` (terreno: `mountain`, `cliff`, `plain`; agua: `sea`, `river` por puntos, `waterfall`), con `seed` propia.
  - `objects[]`: `{ id, type, params, position, rotation, scale, color, animations[] }`. Tipos iniciales: primitivas low-poly (`box`, `sphere`, `cylinder`, `cone`, `lathe` por perfil para botellas o saleros), `rock`, `drop`, `character` (articulado, con poses), `arrow`.
  - `animations[]`: `{ type, startMs, endMs, easing, params }` con `move`, `fall`, `roll`, `pulse`, `appear`, `disappear`, `pose`.
  - `particles[]`: `sparkle`, `rain`, `bubbles` (con `seed`).
  - `labels[]`: píldora anclada a un `objectId`. `overlays[]`: `counter`, `chevrons`.
  - `camera`: `{ move: 'static' | 'dolly-in' | 'pan' | 'orbit' | 'follow', from, to, target | targetObjectId, easing }`.
  - Límites: ≤ 24 objetos, ≤ 8 animaciones por objeto, ≤ 4 sistemas de partículas, ≤ 6 rótulos por escena.
- **Schema 2:** `visual` pasa a `{ kind: 'kit', … } | { kind: 'code', … } | null`. `code` queda **reservado y rechazado** por el validador hasta su fase. Migración v1 → v2 pura: los `StylizedVisual` v1 se convierten a escenas `kit` equivalentes; abrir un v1 lo migra en memoria y se guarda como v2. Mantener todas las pruebas de M1 en verde.
- **Aceptación:**
  - [ ] Validador rechaza tipos desconocidos, campos extra, `kind: 'code'` y límites excedidos con mensajes claros.
  - [ ] Los fixtures v1 migran y validan como v2; ida y vuelta guardar/reabrir estable.

### 1.3b Renderer del kit con Three.js

- **Archivos:** `src/video/styles/registry.ts`, `src/video/kit/{KitScene.tsx,camera.ts,animate.ts,environment/,objects/,particles/,overlays/}`, tests de `camera.ts` y `animate.ts`.
- **Hacer:**
  - Registry `styleId → renderer`; estilo no implementado muestra una pantalla de error visible, nunca negro.
  - `<ThreeCanvas>` 1080×1920, materiales con `flatShading`, luces y niebla según `palette`.
  - `camera.ts` y `animate.ts` (TDD): funciones puras de `(spec, ms) → estado`, con easing.
  - Una pieza por tipo del contrato; rótulos y overlays como DOM proyectado desde la posición 3D.
  - Crear `docs/plan/examples/kit/sal-del-mar.json` (escena tipo «río baja la montaña y arrastra una roca») como fixture de calidad.
- **Determinismo:** prohibido `Math.random`, `Date`, `useFrame` de R3F y animaciones CSS. Variación solo desde `seed`.
- **Render 3D:** usar `chromiumOptions: { gl: 'angle' }` (en CLI: `Config.setChromiumOpenGlRenderer('angle')`). Si aparecen frames negros o artefactos, revisar esto primero y bajar `concurrency`.
- **Aceptación:**
  - [ ] La escena de ejemplo se ve en Remotion Studio con estética comparable a `ref-sal.jpg` (low-poly plano, cámara en movimiento, partículas, rótulos).
  - [ ] Ir a un frame, avanzar y volver produce la misma imagen.
  - [ ] Un mismo `objectId` reutilizado en dos escenas se ve idéntico (continuidad).

### 1.4 Subtítulos palabra por palabra

- **Archivos:** `src/shared/voice/estimate.ts` + test (TDD), `src/video/captions/Captions.tsx`, `src/video/fonts.ts`.
- **Hacer:**
  - `estimateWords(text, durationMs)`: reparte la duración según largo de palabra y pausa tras puntuación; cumple `LIMITS`.
  - Si la escena no tiene `words`, usar las estimadas.
  - Estilo «karaoke» de las referencias: frase corta de 2–5 palabras en el tercio superior; palabras inactivas en gris translúcido, palabra activa en blanco y negrita (`highlightColor`); `emphasis` con recuadro. Respetar `anchor` y `safeMarginPx`. Se puede apoyar en `createTikTokStyleCaptions` de `@remotion/captions`.
  - Fuente cargada con `@remotion/fonts` + `delayRender` (importar el archivo como módulo, no `staticFile`).
- **Aceptación:**
  - [ ] Subtítulos legibles y dentro del margen seguro.
  - [ ] Una palabra larga hace salto de línea; nunca se corta.

### 1.5 Render por línea de comandos

- **Archivos:** `src/companion/render/render-service.ts`, `scripts/render-project.ts`, `tests/integration/render.test.ts`.
- **Hacer:** `bundle()` una vez (cache en memoria), `selectComposition`, `renderMedia({ codec: 'h264', inputProps, chromiumOptions: { gl: 'angle' }, onProgress })`. Escribir en temporal y renombrar a `<workspace>/.renders/<projectId>/<revision>-<yyyyMMdd-HHmmss>.mp4`. El store ignora carpetas con punto, así que `.renders/` no aparece como proyecto (cubrirlo con un test).
- **Script:** `npm run render -- <ruta/project.json> [salida.mp4]`.
- **Test real:** renderizar 2 s de un fixture mínimo y comprobar 1080×1920, 30 fps y duración ±1 frame (`npx remotion ffprobe` o `@remotion/media-parser`).
- **Hito 🎬:**
  - [ ] Existe el primer MP4 del ejemplo storyboard.
  - [ ] Se ve el 3D y los subtítulos.

---

## Fase 2 — Vista previa y exportar en el estudio

### 2.1 Activos para la vista previa

- **Hacer:** ruta `GET /api/projects/:id/assets/:assetId` (misma autenticación; solo activos del manifest; nunca rutas de archivo). En `api.ts`: `fetchAssetBlobUrl()`. Revocar los blob URLs al desmontar.
- **Aceptación:**
  - [ ] Test de integración: sin token → 401; activo inexistente → 404.
  - [ ] Los bytes devueltos coinciden con el `sha256` del manifest.

### 2.2 `PreviewPlayer`

- **Hacer:** `<Player component={VerticalVideo} inputProps={projectToVideoProps(draft, blobUrls)} … controls />` en un panel 9:16 junto a la lista de escenas. Muestra el **borrador**, incluidos los cambios sin guardar. Clic en una escena → `seekTo` a su inicio.
- **Aceptación:**
  - [ ] Editar el texto de una escena actualiza la vista previa sin guardar.
  - [ ] Play, pausa y seek funcionan.

### 2.3 Exportar desde la UI

- **Hacer:**
  - Rutas `renders` y `render-assets` (ver tabla). El render lee el `project.json` **guardado** (ADR-06).
  - `ExportPanel.tsx`: deshabilitado con cambios sin guardar («Guarda antes de exportar»); progreso por polling cada 1 s; al terminar muestra la ruta y «Descargar».
- **Aceptación:**
  - [ ] Exportar desde la UI produce el mismo video que el CLI.
  - [ ] Un segundo clic durante un render muestra «Ya hay una exportación en curso».
  - [ ] Cerrar la pestaña no corta el render.

---

## Fase 3 — Guion con modo dual

### 3.1 Contrato `ScriptProposal` y prompt — TDD

- **Archivos:** `src/shared/script/schema.ts`, `src/shared/script/prompt.ts` + tests.
La generación va en **dos etapas** con modo dual cada una: **Guion** (texto y descripción visual, aquí) y **Dibujo** (escena `kit` por escena, paso 3.3). Así cada respuesta es pequeña, se revisa por partes y una escena se puede redibujar sin rehacer el guion.

- **Contrato:** `{ title, sources: [{ title, url }], scenes: [{ title, narration, visualIntent, seconds }], cover: { headline }, postText }`.
  - Límites desde `LIMITS`: 1–12 escenas, 1–15 s por escena, total ≤ 60 s, narración ≤ 2000 caracteres.
  - JSON Schema **estricto** (todas las propiedades `required`, `additionalProperties: false`): lo exige `--output-schema`.
  - `sources`, `cover` y `postText` se guardan como metadatos del proyecto en schema 2 (sin consumir en el render todavía).
- **Prompt:** `buildScriptPrompt({ idea, styleId, locale, targetSeconds })` aplica la fórmula de las [referencias](docs/ux/references/README.md): pregunta reconocible en 3 s como gancho, explicación simple con fuentes, cierre para compartir; escenas de 2–5 s; ritmo aproximado de 2,5 palabras/s en español; `visualIntent` concreto y dibujable; «responder solo JSON válido según este schema» con el schema literal.
- **Aceptación:** [ ] prompt determinista, con fórmula y schema incluidos.

### 3.2 Parseo y validación — TDD

- **Archivos:** `src/shared/script/parse.ts` + test.
- **Hacer:** `parseScriptResponse(text)` tolerante: quita bloques de código, toma el primer objeto JSON, valida contra el contrato. Devuelve `{ ok: true, proposal }` o `{ ok: false, errors }` con mensajes en español para la UI. Nunca recorta valores en silencio.
- **Aceptación:** [ ] casos: válido, con bloque de código, con texto antes y después, campo faltante, demasiadas escenas, total > 60 s.

### 3.3 `applyScriptProposal` y Dibujo de escenas — TDD

- **Archivos:** `src/shared/script/apply.ts`, `src/shared/kit/{prompt,parse,apply}.ts` + tests.
- **`applyScriptProposal`:** reemplaza escenas (IDs nuevos), `text = narration`, `visualIntent`, duración redondeada a 100 ms, `startMs` contiguo, `output.durationMs` = suma, `visual: null`, `audio: null`, `words: []`, bindings vacíos.
- **Dibujo (`kit`):** `buildKitPrompt({ scene, previousScenes, references })` pide **una** `KitScene` por escena, con el catálogo del kit (tipos, parámetros, animaciones, movimientos de cámara) y el schema literal. `parseKitResponse` reutiliza la lógica tolerante de 3.2 y el validador de 1.3a. `applyKitScene(project, sceneId, kit)` asigna `visual`.
  - Continuidad: el prompt recibe los objetos ya usados; reutilizar `objectId` cuando el sujeto se repite.
  - Modo dual como el guion: «Copiar prompt de dibujo» / «Pegar escena» en manual, y `codex exec` con el schema de `KitScene` en automático (mismo adaptador de 3.5). «Dibujar todas» o «Redibujar esta escena».
- **Aceptación:**
  - [ ] El proyecto resultante pasa `validateProject` en ambas etapas.
  - [ ] Un JSON de escena inválido muestra errores y no toca el borrador.
  - [ ] Redibujar una escena no cambia las demás.

### 3.4 Modo manual en el estudio

- **Archivos:** `studio/src/components/ScriptStep.tsx`.
- **Hacer:** duración objetivo (15/30/45/60 s) → «Copiar prompt» → área «Pegar respuesta» → «Revisar» (lista de escenas o errores) → «Aplicar al borrador». Si ya hay escenas, confirmar «Reemplazar N escenas». Aplicar no guarda.
- **Aceptación:** [ ] pegar en ChatGPT web el prompt de guion y luego los de dibujo produce escenas 3D con subtítulos estimados en la vista previa.

### 3.5 Modo automático con Codex CLI

- **Archivos:** `src/companion/providers/{capabilities,codex-cli}.ts`, rutas `capabilities` y `script/generate`, test con ejecutable falso.
- **Hacer:**
  - `capabilities`: `spawn('codex', ['--version'])` con timeout de 5 s, sin shell; presencia de `VIBI_API_KEY`.
  - `codex-cli`: escribir el schema en un directorio temporal y ejecutar `codex exec --skip-git-repo-check --sandbox read-only --output-schema <schema> -o <salida> -` con el prompt por stdin, `cwd` = directorio temporal, `shell: false`, timeout de 180 s. Leer `<salida>` → `parseScriptResponse`. **Confirmar los flags con `codex exec --help`** de la versión instalada.
  - Errores claros: Codex no instalado (indicar instalación y `codex login`), timeout, salida inválida (mostrar el texto y ofrecer modo manual).
  - `ScriptStep`: selector Auto/Manual; Auto deshabilitado con el motivo si no hay capacidad.
- **Test:** un `codex` falso en `PATH` (script en `tests/helpers/`) que escribe un JSON fijo. Sin llamadas reales en tests.
- **Hito:**
  - [ ] Idea → guion y dibujo automáticos → vista previa → MP4 silencioso.

---

## Fase 4 — Voz con modo dual → primer video completo

### 4.1 Ingesta de audio en el store — TDD con disco real

- **Archivos:** `src/companion/store/project-store.ts` (método nuevo), `tests/integration/attach-audio.test.ts`.
- **Hacer:** `attachSceneAudio({ projectId, sceneId, bytes, mimeType, source, words, expectedRevision, expectedDigest })` en **una** transacción:
  1. Escribir `assets/<assetId>.<ext>` (temporal + rename) e inspeccionar con `inspectMedia` existente.
  2. Añadir al manifest con `sha256` y `durationMs`.
  3. `scene.audio = { assetId, offsetMs: 0, gainDb: 0 }` y `scene.words`.
  4. `durationMs = ceil((audioMs + 300) / 100) * 100`; error si supera 15 000. Recalcular `startMs` y `output.durationMs`.
  5. `output.voiceMode = 'withVoice'`.
  6. Calcular `mediaBindings` con `bindingDigests()` **después** de fijar `voiceMode` y duraciones (el digest de palabras depende de ambos).
  7. Guardar con el camino atómico existente. Si el activo anterior ya no lo usa ninguna escena, quitarlo del manifest y borrar su archivo después del commit.
- **Aceptación:**
  - [ ] Revisión desactualizada → 409 y nada escrito.
  - [ ] Audio demasiado largo → error y nada escrito.
  - [ ] Reabrir muestra bindings vigentes y pasa `validateProject`.

### 4.2 Modo manual de voz

- **Hacer:** ruta `PUT /api/projects/:id/scenes/:sceneId/audio` (bytes WAV/MP3; cabeceras `x-expected-revision`, `x-expected-digest`, `x-asset-license`). Palabras: `estimateWords(text, audioMs)` por defecto (gratis), o alineación real con el STT de Vibi si se pide `?align=vibi` (disponible tras 4.3; muestra el costo por duración antes). `VoiceStep.tsx`: «Copiar guion de locución» (escenas numeradas), «Subir audio» por escena, estado por escena (sin voz / lista / desactualizada).
- **Regla UI:** requiere proyecto guardado; si hay cambios, pedir guardar primero.
- **Aceptación:** [ ] audio externo por escena suena sincronizado en la vista previa.

### 4.3 Cliente Vibi y alineación por palabras — TDD

Referencia: <https://vibi.pro/docs> (página con JavaScript; abrir en navegador). Auth: cabecera `xi-api-key`. Base: `https://api.vibi.pro`. **Todo es asíncrono:** responde 202 con un ID y se consulta hasta `completed` o `failed`.

- **Archivos:** `src/companion/providers/vibi.ts`, `src/shared/voice/alignment.ts` + tests.
- **STT (alineación):** `POST /v1/speech-to-text` (multipart: `file`, `language_code` obligatorio — `es`, `timestamps_granularity=word`, `tag_audio_events=false`) → `{ task_id }`. Polling cada 2 s de `GET /v1/speech-to-text/{task_id}` hasta `status: completed`. Resultado: `result.words[]` con `{ text, start, end, type }` en **segundos**.
- **`alignment.ts`:** `sttWordsToWords(sttWords, sceneText, durationMs)` → `Word[]` en **ms** (convertir y redondear una sola vez). Usar solo `type === 'word'`; tiempos monótonos y dentro de la escena; `emphasis: false`. Usar el texto de la escena como verdad (el STT puede transcribir distinto): emparejar en orden y, si no cuadra, caer en `estimateWords` y avisar.
- **Cliente:** timeout total configurable (por defecto 120 s), sin reintentos automáticos, nunca registrar clave ni texto. `VIBI_BASE_URL` solo para tests.
- **Aceptación:**
  - [ ] Test con respuesta de forma real: segundos → ms, palabras de tipo distinto descartadas.
  - [ ] STT con una palabra de más o de menos cae en estimación sin romper.
  - [ ] Test del cliente contra servidor HTTP falso local: 202 → pending → completed, y `failed` con `detail_error`.

### 4.4 Modo automático con Vibi

- **Archivos:** `src/companion/providers/vibi.ts` (TTS), ruta `voice`, test con servidor falso.
- **Hacer:**
  - `POST /v1/text-to-speech/{voice_id}` con `{ text, language_code: 'es', provider, model_id, voice_settings }` → `{ id }`.
  - Polling de `GET /v1/history/{id}` hasta `completed`. Descargar `result.audio_url` (MP3) con la misma clave.
  - Pasar ese MP3 por el STT de 4.3 → `words`. Guardar vía `attachSceneAudio` con `source: { origin: 'provider', license: 'Vibi – según plan', attribution: '<provider>/<voice_id>' }`.
  - Configuración por env: `VIBI_API_KEY`, `VIBI_VOICE_ID`, `VIBI_PROVIDER` (por defecto `elevenlabs`), `VIBI_MODEL_ID` (por defecto `eleven_multilingual_v2`).
  - UI: confirmación con caracteres a enviar antes de gastar (TTS cobra por carácter y STT por duración; `GET` de la cuenta en «Auth» devuelve créditos disponibles); «Generar todas» secuencial con progreso; un fallo no deshace las escenas ya generadas.
- **Aceptación:** [ ] con el servidor falso: audio, palabras y bindings guardados; clave ausente en logs y en `project.json`.

### 4.5 Render con voz

- **Hacer:** audio por escena en `VerticalVideo` con el componente que recomiende la documentación/skill de Remotion de la versión instalada; volumen desde `gainDb`. `voiceMode: 'silent'` excluye el audio. En render, los audios se sirven por `render-assets`.
- **Hito 🎯 primer video completo:**
  - [ ] Video de 30–45 s con 3D, voz y subtítulos sincronizados.
  - [ ] El MP4 tiene pista de audio y se escucha completo.
  - [ ] Idea sugerida que encaja con el kit inicial: «¿De dónde sale la sal del mar?».

---

## Fase 5 — Flujo guiado y pulido

| Paso | Qué | Aceptación |
|---|---|---|
| 5.1 `Stepper` | Barra superior: 1 Idea y estilo · 2 Guion · 3 Voz · 4 Vista previa y exportar. Estado por paso (pendiente / listo / desactualizado), calculado puro desde el proyecto. | Refleja el estado real tras guardar y reabrir. |
| 5.2 Voz desactualizada | Comparar `mediaBindings` guardados con `bindingDigests(project)`. Texto cambiado → «Voz desactualizada» + «Regenerar esta escena». Exportar con voz desactualizada pide confirmación. | Editar texto marca solo esa escena. |
| 5.3 Ajustes por escena | En el editor: paleta, movimiento de cámara y rótulos de la escena `kit`, más «Redibujar». Sin edición 3D libre. | El cambio se ve en la vista previa y se guarda. |
| 5.4 E2E del camino feliz | Un test: crear proyecto → aplicar guion manual fijo → subir audio de fixture → exportar → verificar metadatos del MP4. Con el harness E2E existente. | Pasa en limpio desde un workspace nuevo. |

## Fase 6 — Después del primer video

En orden sugerido; cada ítem se planifica cuando llegue su turno:

1. **Música de fondo** con ducking. Requiere `schemaVersion: 2` y migración (no hay pista global en schema 1).
2. **Segundo estilo** (tipografía cinética 2D). El registry ya lo admite; aparece deshabilitado hasta implementarse.
3. **Ampliar el kit** con los objetos que más se repitan, y luego **escenas `code`** (ADR-09) solo en local para lo que el kit no cubra.
4. **Alineación local gratuita** (Whisper local) como alternativa al STT de Vibi.
5. **Guard de revisión en `saveProject`** (hallazgo documentado en C01: `payload.revision` distinto de `expectedRevision + 1`).
6. **Endurecimiento selectivo** desde el plan anterior, solo si aparece el problema.

## Qué pasa con el plan anterior

| Plan anterior | En esta ruta |
|---|---|
| C01 contratos | Contratos pequeños por paso (`VideoProps`, `ScriptProposal`) |
| V02a–c registry/catálogo | 1.3a–1.3b (kit declarativo, schema 2) |
| V03a–c composición/overlays/transport | Remotion: 1.2–1.4 y 2.2 |
| V04a–b medios/aprobación | 4.1–4.2; snapshots y retención → backlog |
| V05a–d captura/encoder/publicación | Remotion renderer: 1.5 y 2.3 |
| V06a–d preflight/cola/watchdogs/recibos | 2.3 simplificado; resto → backlog |
| V07–V08 goldens/prueba G2 | Verificación humana + test de metadatos; goldens → backlog |
| E01a–c editor/inspector/ingesta | 5.1, 5.3, 4.1 |
| E02 invalidación | 5.2 |
| E03–E04 fakes/autorización | Fakes solo en tests; confirmación de gasto en 4.4 |
| E05 proveedor real | **Ya no es opcional:** 3.5 y 4.4 |
| E06, H01–H05 | Backlog |

## Camino a servidor (no ahora)

- Codex CLI con suscripción personal **no sirve para otros usuarios**: en servidor, usar API con clave propia y límites de costo.
- Remotion: gratis mientras sea uso individual o empresa de hasta 3 personas; con 4 o más, licencia de empresa.
- Sustituir token loopback por autenticación real; workspace por almacenamiento de objetos; render en workers (Remotion Lambda/Cloud Run o cola propia). Aquí sí vuelven a importar varias tarjetas V06/H01.

## Reglas para OpenCode

- **Leer:** el paso indicado de este ROADMAP, `PROJECT_CONTEXT.md` y solo los archivos que el paso menciona. No recorrer todo `docs/plan/`.
- **Alcance:** un paso por sesión. No adelantar pasos ni añadir robustez no pedida (colas recuperables, journals, cuotas, snapshots, fuzzing, goldens de píxeles).
- **Extender, no reescribir:** `ProjectStore`, schema y frontera HTTP se reutilizan.
- **Pruebas:** TDD en los pasos marcados; disco real en tests del store; sin llamadas reales a proveedores en tests. Lo visual se verifica en Remotion Studio o en la vista previa.
- **Determinismo en `src/video/`:** prohibido `Math.random`, `Date`, `useFrame` y animaciones CSS.
- **Seguridad mínima que se mantiene:** solo loopback, token, `spawn` sin shell, claves solo en variables de entorno y nunca en `project.json`, logs ni respuestas.
- **Bloqueos:** si el paso exige una dependencia nueva, un cambio de schema o contradice el código real, detenerse y preguntar.
- **Commits:** automáticos al terminar el paso con typecheck y tests en verde, en la rama del paso, conventional commits. Nunca en `main` ni push sin pedido.

## Prompt de ejecución

```text
Ejecuta el paso <ID> de ROADMAP.md en Molecula Studio.
1. Lee de ROADMAP.md: "Decisiones", "Arquitectura objetivo", "Reglas para OpenCode"
   y el paso <ID>. Lee PROJECT_CONTEXT.md y solo los archivos que el paso menciona.
2. Verifica `git status` y crea la rama feat/<id>-<slug> desde main.
3. Si el paso marca TDD, escribe primero el test que falla y muéstrame la salida.
4. Implementa lo mínimo para cumplir la aceptación del paso. No adelantes otros pasos.
5. Ejecuta `npm run typecheck` y los tests del paso; muestra conteos.
6. Explícame cómo verifico a mano el criterio visual o sonoro.
7. Si algo del paso no encaja con el código real, detente y explica la discrepancia.
8. Si typecheck y tests pasan: commit en la rama del paso y marca [x] el paso en "Progreso".
No hagas merge a main ni push hasta que lo apruebe.
```

## Prompt de revisión

```text
Sesión nueva, solo lectura. Revisa la fase <N> de ROADMAP.md contra `git diff <base>..HEAD`.
Verifica: criterios de aceptación de cada paso; reglas de determinismo y seguridad de
"Reglas para OpenCode"; que los tests ejerciten el comportamiento real; y código que
exceda el alcance de la fase. Devuelve hallazgos con severidad (bloqueante / mejora),
archivo:línea y cómo reproducirlo. No modifiques archivos.
```

## Progreso

- [x] 0.1 Registrar decisiones
- [x] 0.2 Instalar dependencias
- [x] 0.3 Fuente
- [x] 0.4 Referencias visuales (ADR-09 decidido)
- [ ] 1.1 `projectToVideoProps`
- [ ] 1.2 Composición base y Remotion Studio
- [ ] 1.3a Contrato KitScene y schema 2
- [ ] 1.3b Renderer del kit
- [ ] 1.4 Subtítulos palabra por palabra
- [ ] 1.5 Render por línea de comandos 🎬
- [ ] 2.1 Activos para la vista previa
- [ ] 2.2 `PreviewPlayer`
- [ ] 2.3 Exportar desde la UI
- [ ] 3.1 Contrato y prompt
- [ ] 3.2 Parseo y validación
- [ ] 3.3 Aplicar guion y dibujo de escenas
- [ ] 3.4 Guion manual
- [ ] 3.5 Guion automático con Codex
- [ ] 4.1 Ingesta de audio
- [ ] 4.2 Voz manual
- [ ] 4.3 Cliente Vibi y alineación
- [ ] 4.4 Voz automática con Vibi
- [ ] 4.5 Render con voz 🎯
- [ ] 5.1 – 5.4 Flujo guiado y pulido
